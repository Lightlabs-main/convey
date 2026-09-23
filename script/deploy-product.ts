import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const CHAIN_ID = 196;
const ENTRY_POINT_V07 = "0x0000000071727de22e5e9d8baf0edac6f37da032" as Address;

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

function uint(name: string): bigint {
  let value: bigint;
  try {
    value = BigInt(required(name));
  } catch {
    throw new Error(`${name} must be an integer in base 10 or 0x form`);
  }
  if (value <= 0n) throw new Error(`${name} must be greater than zero`);
  return value;
}

function optionalAddress(name: string): Address | undefined {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${name} must be a 20-byte address`);
  return value as Address;
}

async function artifact(name: string): Promise<{ abi: readonly unknown[]; bytecode: { object: Hex } }> {
  const path = new URL(`../out/${name}.sol/${name}.json`, import.meta.url);
  const value = JSON.parse(await readFile(fileURLToPath(path), "utf8")) as {
    abi: readonly unknown[];
    bytecode: { object: Hex };
  };
  if (!value.bytecode.object || value.bytecode.object === "0x") {
    throw new Error(`${name} artifact has no deployable bytecode; run forge build first`);
  }
  return value;
}

const rpcUrl = required("XLAYER_RPC_URL");
const deployer = privateKeyToAccount(privateKey("DEPLOYER_PRIVATE_KEY"));
const claimSigner = privateKeyToAccount(privateKey("CLAIM_PAYMASTER_SIGNER_PRIVATE_KEY"));
const receiverOwner = privateKeyToAccount(privateKey("SMART_ACCOUNT_OWNER_PRIVATE_KEY"));
const minimumReserve = uint("CLAIM_PAYMASTER_MIN_RESERVE_WEI");
const maxClaimCost = uint("CLAIM_PAYMASTER_MAX_COST_WEI");
if (deployer.address.toLowerCase() === claimSigner.address.toLowerCase()) {
  throw new Error("DEPLOYER_PRIVATE_KEY and CLAIM_PAYMASTER_SIGNER_PRIVATE_KEY must be different");
}
if (deployer.address.toLowerCase() === receiverOwner.address.toLowerCase()) {
  throw new Error("DEPLOYER_PRIVATE_KEY must be separate from SMART_ACCOUNT_OWNER_PRIVATE_KEY");
}
if (claimSigner.address.toLowerCase() === receiverOwner.address.toLowerCase()) {
  throw new Error("CLAIM_PAYMASTER_SIGNER_PRIVATE_KEY must be separate from SMART_ACCOUNT_OWNER_PRIVATE_KEY");
}
if (minimumReserve < maxClaimCost) {
  throw new Error("CLAIM_PAYMASTER_MIN_RESERVE_WEI must be at least CLAIM_PAYMASTER_MAX_COST_WEI");
}

const existingRegistry = optionalAddress("CONVEY_ASSET_REGISTRY_ADDRESS");
const existingPaymaster = optionalAddress("CONVEY_CLAIM_PAYMASTER_ADDRESS");
const existingEscrow = optionalAddress("CONVEY_CLAIM_ESCROW_ADDRESS");
if (existingRegistry || existingPaymaster || existingEscrow) {
  throw new Error("product contract addresses are already configured; refusing duplicate deployment");
}

const chain = {
  id: CHAIN_ID,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
} as const;
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account: deployer, chain, transport: http(rpcUrl) });

const [chainId, entryPointCode, registryArtifact, paymasterArtifact, escrowArtifact] = await Promise.all([
  publicClient.getChainId(),
  publicClient.getCode({ address: ENTRY_POINT_V07 }),
  artifact("AssetRegistry"),
  artifact("ConveyClaimPaymasterV07"),
  artifact("GiftEscrow"),
]);
if (chainId !== CHAIN_ID) throw new Error(`execution RPC returned chain ${chainId}, expected ${CHAIN_ID}`);
if (!entryPointCode || entryPointCode === "0x") throw new Error("canonical v0.7 EntryPoint has no bytecode");

const registryTx = await walletClient.deployContract({
  abi: registryArtifact.abi,
  bytecode: registryArtifact.bytecode.object,
  args: [deployer.address],
});
const registryReceipt = await publicClient.waitForTransactionReceipt({ hash: registryTx });
if (registryReceipt.status !== "success" || !registryReceipt.contractAddress) {
  throw new Error(`AssetRegistry deployment failed in transaction ${registryTx}`);
}

const paymasterTx = await walletClient.deployContract({
  abi: paymasterArtifact.abi,
  bytecode: paymasterArtifact.bytecode.object,
  args: [deployer.address, claimSigner.address, "0x0000000000000000000000000000000000000000", minimumReserve, maxClaimCost],
});
const paymasterReceipt = await publicClient.waitForTransactionReceipt({ hash: paymasterTx });
if (paymasterReceipt.status !== "success" || !paymasterReceipt.contractAddress) {
  throw new Error(`ConveyClaimPaymasterV07 deployment failed in transaction ${paymasterTx}`);
}

const escrowTx = await walletClient.deployContract({
  abi: escrowArtifact.abi,
  bytecode: escrowArtifact.bytecode.object,
  args: [registryReceipt.contractAddress, paymasterReceipt.contractAddress],
});
const escrowReceipt = await publicClient.waitForTransactionReceipt({ hash: escrowTx });
if (escrowReceipt.status !== "success" || !escrowReceipt.contractAddress) {
  throw new Error(`GiftEscrow deployment failed in transaction ${escrowTx}`);
}

const setEscrowTx = await walletClient.writeContract({
  address: paymasterReceipt.contractAddress,
  abi: [{
    type: "function",
    name: "setEscrow",
    stateMutability: "nonpayable",
    inputs: [{ name: "escrow", type: "address" }],
    outputs: [],
  }] as const,
  functionName: "setEscrow",
  args: [escrowReceipt.contractAddress],
});
const setEscrowReceipt = await publicClient.waitForTransactionReceipt({ hash: setEscrowTx });
if (setEscrowReceipt.status !== "success") throw new Error(`paymaster escrow binding failed in transaction ${setEscrowTx}`);

const [registryOwner, paymasterOwner, paymasterSigner, boundEscrow, escrowRegistry, escrowPaymaster] =
  await Promise.all([
    publicClient.readContract({
      address: registryReceipt.contractAddress,
      abi: registryArtifact.abi,
      functionName: "owner",
    }),
    publicClient.readContract({
      address: paymasterReceipt.contractAddress,
      abi: paymasterArtifact.abi,
      functionName: "owner",
    }),
    publicClient.readContract({
      address: paymasterReceipt.contractAddress,
      abi: paymasterArtifact.abi,
      functionName: "verifyingSigner",
    }),
    publicClient.readContract({
      address: paymasterReceipt.contractAddress,
      abi: paymasterArtifact.abi,
      functionName: "escrow",
    }),
    publicClient.readContract({
      address: escrowReceipt.contractAddress,
      abi: escrowArtifact.abi,
      functionName: "registry",
    }),
    publicClient.readContract({
      address: escrowReceipt.contractAddress,
      abi: escrowArtifact.abi,
      functionName: "claimPaymaster",
    }),
  ]);
if ((registryOwner as string).toLowerCase() !== deployer.address.toLowerCase()) throw new Error("registry owner mismatch");
if ((paymasterOwner as string).toLowerCase() !== deployer.address.toLowerCase()) throw new Error("paymaster owner mismatch");
if ((paymasterSigner as string).toLowerCase() !== claimSigner.address.toLowerCase()) throw new Error("paymaster signer mismatch");
if ((boundEscrow as string).toLowerCase() !== escrowReceipt.contractAddress.toLowerCase()) throw new Error("paymaster escrow mismatch");
if ((escrowRegistry as string).toLowerCase() !== registryReceipt.contractAddress.toLowerCase()) throw new Error("escrow registry mismatch");
if ((escrowPaymaster as string).toLowerCase() !== paymasterReceipt.contractAddress.toLowerCase()) throw new Error("escrow paymaster mismatch");

console.log(JSON.stringify({
  chainId,
  deployer: deployer.address,
  claimPaymasterSigner: claimSigner.address,
  registry: {
    address: registryReceipt.contractAddress,
    transactionHash: registryTx,
    blockNumber: registryReceipt.blockNumber.toString(),
  },
  claimPaymaster: {
    address: paymasterReceipt.contractAddress,
    transactionHash: paymasterTx,
    blockNumber: paymasterReceipt.blockNumber.toString(),
    escrowBindingTransactionHash: setEscrowTx,
    minimumReserveWei: minimumReserve.toString(),
    maxClaimCostWei: maxClaimCost.toString(),
  },
  escrow: {
    address: escrowReceipt.contractAddress,
    transactionHash: escrowTx,
    blockNumber: escrowReceipt.blockNumber.toString(),
  },
}, null, 2));
