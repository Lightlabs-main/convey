import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ENTRY_POINT = "0x0000000071727de22e5e9d8baf0edac6f37da032" as Address;
const CHAIN_ID = 196;

const paymasterAbi = [
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "entryPoint", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "minimumReserve", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxClaimCost", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
  { type: "function", name: "addStake", stateMutability: "payable", inputs: [{ name: "unstakeDelaySec", type: "uint32" }], outputs: [] },
] as const;

const entryPointAbi = [{
  type: "function",
  name: "getDepositInfo",
  stateMutability: "view",
  inputs: [{ name: "account", type: "address" }],
  outputs: [{ name: "info", type: "tuple", components: [
    { name: "deposit", type: "uint256" },
    { name: "staked", type: "bool" },
    { name: "stake", type: "uint112" },
    { name: "unstakeDelaySec", type: "uint32" },
    { name: "withdrawTime", type: "uint48" },
  ] }],
}] as const;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function uint(name: string, bits = 256): bigint {
  let value: bigint;
  try {
    value = BigInt(required(name));
  } catch {
    throw new Error(`${name} must be an integer in base 10 or 0x form`);
  }
  if (value <= 0n || value >= (1n << BigInt(bits))) throw new Error(`${name} must be a positive uint${bits}`);
  return value;
}

const rpcUrl = required("XLAYER_RPC_URL");
const rawPaymaster = required("CONVEY_CLAIM_PAYMASTER_ADDRESS");
if (!/^0x[0-9a-fA-F]{40}$/.test(rawPaymaster)) throw new Error("CONVEY_CLAIM_PAYMASTER_ADDRESS must be a 20-byte address");
const paymaster = rawPaymaster as Address;
const deployerKey = required("DEPLOYER_PRIVATE_KEY");
if (!/^0x[0-9a-fA-F]{64}$/.test(deployerKey)) throw new Error("DEPLOYER_PRIVATE_KEY must be a 32-byte private key");
const owner = privateKeyToAccount(deployerKey as `0x${string}`);
const targetDeposit = uint("CLAIM_PAYMASTER_DEPOSIT_WEI");
const targetStake = uint("CLAIM_PAYMASTER_STAKE_WEI");
const unstakeDelay = uint("CLAIM_PAYMASTER_STAKE_UNSTAKE_DELAY_SEC", 32);
if (unstakeDelay > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("CLAIM_PAYMASTER_STAKE_UNSTAKE_DELAY_SEC is too large");

const chain = {
  id: CHAIN_ID,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
} as const;
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account: owner, chain, transport: http(rpcUrl) });

const [chainId, contractOwner, configuredEntryPoint, minimumReserve, maxClaimCost, depositInfo] = await Promise.all([
  publicClient.getChainId(),
  publicClient.readContract({ address: paymaster, abi: paymasterAbi, functionName: "owner" }),
  publicClient.readContract({ address: paymaster, abi: paymasterAbi, functionName: "entryPoint" }),
  publicClient.readContract({ address: paymaster, abi: paymasterAbi, functionName: "minimumReserve" }),
  publicClient.readContract({ address: paymaster, abi: paymasterAbi, functionName: "maxClaimCost" }),
  publicClient.readContract({ address: ENTRY_POINT, abi: entryPointAbi, functionName: "getDepositInfo", args: [paymaster] }),
]);
if (chainId !== CHAIN_ID) throw new Error(`execution RPC returned chain ${chainId}, expected ${CHAIN_ID}`);
if (configuredEntryPoint.toLowerCase() !== ENTRY_POINT.toLowerCase()) throw new Error("claim paymaster uses an unexpected EntryPoint");
if (contractOwner.toLowerCase() !== owner.address.toLowerCase()) throw new Error("DEPLOYER_PRIVATE_KEY is not the product paymaster owner");
if (minimumReserve < maxClaimCost || maxClaimCost === 0n) throw new Error("deployed claim paymaster has invalid reserve policy");

let depositTransactionHash: `0x${string}` | undefined;
if (depositInfo.deposit < targetDeposit) {
  depositTransactionHash = await walletClient.writeContract({
    address: paymaster,
    abi: paymasterAbi,
    functionName: "deposit",
    value: targetDeposit - depositInfo.deposit,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: depositTransactionHash });
  if (receipt.status !== "success") throw new Error(`claim paymaster deposit failed in transaction ${depositTransactionHash}`);
}

let stakeTransactionHash: `0x${string}` | undefined;
if (!depositInfo.staked || depositInfo.stake < targetStake) {
  stakeTransactionHash = await walletClient.writeContract({
    address: paymaster,
    abi: paymasterAbi,
    functionName: "addStake",
    args: [Number(unstakeDelay)],
    value: depositInfo.stake >= targetStake ? 0n : targetStake - depositInfo.stake,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: stakeTransactionHash });
  if (receipt.status !== "success") throw new Error(`claim paymaster stake failed in transaction ${stakeTransactionHash}`);
}

const finalInfo = await publicClient.readContract({
  address: ENTRY_POINT,
  abi: entryPointAbi,
  functionName: "getDepositInfo",
  args: [paymaster],
});
if (finalInfo.deposit < targetDeposit || !finalInfo.staked || finalInfo.stake < targetStake) {
  throw new Error("EntryPoint did not retain the requested claim paymaster deposit and stake");
}

console.log(JSON.stringify({
  chainId,
  paymaster,
  depositWei: finalInfo.deposit.toString(),
  stakeWei: finalInfo.stake.toString(),
  staked: finalInfo.staked,
  unstakeDelaySec: finalInfo.unstakeDelaySec,
  depositTransactionHash,
  stakeTransactionHash,
}, null, 2));
