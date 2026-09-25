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
const ARTIFACT_SOURCE = "contracts/recurring/ConveyRecurringGiftHook.sol";
const PRODUCTION_RECEIVER = "0x63B2A84d47cb07fb18EE72Ec386893506Fd963db" as Address;

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

function uint(name: string, maxBits = 256): bigint {
  let value: bigint;
  try {
    value = BigInt(required(name));
  } catch {
    throw new Error(`${name} must be an integer in base 10 or 0x form`);
  }
  if (value <= 0n || value >= (1n << BigInt(maxBits))) {
    throw new Error(`${name} must be a positive uint${maxBits}`);
  }
  return value;
}

async function artifact(): Promise<Artifact> {
  const artifactPath = new URL("../out/ConveyRecurringGiftHook.sol/ConveyRecurringGiftHook.json", import.meta.url);
  const value = JSON.parse(await readFile(fileURLToPath(artifactPath), "utf8")) as Artifact;
  if (!value.bytecode.object || value.bytecode.object === "0x") {
    throw new Error("ConveyRecurringGiftHook artifact has no deployable bytecode; run forge build first");
  }

  const sourcePath = new URL("../contracts/recurring/ConveyRecurringGiftHook.sol", import.meta.url);
  const sourceHash = keccak256(stringToBytes(await readFile(fileURLToPath(sourcePath), "utf8")));
  let metadataSources = value.sources;
  if (!metadataSources && value.rawMetadata) {
    try {
      metadataSources = (JSON.parse(value.rawMetadata) as {
        sources?: Record<string, { keccak256?: string }>;
      }).sources;
    } catch {
      throw new Error("ConveyRecurringGiftHook artifact metadata is malformed; run forge build again");
    }
  }
  const artifactHash = metadataSources?.[ARTIFACT_SOURCE]?.keccak256;
  if (artifactHash?.toLowerCase() !== sourceHash.toLowerCase()) {
    throw new Error("ConveyRecurringGiftHook artifact is stale; run forge build before deployment");
  }
  return value;
}

const rpcUrl = required("XLAYER_RPC_URL");
const deployer = privateKeyToAccount(privateKey("DEPLOYER_PRIVATE_KEY"));
const wallet = address("CONVEY_RECURRING_WALLET");
const escrow = address("CONVEY_CLAIM_ESCROW_ADDRESS");
const asset = address("CONVEY_RECURRING_ASSET");
const registry = address("CONVEY_ASSET_REGISTRY_ADDRESS");
if (wallet.toLowerCase() === PRODUCTION_RECEIVER.toLowerCase()) {
  throw new Error("CONVEY_RECURRING_WALLET is Convey's sole-owner production receiver; use a disposable or multi-owner wallet");
}
const maxGiftAmount = uint("CONVEY_RECURRING_MAX_GIFT_AMOUNT");
const maxReserveWei = uint("CONVEY_RECURRING_MAX_RESERVE_WEI");
const totalBudget = uint("CONVEY_RECURRING_TOTAL_BUDGET");
const expiresAt = uint("CONVEY_RECURRING_EXPIRES_AT", 64);
if (maxGiftAmount > totalBudget) {
  throw new Error("CONVEY_RECURRING_MAX_GIFT_AMOUNT must not exceed CONVEY_RECURRING_TOTAL_BUDGET");
}

const existing = process.env.CONVEY_RECURRING_HOOK_ADDRESS?.trim();
if (existing) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(existing)) {
    throw new Error("CONVEY_RECURRING_HOOK_ADDRESS must be a 20-byte address");
  }
  throw new Error("CONVEY_RECURRING_HOOK_ADDRESS is already set; refusing duplicate deployment");
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
    name: "isGiftable",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;
