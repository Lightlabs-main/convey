import {
  decodeAbiParameters,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  stringToBytes,
} from "viem";
import { JsonRpcClient, asRpcQuantity } from "./rpc.ts";
import type { Address, Hex, PackedUserOperation } from "./types.ts";
import { assertAddress, assertPackedUserOperation, assertUserOperationHash, isHex } from "./types.ts";

const ENTRYPOINT_ABI = [
  {
    type: "function",
    name: "getUserOpHash",
    stateMutability: "view",
    inputs: [
      {
        name: "userOp",
        type: "tuple",
        components: [
          { name: "sender", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "initCode", type: "bytes" },
          { name: "callData", type: "bytes" },
          { name: "accountGasLimits", type: "bytes32" },
          { name: "preVerificationGas", type: "uint256" },
          { name: "gasFees", type: "bytes32" },
          { name: "paymasterAndData", type: "bytes" },
          { name: "signature", type: "bytes" },
        ],
      },
    ],
    outputs: [{ name: "userOpHash", type: "bytes32" }],
  },
  {
    type: "function",
    name: "handleOps",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "ops",
        type: "tuple[]",
        components: [
          { name: "sender", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "initCode", type: "bytes" },
          { name: "callData", type: "bytes" },
          { name: "accountGasLimits", type: "bytes32" },
          { name: "preVerificationGas", type: "uint256" },
          { name: "gasFees", type: "bytes32" },
          { name: "paymasterAndData", type: "bytes" },
          { name: "signature", type: "bytes" },
        ],
      },
      { name: "beneficiary", type: "address" },
    ],
    outputs: [],
  },
] as const;

export const USER_OPERATION_EVENT_TOPIC = keccak256(stringToBytes(
  "UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)",
)) as Hex;
export const USER_OPERATION_REVERT_REASON_TOPIC = keccak256(stringToBytes(
  "UserOperationRevertReason(bytes32,address,uint256,bytes)",
)) as Hex;

/**
 * OKBund's execution RPC supports geth JavaScript tracers. This tracer returns
 * LOG opcodes only; EntryPoint's UserOperationEvent and
 * UserOperationRevertReason then provide the inner execution result that an
 * outer handleOps eth_call does not expose.
 */
interface CallFrame {
  error?: string;
  logs?: { topics?: unknown; data?: unknown }[];
  calls?: CallFrame[];
}

/**
 * Collects event logs from the node's built-in callTracer (withLog), keeping
 * only logs from frames that did not revert, because reverted frames' events
 * never reach the chain. The built-in tracer replaces an earlier custom JS
 * tracer whose memory decoding misread UserOperationEvent data on claims that
 * deploy the receiver's account.
 */
export function logsFromCallTrace(frame: CallFrame): { topics: unknown; data: unknown }[] {
  if (frame.error) return [];
  const logs = (frame.logs ?? []).map((log) => ({ topics: log.topics, data: log.data }));
  for (const call of frame.calls ?? []) logs.push(...logsFromCallTrace(call));
  return logs;
}

export interface EntryPointSimulationResult {
  userOperationHash: Hex;
  success: boolean;
  actualGasCost: bigint;
  actualGasUsed: bigint;
  revertReason?: Hex;
}

export interface EntryPointSimulationOptions {
  executionRpcUrl: string;
  entryPoint: Address;
  beneficiary: Address;
  userOperation: PackedUserOperation;
  userOperationHash?: Hex;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  traceGasLimit?: bigint;
}

function logObjects(trace: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(trace)) {
    return trace.filter((value): value is Record<string, unknown> => !!value && typeof value === "object");
  }
  const logs = trace && typeof trace === "object" ? (trace as Record<string, unknown>).logs : undefined;
  if (Array.isArray(logs)) {
    return logs.filter(
      (value): value is Record<string, unknown> => !!value && typeof value === "object",
    );
  }
  throw new Error("EntryPoint trace did not return a log collection");
}

function topicsOf(log: Record<string, unknown>): Hex[] | undefined {
  if (!Array.isArray(log.topics) || !log.topics.every(isHex)) return undefined;
  return log.topics as Hex[];
}

function dataOf(log: Record<string, unknown>): Hex | undefined {
  return isHex(log.data) ? log.data : undefined;
}

function matchingLog(log: Record<string, unknown>, topic: Hex, userOperationHash: Hex): boolean {
  const topics = topicsOf(log);
  return !!topics
    && topics.length >= 2
    && topics[0].toLowerCase() === topic.toLowerCase()
    && topics[1].toLowerCase() === userOperationHash.toLowerCase();
}

