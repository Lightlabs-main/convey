import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  stringToBytes,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const CHAIN_ID = 196;
const WRITE_CONFIRMATION = "I_UNDERSTAND_MAINNET_WRITE";
const ARTIFACT_SOURCE = "contracts/core/DropEscrow.sol";

type Artifact = {
  abi: readonly unknown[];
  bytecode: { object: Hex };
  rawMetadata?: string;
  sources?: Record<string, { keccak256?: string }>;
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function privateKey(name: string): Hex {
  const value = required(name);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${name} must be a 32-byte private key`);
  return value as Hex;
}

function address(name: string): Address {
  const value = required(name);
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${name} must be a 20-byte address`);
  return value as Address;
}

async function artifact(): Promise<Artifact> {
  const artifactPath = new URL("../out/DropEscrow.sol/DropEscrow.json", import.meta.url);
  const value = JSON.parse(await readFile(fileURLToPath(artifactPath), "utf8")) as Artifact;
  if (!value.bytecode.object || value.bytecode.object === "0x") {
    throw new Error("DropEscrow artifact has no deployable bytecode; run forge build first");
  }

  const sourcePath = new URL("../contracts/core/DropEscrow.sol", import.meta.url);
  const sourceHash = keccak256(stringToBytes(await readFile(fileURLToPath(sourcePath), "utf8")));
  let metadataSources = value.sources;
  if (!metadataSources && value.rawMetadata) {
    try {
      metadataSources = (JSON.parse(value.rawMetadata) as {
        sources?: Record<string, { keccak256?: string }>;
      }).sources;
    } catch {
      throw new Error("DropEscrow artifact metadata is malformed; run forge build again");
    }
  }
  const artifactHash = metadataSources?.[ARTIFACT_SOURCE]?.keccak256;
  if (artifactHash?.toLowerCase() !== sourceHash.toLowerCase()) {
    throw new Error("DropEscrow artifact is stale; run forge build before deployment");
  }
  return value;
}

const rpcUrl = required("XLAYER_RPC_URL");
const deployer = privateKeyToAccount(privateKey("DEPLOYER_PRIVATE_KEY"));
const registry = address("CONVEY_ASSET_REGISTRY_ADDRESS");
const existing = process.env.CONVEY_DROP_ESCROW_ADDRESS?.trim();
if (existing) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(existing)) {
    throw new Error("CONVEY_DROP_ESCROW_ADDRESS must be a 20-byte address");
  }
  throw new Error("CONVEY_DROP_ESCROW_ADDRESS is already set; refusing duplicate deployment");
}

const chain = {
  id: CHAIN_ID,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
} as const;
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account: deployer, chain, transport: http(rpcUrl) });
const artifactValue = await artifact();

const registryAbi = [
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const [chainId, registryCode, registryOwner] = await Promise.all([
  publicClient.getChainId(),
  publicClient.getCode({ address: registry }),
  publicClient.readContract({ address: registry, abi: registryAbi, functionName: "owner" }),
]);
if (chainId !== CHAIN_ID) throw new Error(`execution RPC returned chain ${chainId}, expected ${CHAIN_ID}`);
if (!registryCode || registryCode === "0x") throw new Error("asset registry has no live bytecode");
if (registryOwner.toLowerCase() !== deployer.address.toLowerCase()) {
  throw new Error(`asset registry owner ${registryOwner} is not the deployer ${deployer.address}`);
}

const confirmationArgumentProvided = process.argv.includes("--confirm");
const confirmationEnvironmentProvided = process.env.CONVEY_DROP_CONFIRM === WRITE_CONFIRMATION;
const writeEnabled = confirmationArgumentProvided && confirmationEnvironmentProvided;
const baseOutput = {
  checkedAt: new Date().toISOString(),
  chainId,
  deployer: deployer.address,
  assetRegistry: registry,
  artifactSource: ARTIFACT_SOURCE,
  artifactBytecodeBytes: (artifactValue.bytecode.object.length - 2) / 2,
  confirmationArgumentProvided,
  confirmationEnvironmentProvided,
  writeEnabled,
};

if (!writeEnabled) {
  console.log(JSON.stringify(baseOutput, null, 2));
} else {
  const transactionHash = await walletClient.deployContract({
    abi: artifactValue.abi,
    bytecode: artifactValue.bytecode.object,
    args: [registry],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash });
  if (receipt.status !== "success" || !receipt.contractAddress) {
    throw new Error(`DropEscrow deployment failed in transaction ${transactionHash}`);
  }

  const configuredRegistry = await publicClient.readContract({
    address: receipt.contractAddress,
    abi: artifactValue.abi,
    functionName: "registry",
  }) as Address;
  if (configuredRegistry.toLowerCase() !== registry.toLowerCase()) {
    throw new Error("deployed DropEscrow registry read-back mismatch");
  }

  console.log(JSON.stringify({
    ...baseOutput,
    address: receipt.contractAddress,
    transactionHash,
    blockNumber: receipt.blockNumber.toString(),
    writeEnabled: true,
  }, null, 2));
}
