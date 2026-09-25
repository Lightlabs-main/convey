import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, keccak256, stringToBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const CHAIN_ID = 196;

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

function amount(name: string): bigint {
  let value: bigint;
  try { value = BigInt(required(name)); } catch { throw new Error(`${name} must be an integer amount`); }
  if (value <= 0n) throw new Error(`${name} must be greater than zero`);
  return value;
}

async function artifact(): Promise<{ abi: readonly unknown[]; bytecode: { object: Hex }; rawMetadata?: string; sources?: Record<string, { keccak256?: string }> }> {
  const path = new URL("../out/ConveyExitPaymasterV07.sol/ConveyExitPaymasterV07.json", import.meta.url);
  const value = JSON.parse(await readFile(fileURLToPath(path), "utf8")) as { abi: readonly unknown[]; bytecode: { object: Hex }; rawMetadata?: string; sources?: Record<string, { keccak256?: string }> };
  if (!value.bytecode.object || value.bytecode.object === "0x") throw new Error("exit paymaster artifact has no bytecode; run forge build first");
  const sourcePath = new URL("../contracts/paymaster/ConveyExitPaymasterV07.sol", import.meta.url);
  const sourceHash = keccak256(stringToBytes(await readFile(fileURLToPath(sourcePath), "utf8")));
  let metadataSources = value.sources;
  if (!metadataSources && value.rawMetadata) {
    try {
      metadataSources = (JSON.parse(value.rawMetadata) as { sources?: Record<string, { keccak256?: string }> }).sources;
    } catch {
      throw new Error("exit paymaster artifact metadata is malformed; run forge build again");
    }
  }
  const artifactHash = metadataSources?.["contracts/paymaster/ConveyExitPaymasterV07.sol"]?.keccak256;
  if (artifactHash?.toLowerCase() !== sourceHash.toLowerCase()) {
    throw new Error("exit paymaster artifact is stale; run forge build before deployment");
  }
  return value;
}

const rpcUrl = required("XLAYER_RPC_URL");
const deployer = privateKeyToAccount(privateKey("DEPLOYER_PRIVATE_KEY"));
const signerKey = process.env.CONVEY_EXIT_PAYMASTER_SIGNER_PRIVATE_KEY?.trim() || required("BOOTSTRAP_PAYMASTER_SIGNER_PRIVATE_KEY");
if (!/^0x[0-9a-fA-F]{64}$/.test(signerKey)) throw new Error("exit paymaster signer key must be a 32-byte private key");
const sponsor = privateKeyToAccount(signerKey as Hex);
const receiverOwner = privateKeyToAccount(privateKey("SMART_ACCOUNT_OWNER_PRIVATE_KEY"));
if (deployer.address.toLowerCase() === sponsor.address.toLowerCase()) throw new Error("deployer and exit sponsor signer must be distinct");
if (deployer.address.toLowerCase() === receiverOwner.address.toLowerCase()) throw new Error("deployer and receiver owner must be distinct");
if (sponsor.address.toLowerCase() === receiverOwner.address.toLowerCase()) throw new Error("exit sponsor signer and receiver owner must be distinct");

const chain = {
  id: CHAIN_ID,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
} as const;
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account: deployer, chain, transport: http(rpcUrl) });
const artifactValue = await artifact();
const existing = process.env.CONVEY_EXIT_PAYMASTER_ADDRESS?.trim();
if (existing) throw new Error("CONVEY_EXIT_PAYMASTER_ADDRESS is already set; refusing duplicate deployment");
const router = address("CONVEY_EXIT_ROUTER_ADDRESS");
const usdt0 = address("CONVEY_EXIT_USDT0_ADDRESS");
const registry = address("CONVEY_ASSET_REGISTRY_ADDRESS");
const maxExitCost = amount("CONVEY_EXIT_MAX_COST_WEI");
if ((await publicClient.getCode({ address: registry })) === "0x") throw new Error("asset registry has no live bytecode");
if ((await publicClient.getCode({ address: router })) === "0x") throw new Error("exit router has no live bytecode");
if ((await publicClient.getCode({ address: usdt0 })) === "0x") throw new Error("USDT0 has no live bytecode");

const chainId = await publicClient.getChainId();
if (chainId !== CHAIN_ID) throw new Error(`execution RPC returned chain ${chainId}, expected ${CHAIN_ID}`);
const txHash = await walletClient.deployContract({
  abi: artifactValue.abi,
  bytecode: artifactValue.bytecode.object,
  args: [deployer.address, sponsor.address, registry, router, usdt0, maxExitCost],
});
const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`exit paymaster deployment failed in ${txHash}`);
const [configuredOwner, configuredSigner, configuredRegistry, configuredRouter, configuredUsdt0, configuredMaxCost] = await Promise.all([
  publicClient.readContract({ address: receipt.contractAddress, abi: artifactValue.abi, functionName: "owner" }),
  publicClient.readContract({ address: receipt.contractAddress, abi: artifactValue.abi, functionName: "verifyingSigner" }),
  publicClient.readContract({ address: receipt.contractAddress, abi: artifactValue.abi, functionName: "registry" }),
  publicClient.readContract({ address: receipt.contractAddress, abi: artifactValue.abi, functionName: "router" }),
  publicClient.readContract({ address: receipt.contractAddress, abi: artifactValue.abi, functionName: "usdt0" }),
  publicClient.readContract({ address: receipt.contractAddress, abi: artifactValue.abi, functionName: "maxExitCost" }),
]);
if (configuredOwner.toLowerCase() !== deployer.address.toLowerCase() || configuredSigner.toLowerCase() !== sponsor.address.toLowerCase() || configuredRegistry.toLowerCase() !== registry.toLowerCase() || configuredRouter.toLowerCase() !== router.toLowerCase() || configuredUsdt0.toLowerCase() !== usdt0.toLowerCase() || configuredMaxCost !== maxExitCost) throw new Error("deployed exit paymaster configuration read-back mismatch");
console.log(JSON.stringify({ chainId, deployer: deployer.address, sponsorSigner: sponsor.address, address: receipt.contractAddress, transactionHash: txHash, blockNumber: receipt.blockNumber.toString(), maxExitCostWei: maxExitCost.toString() }, null, 2));
