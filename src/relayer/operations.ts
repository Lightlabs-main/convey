import { encodeFunctionData } from "viem";
import { loadSelfHostedRelayerConfig, type SelfHostedRelayerConfig } from "./config.ts";
import { checkRelayerHealth, type PaymasterDepositInfo, type RelayerHealthReport } from "./health.ts";
import { JsonRpcClient } from "./rpc.ts";
import type { Address, Hex } from "./types.ts";
import { assertAddress } from "./types.ts";

const ENTRY_POINT_ABI = [{
  type: "function",
  name: "getDepositInfo",
  stateMutability: "view",
  inputs: [{ name: "account", type: "address" }],
  outputs: [{ name: "info", type: "tuple", components: [
    { name: "deposit", type: "uint112" },
    { name: "staked", type: "bool" },
    { name: "stake", type: "uint112" },
    { name: "unstakeDelaySec", type: "uint32" },
    { name: "withdrawTime", type: "uint48" },
  ] }],
}] as const;

export interface PaymasterTopUpPlan {
  depositWei: bigint;
  stakeWei: bigint;
  needsStake: boolean;
}

export function planPaymasterTopUp(
  current: Pick<PaymasterDepositInfo, "depositWei" | "stakeWei" | "staked">,
  target: { depositWei: bigint; stakeWei: bigint },
): PaymasterTopUpPlan {
  if (target.depositWei <= 0n || target.stakeWei <= 0n) throw new Error("paymaster targets must be greater than zero");
  return {
    depositWei: current.depositWei >= target.depositWei ? 0n : target.depositWei - current.depositWei,
    stakeWei: current.stakeWei >= target.stakeWei ? 0n : target.stakeWei - current.stakeWei,
    needsStake: !current.staked || current.stakeWei < target.stakeWei,
  };
}

export interface OperationsPaymasterReport {
  address: Address;
  depositWei?: string;
  stakeWei?: string;
  staked?: boolean;
  minimumDepositWei: string;
  minimumStakeWei: string;
  healthy: boolean;
  failures: string[];
}

export interface OperationsReport {
  checkedAt: string;
  chainId: number;
  relayer: RelayerHealthReport;
  exitPaymaster?: OperationsPaymasterReport;
  bundlerWallet?: {
    address: Address;
    balanceWei?: string;
    minimumBalanceWei?: string;
    healthy: boolean;
    failures: string[];
  };
  failures: string[];
  healthy: boolean;
}

function word(data: Hex, index: number): bigint {
  const start = 2 + index * 64;
  return BigInt(`0x${data.slice(start, start + 64)}`);
}

function decodeDepositInfo(data: Hex): PaymasterDepositInfo {
  if (data.length !== 2 + 5 * 64) throw new Error("EntryPoint returned malformed deposit info");
  return {
    depositWei: word(data, 0),
    staked: word(data, 1) !== 0n,
    stakeWei: word(data, 2),
    unstakeDelaySec: word(data, 3),
    withdrawTime: word(data, 4),
  };
}

async function readDepositInfo(rpc: JsonRpcClient, entryPoint: Address, paymaster: Address): Promise<PaymasterDepositInfo> {
  const data = encodeFunctionData({ abi: ENTRY_POINT_ABI, functionName: "getDepositInfo", args: [paymaster] }) as Hex;
  return decodeDepositInfo(await rpc.request<Hex>("eth_call", [{ to: entryPoint, data }, "latest"]));
}

function optionalAddress(env: Record<string, string | undefined>, name: string): Address | undefined {
  const value = env[name]?.trim();
  if (!value) return undefined;
  assertAddress(value, name);
  return value.toLowerCase() as Address;
}

function optionalPositiveBigInt(env: Record<string, string | undefined>, name: string): bigint | undefined {
  const value = env[name]?.trim();
  if (!value) return undefined;
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`${name} must be an integer amount in wei`);
  }
  if (parsed <= 0n) throw new Error(`${name} must be greater than zero`);
  return parsed;
}

