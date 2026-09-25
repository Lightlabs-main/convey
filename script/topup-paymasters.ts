import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { planPaymasterTopUp, type PaymasterTopUpPlan } from "../src/relayer/operations.ts";

const ENTRY_POINT = "0x0000000071727de22e5e9d8baf0edac6f37da032" as Address;
const CHAIN_ID = 196;
const PAYMASTER_ABI = [
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "entryPoint", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
  { type: "function", name: "addStake", stateMutability: "payable", inputs: [{ name: "unstakeDelaySec", type: "uint32" }], outputs: [] },
] as const;
const ENTRY_POINT_ABI = [{
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

type TargetName = "claim" | "exit";
interface Target {
  name: TargetName;
  address: Address;
  depositWei: bigint;
  stakeWei: bigint;
  unstakeDelaySec: number;
}

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

function positiveUint(name: string, bits = 256): bigint {
  let value: bigint;
  try {
    value = BigInt(required(name));
  } catch {
    throw new Error(`${name} must be a positive integer in wei`);
  }
  if (value <= 0n || value >= (1n << BigInt(bits))) throw new Error(`${name} must be a positive uint${bits}`);
  return value;
}

function delay(name: string): number {
  const value = positiveUint(name, 32);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${name} is too large`);
  return Number(value);
}

function selectedTargets(): Target[] {
  const selection = required("CONVEY_TOPUP_TARGET").toLowerCase();
  if (selection !== "claim" && selection !== "exit" && selection !== "both") {
    throw new Error("CONVEY_TOPUP_TARGET must be claim, exit, or both");
  }
  const targets: Target[] = [];
  if (selection === "claim" || selection === "both") {
    targets.push({
      name: "claim",
      address: address("CONVEY_CLAIM_PAYMASTER_ADDRESS"),
      depositWei: positiveUint("CLAIM_PAYMASTER_DEPOSIT_WEI"),
      stakeWei: positiveUint("CLAIM_PAYMASTER_STAKE_WEI"),
      unstakeDelaySec: delay("CLAIM_PAYMASTER_STAKE_UNSTAKE_DELAY_SEC"),
    });
  }
  if (selection === "exit" || selection === "both") {
    targets.push({
      name: "exit",
      address: address("CONVEY_EXIT_PAYMASTER_ADDRESS"),
      depositWei: positiveUint("EXIT_PAYMASTER_DEPOSIT_WEI"),
      stakeWei: positiveUint("EXIT_PAYMASTER_STAKE_WEI"),
      unstakeDelaySec: delay("EXIT_PAYMASTER_STAKE_UNSTAKE_DELAY_SEC"),
    });
  }
  return targets;
}

function writeEnabled(): boolean {
  return process.argv.includes("--confirm") && process.env.CONVEY_TOPUP_CONFIRM === "I_UNDERSTAND_MAINNET_WRITE";
}

const rpcUrl = required("XLAYER_RPC_URL");
const owner = privateKeyToAccount(required("DEPLOYER_PRIVATE_KEY") as Hex);
const chain = { id: CHAIN_ID, name: "X Layer", nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } } as const;
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account: owner, chain, transport: http(rpcUrl) });
const targets = selectedTargets();
const snapshots: Array<{ target: Target; current: { depositWei: bigint; stakeWei: bigint; staked: boolean; unstakeDelaySec: bigint }; plan: PaymasterTopUpPlan }> = [];

if (await publicClient.getChainId() !== CHAIN_ID) throw new Error(`execution RPC is not X Layer chain ${CHAIN_ID}`);
for (const target of targets) {
  const [configuredOwner, configuredEntryPoint, info] = await Promise.all([
    publicClient.readContract({ address: target.address, abi: PAYMASTER_ABI, functionName: "owner" }),
    publicClient.readContract({ address: target.address, abi: PAYMASTER_ABI, functionName: "entryPoint" }),
    publicClient.readContract({ address: ENTRY_POINT, abi: ENTRY_POINT_ABI, functionName: "getDepositInfo", args: [target.address] }),
  ]);
  if (configuredOwner.toLowerCase() !== owner.address.toLowerCase()) throw new Error(`${target.name} paymaster owner does not match DEPLOYER_PRIVATE_KEY`);
  if (configuredEntryPoint.toLowerCase() !== ENTRY_POINT.toLowerCase()) throw new Error(`${target.name} paymaster uses an unexpected EntryPoint`);
  const current = { depositWei: info.deposit, stakeWei: info.stake, staked: info.staked, unstakeDelaySec: info.unstakeDelaySec };
  snapshots.push({ target, current, plan: planPaymasterTopUp(current, target) });
}

const summary = snapshots.map(({ target, current, plan }) => ({
  target: target.name,
  paymaster: target.address,
  currentDepositWei: current.depositWei.toString(),
  targetDepositWei: target.depositWei.toString(),
  currentStakeWei: current.stakeWei.toString(),
  targetStakeWei: target.stakeWei.toString(),
  staked: current.staked,
  unstakeDelaySec: current.unstakeDelaySec.toString(),
  depositTopUpWei: plan.depositWei.toString(),
  stakeTopUpWei: plan.stakeWei.toString(),
  writeEnabled: writeEnabled(),
}));
if (!writeEnabled()) {
  console.log(JSON.stringify({ chainId: CHAIN_ID, owner: owner.address, writeEnabled: false, summary }, null, 2));
  process.exit(0);
}

const transactions: Array<{ target: TargetName; kind: "deposit" | "stake"; hash: Hex }> = [];
for (const { target, plan } of snapshots) {
  if (plan.depositWei > 0n) {
    const hash = await walletClient.writeContract({ address: target.address, abi: PAYMASTER_ABI, functionName: "deposit", value: plan.depositWei });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${target.name} deposit failed in transaction ${hash}`);
    transactions.push({ target: target.name, kind: "deposit", hash });
  }
  if (plan.needsStake) {
    const hash = await walletClient.writeContract({ address: target.address, abi: PAYMASTER_ABI, functionName: "addStake", args: [target.unstakeDelaySec], value: plan.stakeWei });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${target.name} stake failed in transaction ${hash}`);
    transactions.push({ target: target.name, kind: "stake", hash });
  }
}
console.log(JSON.stringify({ chainId: CHAIN_ID, owner: owner.address, writeEnabled: true, summary, transactions }, null, 2));