const [chainId, walletCode, escrowCode, assetCode, registryCode, giftable, block] = await Promise.all([
  publicClient.getChainId(),
  publicClient.getCode({ address: wallet }),
  publicClient.getCode({ address: escrow }),
  publicClient.getCode({ address: asset }),
  publicClient.getCode({ address: registry }),
  publicClient.readContract({ address: registry, abi: registryAbi, functionName: "isGiftable", args: [asset] }),
  publicClient.getBlock(),
]);
if (chainId !== CHAIN_ID) throw new Error(`execution RPC returned chain ${chainId}, expected ${CHAIN_ID}`);
if (!walletCode || walletCode === "0x") throw new Error("recurring wallet has no live bytecode");
if (!escrowCode || escrowCode === "0x") throw new Error("GiftEscrow has no live bytecode");
if (!assetCode || assetCode === "0x") throw new Error("recurring asset has no live bytecode");
if (!registryCode || registryCode === "0x") throw new Error("asset registry has no live bytecode");
if (!giftable) throw new Error("CONVEY_RECURRING_ASSET is not certified and enabled in the live registry");
if (expiresAt <= block.timestamp) {
  throw new Error(`CONVEY_RECURRING_EXPIRES_AT must be after the current chain timestamp ${block.timestamp}`);
}

const confirmationArgumentProvided = process.argv.includes("--confirm");
const confirmationEnvironmentProvided = process.env.CONVEY_RECURRING_HOOK_CONFIRM === WRITE_CONFIRMATION;
const writeEnabled = confirmationArgumentProvided && confirmationEnvironmentProvided;
const baseOutput = {
  checkedAt: new Date().toISOString(),
  chainId,
  deployer: deployer.address,
  wallet,
  giftEscrow: escrow,
  asset,
  assetRegistry: registry,
  maxGiftAmount: maxGiftAmount.toString(),
  maxReserveWei: maxReserveWei.toString(),
  totalBudget: totalBudget.toString(),
  expiresAt: expiresAt.toString(),
  currentChainTimestamp: block.timestamp.toString(),
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
    args: [wallet, escrow, asset, maxGiftAmount, maxReserveWei, totalBudget, expiresAt],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash });
  if (receipt.status !== "success" || !receipt.contractAddress) {
    throw new Error(`ConveyRecurringGiftHook deployment failed in transaction ${transactionHash}`);
  }

  const [configuredWallet, configuredEscrow, configuredAsset, configuredMaxGiftAmount, configuredMaxReserveWei, configuredTotalBudget, configuredExpiresAt] = await Promise.all([
    publicClient.readContract({ address: receipt.contractAddress, abi: artifactValue.abi, functionName: "wallet" }) as Promise<Address>,
    publicClient.readContract({ address: receipt.contractAddress, abi: artifactValue.abi, functionName: "escrow" }) as Promise<Address>,
    publicClient.readContract({ address: receipt.contractAddress, abi: artifactValue.abi, functionName: "asset" }) as Promise<Address>,
    publicClient.readContract({ address: receipt.contractAddress, abi: artifactValue.abi, functionName: "maxGiftAmount" }) as Promise<bigint>,
    publicClient.readContract({ address: receipt.contractAddress, abi: artifactValue.abi, functionName: "maxReserveWei" }) as Promise<bigint>,
    publicClient.readContract({ address: receipt.contractAddress, abi: artifactValue.abi, functionName: "totalBudget" }) as Promise<bigint>,
    publicClient.readContract({ address: receipt.contractAddress, abi: artifactValue.abi, functionName: "expiresAt" }) as Promise<bigint>,
  ]);
  if (
    configuredWallet.toLowerCase() !== wallet.toLowerCase()
    || configuredEscrow.toLowerCase() !== escrow.toLowerCase()
    || configuredAsset.toLowerCase() !== asset.toLowerCase()
    || configuredMaxGiftAmount !== maxGiftAmount
    || configuredMaxReserveWei !== maxReserveWei
    || configuredTotalBudget !== totalBudget
    || configuredExpiresAt !== expiresAt
  ) {
    throw new Error("deployed ConveyRecurringGiftHook configuration read-back mismatch");
  }

  console.log(JSON.stringify({
    ...baseOutput,
    address: receipt.contractAddress,
    transactionHash,
    blockNumber: receipt.blockNumber.toString(),
    writeEnabled: true,
  }, null, 2));
}