export function operationsOptionsFromEnv(env: Record<string, string | undefined> = process.env): {
  exitMinimumDepositWei: bigint;
  exitMinimumStakeWei: bigint;
  bundlerAddress?: Address;
  bundlerMinimumBalanceWei?: bigint;
} {
  const config = loadSelfHostedRelayerConfig(env);
  return {
    exitMinimumDepositWei: optionalPositiveBigInt(env, "CONVEY_EXIT_MIN_DEPOSIT_WEI") ?? config.minimumPaymasterDepositWei,
    exitMinimumStakeWei: optionalPositiveBigInt(env, "CONVEY_EXIT_MIN_STAKE_WEI") ?? config.minimumPaymasterStakeWei,
    bundlerAddress: optionalAddress(env, "CONVEY_BUNDLER_PUBLIC_ADDRESS"),
    bundlerMinimumBalanceWei: optionalPositiveBigInt(env, "CONVEY_BUNDLER_MIN_BALANCE_WEI"),
  };
}

export async function checkConveyOperations(
  config: SelfHostedRelayerConfig,
  options: {
    exitMinimumDepositWei?: bigint;
    exitMinimumStakeWei?: bigint;
    bundlerAddress?: Address;
    bundlerMinimumBalanceWei?: bigint;
  } = {},
): Promise<OperationsReport> {
  const relayer = await checkRelayerHealth(config);
  const execution = new JsonRpcClient(config.executionRpcUrl, { timeoutMs: config.requestTimeoutMs });
  const failures = [...relayer.failures];
  const report: OperationsReport = {
    checkedAt: new Date().toISOString(),
    chainId: config.chainId,
    relayer,
    failures,
    healthy: false,
  };

  if (config.exitPaymaster) {
    const exitFailures: string[] = [];
    const minimumDepositWei = options.exitMinimumDepositWei ?? config.minimumPaymasterDepositWei;
    const minimumStakeWei = options.exitMinimumStakeWei ?? config.minimumPaymasterStakeWei;
    report.exitPaymaster = {
      address: config.exitPaymaster,
      minimumDepositWei: minimumDepositWei.toString(),
      minimumStakeWei: minimumStakeWei.toString(),
      healthy: false,
      failures: exitFailures,
    };
    try {
      const info = await readDepositInfo(execution, config.entryPoint, config.exitPaymaster);
      report.exitPaymaster.depositWei = info.depositWei.toString();
      report.exitPaymaster.stakeWei = info.stakeWei.toString();
      report.exitPaymaster.staked = info.staked;
      if (info.depositWei < minimumDepositWei) exitFailures.push("exit paymaster EntryPoint deposit is below the configured floor");
      if (!info.staked || info.stakeWei < minimumStakeWei) exitFailures.push("exit paymaster EntryPoint stake is below the configured floor");
    } catch {
      exitFailures.push("exit paymaster deposit and stake check failed");
    }
    report.exitPaymaster.healthy = exitFailures.length === 0;
    failures.push(...exitFailures.map((failure) => `exit: ${failure}`));
  }

  if (options.bundlerAddress) {
    const walletFailures: string[] = [];
    report.bundlerWallet = {
      address: options.bundlerAddress,
      minimumBalanceWei: options.bundlerMinimumBalanceWei?.toString(),
      healthy: false,
      failures: walletFailures,
    };
    try {
      const balance = BigInt(await execution.request<Hex>("eth_getBalance", [options.bundlerAddress, "latest"]));
      report.bundlerWallet.balanceWei = balance.toString();
      if (options.bundlerMinimumBalanceWei !== undefined && balance < options.bundlerMinimumBalanceWei) {
        walletFailures.push("bundler wallet balance is below the configured floor");
      }
    } catch {
      walletFailures.push("bundler wallet balance check failed");
    }
    report.bundlerWallet.healthy = walletFailures.length === 0;
    failures.push(...walletFailures.map((failure) => `bundler wallet: ${failure}`));
  }

  report.healthy = failures.length === 0;
  return report;
}

export { ENTRY_POINT_ABI };
