import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ENTRY_POINT = "0x0000000071727de22e5e9d8baf0edac6f37da032" as Address;
const CHAIN_ID = 196;

const paymasterAbi = [
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "maxCostCap", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
  { type: "function", name: "addStake", stateMutability: "payable", inputs: [{ name: "unstakeDelaySec", type: "uint32" }], outputs: [] },
] as const;

const entryPointAbi = [
  {
    type: "function", name: "getDepositInfo", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "info", type: "tuple", components: [
      { name: "deposit", type: "uint256" }, { name: "staked", type: "bool" },
      { name: "stake", type: "uint112" }, { name: "unstakeDelaySec", type: "uint32" },
      { name: "withdrawTime", type: "uint48" },
    ] }],
  },
] as const;

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
  if (value < 0n || value >= (1n << BigInt(bits))) {
    throw new Error(`${name} must fit uint${bits}`);
  }
  return value;
}

const rpcUrl = required("XLAYER_RPC_URL");
const rawPaymaster = required("BOOTSTRAP_PAYMASTER_ADDRESS");
if (!/^0x[0-9a-fA-F]{40}$/.test(rawPaymaster)) throw new Error("BOOTSTRAP_PAYMASTER_ADDRESS must be a 20-byte address");
const paymaster = rawPaymaster as Address;
const deployerKey = required("DEPLOYER_PRIVATE_KEY");
if (!/^0x[0-9a-fA-F]{64}$/.test(deployerKey)) throw new Error("DEPLOYER_PRIVATE_KEY must be a 32-byte private key");
const owner = privateKeyToAccount(deployerKey as `0x${string}`);
const targetDeposit = uint("BOOTSTRAP_ENTRYPOINT_DEPOSIT_WEI");
const targetStake = uint("BOOTSTRAP_STAKE_WEI");
const unstakeDelay = uint("BOOTSTRAP_STAKE_UNSTAKE_DELAY_SEC", 32);
if (targetDeposit === 0n || targetStake === 0n || unstakeDelay === 0n) {
  throw new Error("bootstrap deposit, stake, and unstake delay must all be greater than zero");
}

const chain = {
  id: CHAIN_ID,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
} as const;
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account: owner, chain, transport: http(rpcUrl) });
const [chainId, contractOwner, maxCostCap, depositInfo] = await Promise.all([
  publicClient.getChainId(),
  publicClient.readContract({ address: paymaster, abi: paymasterAbi, functionName: "owner" }),
  publicClient.readContract({ address: paymaster, abi: paymasterAbi, functionName: "maxCostCap" }),
  publicClient.readContract({ address: ENTRY_POINT, abi: entryPointAbi, functionName: "getDepositInfo", args: [paymaster] }),
]);
if (chainId !== CHAIN_ID) throw new Error(`execution RPC returned chain ${chainId}, expected ${CHAIN_ID}`);
if (contractOwner.toLowerCase() !== owner.address.toLowerCase()) {
  throw new Error("DEPLOYER_PRIVATE_KEY is not the deployed paymaster owner");
}
if (targetDeposit > maxCostCap) {
  throw new Error("BOOTSTRAP_ENTRYPOINT_DEPOSIT_WEI exceeds the contract's deposit() guard");
}
if (targetStake < uint("PAYMASTER_MIN_STAKE_WEI")) {
  throw new Error("BOOTSTRAP_STAKE_WEI is below PAYMASTER_MIN_STAKE_WEI");
}

let depositTransactionHash: `0x${string}` | undefined;
if (depositInfo.deposit < targetDeposit) {
  const amount = targetDeposit - depositInfo.deposit;
  if (depositInfo.deposit + amount > maxCostCap) throw new Error("deposit through paymaster would exceed its deposit() guard");
  depositTransactionHash = await walletClient.writeContract({
    address: paymaster,
    abi: paymasterAbi,
    functionName: "deposit",
    value: amount,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: depositTransactionHash });
  if (receipt.status !== "success") throw new Error(`bootstrap deposit failed in transaction ${depositTransactionHash}`);
}

let stakeTransactionHash: `0x${string}` | undefined;
if (!depositInfo.staked || depositInfo.stake < targetStake) {
  const amount = depositInfo.stake >= targetStake ? 0n : targetStake - depositInfo.stake;
  stakeTransactionHash = await walletClient.writeContract({
    address: paymaster,
    abi: paymasterAbi,
    functionName: "addStake",
    args: [Number(unstakeDelay)],
    value: amount,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: stakeTransactionHash });
  if (receipt.status !== "success") throw new Error(`bootstrap stake failed in transaction ${stakeTransactionHash}`);
}

const finalInfo = await publicClient.readContract({
  address: ENTRY_POINT,
  abi: entryPointAbi,
  functionName: "getDepositInfo",
  args: [paymaster],
});
if (finalInfo.deposit < targetDeposit || !finalInfo.staked || finalInfo.stake < targetStake) {
  throw new Error("EntryPoint did not retain the requested bootstrap deposit and stake");
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