function decodeUserOperationEvent(data: Hex): Pick<EntryPointSimulationResult, "success" | "actualGasCost" | "actualGasUsed"> {
  try {
    const [nonce, success, actualGasCost, actualGasUsed] = decodeAbiParameters(
      [
        { type: "uint256" },
        { type: "bool" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      data,
    );
    if (typeof nonce !== "bigint" || typeof success !== "boolean" || typeof actualGasCost !== "bigint" || typeof actualGasUsed !== "bigint") {
      throw new Error("unexpected UserOperationEvent field types");
    }
    return { success, actualGasCost, actualGasUsed };
  } catch {
    throw new Error("EntryPoint trace contained malformed UserOperationEvent data");
  }
}

function decodeRevertReason(data: Hex): Hex {
  try {
    const [reason] = decodeAbiParameters([{ type: "bytes" }], data);
    if (typeof reason !== "string" || !isHex(reason)) throw new Error("unexpected revert reason type");
    return reason;
  } catch {
    throw new Error("EntryPoint trace contained malformed UserOperationRevertReason data");
  }
}

/**
 * Decodes only the EntryPoint events for one operation. A successful outer
 * handleOps call is not enough: EntryPoint deliberately emits a failed event
 * for an inner operation that reverted.
 */
export function parseEntryPointSimulationTrace(trace: unknown, userOperationHash: Hex): EntryPointSimulationResult {
  assertUserOperationHash(userOperationHash);
  let event: Pick<EntryPointSimulationResult, "success" | "actualGasCost" | "actualGasUsed"> | undefined;
  let revertReason: Hex | undefined;

  for (const log of logObjects(trace)) {
    if (matchingLog(log, USER_OPERATION_EVENT_TOPIC, userOperationHash)) {
      if (event) throw new Error("EntryPoint trace contained duplicate UserOperationEvent entries");
      const data = dataOf(log);
      if (!data) throw new Error("EntryPoint trace contained UserOperationEvent without data");
      event = decodeUserOperationEvent(data);
      continue;
    }
    if (matchingLog(log, USER_OPERATION_REVERT_REASON_TOPIC, userOperationHash)) {
      const data = dataOf(log);
      if (!data) throw new Error("EntryPoint trace contained UserOperationRevertReason without data");
      revertReason = decodeRevertReason(data);
    }
  }

  if (!event) throw new Error("EntryPoint trace did not emit a UserOperationEvent for the requested operation");
  return { userOperationHash, ...event, ...(revertReason ? { revertReason } : {}) };
}

export function assertSuccessfulEntryPointSimulation(result: EntryPointSimulationResult): EntryPointSimulationResult {
  if (!result.success) {
    const suffix = result.revertReason ? ` (${result.revertReason.slice(0, 10)})` : "";
    throw new Error(`EntryPoint simulation reported UserOperation failure${suffix}`);
  }
  return result;
}

export function encodeEntryPointHandleOps(userOperation: PackedUserOperation, beneficiary: Address): Hex {
  assertPackedUserOperation(userOperation);
  assertAddress(beneficiary, "beneficiary");
  return encodeFunctionData({
    abi: ENTRYPOINT_ABI,
    functionName: "handleOps",
    args: [[{
      sender: userOperation.sender,
      nonce: userOperation.nonce,
      initCode: userOperation.initCode,
      callData: userOperation.callData,
      accountGasLimits: userOperation.accountGasLimits,
      preVerificationGas: userOperation.preVerificationGas,
      gasFees: userOperation.gasFees,
      paymasterAndData: userOperation.paymasterAndData,
      signature: userOperation.signature,
    }], beneficiary],
  }) as Hex;
}

export async function getEntryPointUserOperationHash(
  rpc: JsonRpcClient,
  entryPoint: Address,
  userOperation: PackedUserOperation,
): Promise<Hex> {
  assertAddress(entryPoint, "entryPoint");
  assertPackedUserOperation(userOperation);
  const data = encodeFunctionData({
    abi: ENTRYPOINT_ABI,
    functionName: "getUserOpHash",
    args: [{
      sender: userOperation.sender,
      nonce: userOperation.nonce,
      initCode: userOperation.initCode,
      callData: userOperation.callData,
      accountGasLimits: userOperation.accountGasLimits,
      preVerificationGas: userOperation.preVerificationGas,
      gasFees: userOperation.gasFees,
      paymasterAndData: userOperation.paymasterAndData,
      signature: userOperation.signature,
    }],
  });
  const result = await rpc.request<unknown>("eth_call", [{ to: entryPoint, data }, "latest"]);
  if (!isHex(result) || result.length !== 66) throw new Error("EntryPoint returned an invalid UserOperation hash");
  return result;
}

/** Simulates the exact operation through EntryPoint and requires inner success. */
export async function preflightEntryPointUserOperation(options: EntryPointSimulationOptions): Promise<EntryPointSimulationResult> {
  assertAddress(options.entryPoint, "entryPoint");
  assertAddress(options.beneficiary, "beneficiary");
  assertPackedUserOperation(options.userOperation);
  const data = encodeEntryPointHandleOps(options.userOperation, options.beneficiary);
  const rpc = new JsonRpcClient(options.executionRpcUrl, {
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
  });
  const userOperationHash = options.userOperationHash
    ? (assertUserOperationHash(options.userOperationHash), options.userOperationHash)
    : await getEntryPointUserOperationHash(rpc, options.entryPoint, options.userOperation);
  const trace = await rpc.request<unknown>("debug_traceCall", [
    {
      from: options.beneficiary,
      to: options.entryPoint,
      gas: asRpcQuantity(options.traceGasLimit ?? 100_000_000n),
      data,
    },
    "latest",
    { tracer: "callTracer", tracerConfig: { withLog: true } },
  ]);
  const frame = trace as CallFrame;
  if (!frame || typeof frame !== "object") throw new Error("EntryPoint trace did not return a call frame");
  if (frame.error) throw new Error(`EntryPoint simulation reverted: ${frame.error}`);
  return assertSuccessfulEntryPointSimulation(parseEntryPointSimulationTrace({ logs: logsFromCallTrace(frame) }, userOperationHash));
}
