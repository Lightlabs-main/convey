import { encodeFunctionData } from "viem";
import { SelfHostedBundlerClient } from "./bundler.ts";
import { JsonRpcClient } from "./rpc.ts";
import type { Address, Hex } from "./types.ts";

const ENTRY_POINT_ABI = [
  {
    type: "function",
    name: "getDepositInfo",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [
      {
        name: "info",
        type: "tuple",
        components: [
          { name: "deposit", type: "uint112" },
          { name: "staked", type: "bool" },
          { name: "stake", type: "uint112" },
          { name: "unstakeDelaySec", type: "uint32" },
          { name: "withdrawTime", type: "uint48" },
        ],
      },
    ],
  },
] as const;

export interface PaymasterDepositInfo {
  depositWei: bigint;
  staked: boolean;
  stakeWei: bigint;
  unstakeDelaySec: bigint;
  withdrawTime: bigint;
}

export interface RelayerHealthReport {
  healthy: boolean;
  chainId: number;
  bundler: {
    chainId?: number;
    supportedEntryPoints?: Address[];
    entryPointSupported: boolean;
  };
  entryPoint: {
    address: Address;
    codeBytes?: number;
  };
  paymaster: {
    address: Address;
    depositWei?: string;
    stakeWei?: string;
    staked?: boolean;
    minimumDepositWei: string;
    minimumStakeWei: string;
  };
  failures: string[];
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

async function readCode(rpc: JsonRpcClient, address: Address): Promise<number> {
  const code = await rpc.request<Hex>("eth_getCode", [address, "latest"]);
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(code)) throw new Error("execution RPC returned malformed bytecode");
  return (code.length - 2) / 2;
}

async function readDepositInfo(rpc: JsonRpcClient, entryPoint: Address, paymaster: Address): Promise<PaymasterDepositInfo> {
  const data = encodeFunctionData({
    abi: ENTRY_POINT_ABI,
    functionName: "getDepositInfo",
    args: [paymaster],
  }) as Hex;
  const result = await rpc.request<Hex>("eth_call", [{ to: entryPoint, data }, "latest"]);
  return decodeDepositInfo(result);
}

export async function checkRelayerHealth(config: {
  chainId: number;
  executionRpcUrl: string;
  bundlerRpcUrl: string;
  entryPoint: Address;
  paymaster: Address;
  minimumPaymasterDepositWei: bigint;
  minimumPaymasterStakeWei: bigint;
  requestTimeoutMs: number;
}): Promise<RelayerHealthReport> {
  const execution = new JsonRpcClient(config.executionRpcUrl, { timeoutMs: config.requestTimeoutMs });
  const bundler = new SelfHostedBundlerClient(config.bundlerRpcUrl, config.requestTimeoutMs);
  const failures: string[] = [];
  const report: RelayerHealthReport = {
    healthy: false,
    chainId: config.chainId,
    bundler: { entryPointSupported: false },
    entryPoint: { address: config.entryPoint },
    paymaster: {
      address: config.paymaster,
      minimumDepositWei: config.minimumPaymasterDepositWei.toString(),
      minimumStakeWei: config.minimumPaymasterStakeWei.toString(),
    },
    failures,
  };

  try {
    const chainId = Number(BigInt(await execution.request<Hex>("eth_chainId")));
    if (chainId !== config.chainId) failures.push(`execution RPC is on chain ${chainId}`);
  } catch {
    failures.push("execution RPC chain check failed");
  }

  try {
    const codeBytes = await readCode(execution, config.entryPoint);
    report.entryPoint.codeBytes = codeBytes;
    if (codeBytes === 0) failures.push("configured EntryPoint has no bytecode");
  } catch {
    failures.push("EntryPoint bytecode check failed");
  }

  try {
    const chainId = await bundler.chainId();
    report.bundler.chainId = chainId;
    if (chainId !== config.chainId) failures.push(`private bundler is on chain ${chainId}`);
  } catch {
    failures.push("private bundler chain check failed");
  }

  try {
    const supportedEntryPoints = await bundler.supportedEntryPoints();
    report.bundler.supportedEntryPoints = supportedEntryPoints;
    report.bundler.entryPointSupported = supportedEntryPoints.includes(config.entryPoint.toLowerCase() as Address);
    if (!report.bundler.entryPointSupported) failures.push("private bundler does not support the configured EntryPoint");
  } catch {
    failures.push("private bundler entry-point capability check failed");
  }

  try {
    const info = await readDepositInfo(execution, config.entryPoint, config.paymaster);
    report.paymaster.depositWei = info.depositWei.toString();
    report.paymaster.stakeWei = info.stakeWei.toString();
    report.paymaster.staked = info.staked;
    if (info.depositWei < config.minimumPaymasterDepositWei) failures.push("paymaster EntryPoint deposit is below the configured floor");
    if (!info.staked || info.stakeWei < config.minimumPaymasterStakeWei) failures.push("paymaster EntryPoint stake is below the configured floor");
  } catch {
    failures.push("paymaster deposit and stake check failed");
  }

  report.healthy = failures.length === 0;
  return report;
}
