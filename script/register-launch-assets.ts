import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const CHAIN_ID = 196;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

const registryAbi = [
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "assetExists",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "getAsset",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "entry", type: "tuple", components: [
      { name: "token", type: "address" },
      { name: "kind", type: "uint8" },
      { name: "decimals", type: "uint8" },
      { name: "isWrapped", type: "bool" },
      { name: "underlying", type: "address" },
      { name: "valuation", type: "uint8" },
      { name: "valuationRef", type: "address" },
      { name: "cashOutRoute", type: "address" },
      { name: "certified", type: "bool" },
      { name: "enabled", type: "bool" },
      { name: "riskTag", type: "string" },
    ] }],
  },
  {
    type: "function",
    name: "registerAsset",
    stateMutability: "nonpayable",
    inputs: [{ name: "entry", type: "tuple", components: [
      { name: "token", type: "address" },
      { name: "kind", type: "uint8" },
      { name: "decimals", type: "uint8" },
      { name: "isWrapped", type: "bool" },
      { name: "underlying", type: "address" },
      { name: "valuation", type: "uint8" },
      { name: "valuationRef", type: "address" },
      { name: "cashOutRoute", type: "address" },
      { name: "certified", type: "bool" },
      { name: "enabled", type: "bool" },
      { name: "riskTag", type: "string" },
    ] }],
    outputs: [],
  },
] as const;

type Asset = {
  symbol: string;
  token: Address;
  underlying: Address;
  cashOutRoute: Address;
  riskTag: string;
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function address(name: string): Address {
  const value = required(name);
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${name} must be a 20-byte address`);
  return value as Address;
}

function privateKey(name: string): Hex {
  const value = required(name);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${name} must be a 32-byte private key`);
  return value as Hex;
}

const rpcUrl = required("XLAYER_RPC_URL");
const registry = address("CONVEY_ASSET_REGISTRY_ADDRESS");
const owner = privateKeyToAccount(privateKey("DEPLOYER_PRIVATE_KEY"));
const router = address("CONVEY_UNISWAP_SWAP_ROUTER_ADDRESS");
const assets: Asset[] = [
  {
    symbol: "NVDAx",
    token: address("CONVEY_WNVDA_TOKEN_ADDRESS"),
    underlying: address("CONVEY_WNVDA_UNDERLYING_ADDRESS"),
    cashOutRoute: router,
    riskTag: "economic exposure to Nvidia; wrapped xStock; not company ownership",
  },
  {
    symbol: "TSLAx",
    token: address("CONVEY_WTSLA_TOKEN_ADDRESS"),
    underlying: address("CONVEY_WTSLA_UNDERLYING_ADDRESS"),
    cashOutRoute: ZERO,
    riskTag: "economic exposure to Tesla; wrapped xStock; thin cash-out liquidity",
  },
  {
    symbol: "AAPLx",
    token: address("CONVEY_WAAPL_TOKEN_ADDRESS"),
    underlying: address("CONVEY_WAAPL_UNDERLYING_ADDRESS"),
    cashOutRoute: router,
    riskTag: "economic exposure to Apple; wrapped xStock; not company ownership",
  },
];

const chain = {
  id: CHAIN_ID,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
} as const;
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account: owner, chain, transport: http(rpcUrl) });
if (await publicClient.getChainId() !== CHAIN_ID) throw new Error("execution RPC is not X Layer mainnet");
if ((await publicClient.readContract({ address: registry, abi: registryAbi, functionName: "owner" })) !== owner.address) {
  throw new Error("DEPLOYER_PRIVATE_KEY is not the AssetRegistry owner");
}
if ((await publicClient.getCode({ address: router })) === "0x") throw new Error("configured cash-out router has no bytecode");

let nonce = await publicClient.getTransactionCount({ address: owner.address, blockTag: "pending" });
const receipts: Array<{ symbol: string; transactionHash?: Hex; blockNumber?: string; status: string }> = [];
for (const asset of assets) {
  const exists = await publicClient.readContract({ address: registry, abi: registryAbi, functionName: "assetExists", args: [asset.token] });
  if (exists) {
    const entry = await publicClient.readContract({ address: registry, abi: registryAbi, functionName: "getAsset", args: [asset.token] });
    if (
      entry.token.toLowerCase() !== asset.token.toLowerCase() ||
      entry.kind !== 0 || entry.decimals !== 18 || !entry.isWrapped ||
      entry.underlying.toLowerCase() !== asset.underlying.toLowerCase() ||
      entry.valuation !== 1 || entry.cashOutRoute.toLowerCase() !== asset.cashOutRoute.toLowerCase() ||
      !entry.certified || !entry.enabled
    ) throw new Error(`${asset.symbol} is already registered with a different policy`);
    receipts.push({ symbol: asset.symbol, status: "already_registered" });
    continue;
  }

  const transactionHash = await walletClient.writeContract({
    address: registry,
    abi: registryAbi,
    functionName: "registerAsset",
    args: [{
      token: asset.token,
      kind: 0,
      decimals: 18,
      isWrapped: true,
      underlying: asset.underlying,
      valuation: 1,
      valuationRef: ZERO,
      cashOutRoute: asset.cashOutRoute,
      certified: true,
      enabled: true,
      riskTag: asset.riskTag,
    }],
    nonce: nonce++,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash });
  if (receipt.status !== "success") throw new Error(`${asset.symbol} registration failed in ${transactionHash}`);
  receipts.push({ symbol: asset.symbol, transactionHash, blockNumber: receipt.blockNumber.toString(), status: "registered" });
}

console.log(JSON.stringify({ chainId: CHAIN_ID, registry, owner: owner.address, router, assets: receipts }, null, 2));
