import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { decodeAbiParameters, decodeFunctionData, encodeFunctionData, keccak256, stringToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { checkRelayerHealth } from "./health.ts";
import { assertClaimExecutionCalldata, decodeClaimExecutionCalldata } from "./claim-policy.ts";
import { encodeClaimPaymasterData, signClaimPaymasterAuthorization } from "./claim-paymaster.ts";
import { assertExitExecutionCalldata, decodeExitCashOutCalldata } from "./exit-policy.ts";
import { encodeExitPaymasterData, exitPaymasterActionHash, signExitPaymasterAuthorization } from "./exit-paymaster.ts";
import { JsonRpcRequestError, JsonRpcTransportError } from "./rpc.ts";
import { JsonRpcClient } from "./rpc.ts";
import { SelfHostedBundlerClient } from "./bundler.ts";
import { fromRpcUserOperation, isAddress, isHex, isQuantity, toQuantity, toRpcUserOperation, type Address, type ClaimGasSeed, type ClaimPaymasterAuthorizationResponse, type ClaimRelayStatus, type ExitPaymasterAuthorizationResponse, type ExitQuote, type Hex, type PackedUserOperation, type RpcUserOperationV07 } from "./types.ts";
import {
  assertSponsoredUserOperation,
  assertRpcUserOperationV07,
  assertUserOperationHash,
} from "./types.ts";
import type { SelfHostedRelayerConfig } from "./config.ts";
import { preflightEntryPointUserOperation } from "./preflight.ts";

class HttpProblem extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

interface ClaimRequest {
  entryPoint: Address;
  userOperation: RpcUserOperationV07;
  idempotencyKey?: string;
}

interface ClaimAuthorizationRequest {
  entryPoint: Address;
  userOperation: RpcUserOperationV07;
}

interface ExitRequest {
  entryPoint: Address;
  userOperation: RpcUserOperationV07;
  idempotencyKey?: string;
}

interface ExitAuthorizationRequest {
  entryPoint: Address;
  userOperation: RpcUserOperationV07;
}

interface ExitQuoteRequest {
  asset: Address;
  amountIn: bigint;
  slippageBps?: number;
}

const CLAIM_PAYMASTER_READ_ABI = [
  {
    type: "function",
    name: "maxExitCost",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "value", type: "uint256" }],
  },
  {
    type: "function",
    name: "maxClaimCost",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "value", type: "uint256" }],
  },
  {
    type: "function",
    name: "verifyingSigner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "value", type: "address" }],
  },
  {
    type: "function",
    name: "getReserve",
    stateMutability: "view",
    inputs: [{ name: "giftId", type: "uint256" }],
    outputs: [
      {
        name: "reserve",
        type: "tuple",
        components: [
          { name: "remaining", type: "uint256" },
          { name: "refundRecipient", type: "address" },
          { name: "account", type: "address" },
          { name: "state", type: "uint8" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "usedSponsorNonces",
    stateMutability: "view",
    inputs: [{ name: "sponsorNonce", type: "uint256" }],
    outputs: [{ name: "used", type: "bool" }],
  },
] as const;

const EXIT_REGISTRY_ABI = [{
  type: "function",
  name: "isGiftable",
  stateMutability: "view",
  inputs: [{ name: "token", type: "address" }],
  outputs: [{ name: "result", type: "bool" }],
}] as const;

const EXIT_QUOTER_ABI = [{
  type: "function",
  name: "quoteExactInput",
  stateMutability: "nonpayable",
  inputs: [{ name: "path", type: "bytes" }, { name: "amountIn", type: "uint256" }],
  outputs: [
    { name: "amountOut", type: "uint256" },
    { name: "sqrtPriceX96AfterList", type: "uint160[]" },
    { name: "initializedTicksCrossedList", type: "uint32[]" },
    { name: "gasEstimate", type: "uint256" },
  ],
}] as const;

const ENTRYPOINT_HANDLE_OPS_ABI = [{
  type: "function",
  name: "handleOps",
  stateMutability: "nonpayable",
  inputs: [{
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
  }, { name: "beneficiary", type: "address" }],
  outputs: [],
}] as const;

const ENTRYPOINT_USER_OPERATION_EVENT_TOPIC = keccak256(stringToBytes("UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)"));
const ENTRYPOINT_STATUS_LOG_LOOKBACK_BLOCKS = 10_000n;

function zeroPaymasterData(value: Hex | undefined): boolean {
  return value === undefined || value === "0x" || value === `0x${"00".repeat(141)}`;
}

function parseClaimAuthorizationRequest(value: unknown, expectedEntryPoint: Address, expectedPaymaster: Address): ClaimAuthorizationRequest {
  if (!isObject(value) || !isObject(value.userOperation) || typeof value.entryPoint !== "string") {
    throw new HttpProblem(400, "invalid_claim_authorization_request");
  }
  if (value.entryPoint.toLowerCase() !== expectedEntryPoint.toLowerCase()) throw new HttpProblem(400, "wrong_entry_point");
  try {
    assertRpcUserOperationV07(value.userOperation);
  } catch {
    throw new HttpProblem(400, "invalid_unsigned_user_operation");
  }
  const userOperation = value.userOperation;
  if (userOperation.signature !== "0x") throw new HttpProblem(400, "authorization_requires_unsigned_operation");
  if (userOperation.paymaster?.toLowerCase() !== expectedPaymaster.toLowerCase()) throw new HttpProblem(400, "wrong_paymaster");
  if (!zeroPaymasterData(userOperation.paymasterData)) throw new HttpProblem(400, "authorization_requires_empty_paymaster_data");
  return { entryPoint: expectedEntryPoint, userOperation };
}

function decodeUint256(data: Hex, name: string): bigint {
  const [value] = decodeAbiParameters([{ type: "uint256" }], data);
  if (typeof value !== "bigint") throw new Error(`paymaster returned invalid ${name}`);
  return value;
}

function decodeAddress(data: Hex, name: string): Address {
  const [value] = decodeAbiParameters([{ type: "address" }], data);
  if (typeof value !== "string" || !isAddress(value)) throw new Error(`paymaster returned invalid ${name}`);
  return value.toLowerCase() as Address;
}

function decodeBool(data: Hex, name: string): boolean {
  const [value] = decodeAbiParameters([{ type: "bool" }], data);
  if (typeof value !== "boolean") throw new Error(`paymaster returned invalid ${name}`);
  return value;
}

function decodeReserve(data: Hex): { remaining: bigint; state: number } {
  const [value] = decodeAbiParameters([{
    type: "tuple",
    components: [
      { name: "remaining", type: "uint256" },
      { name: "refundRecipient", type: "address" },
      { name: "account", type: "address" },
      { name: "state", type: "uint8" },
    ],
  }], data);
  const tuple = value as unknown;
  const remaining = Array.isArray(tuple) ? tuple[0] : tuple && typeof tuple === "object" ? (tuple as Record<string, unknown>).remaining : undefined;
  const state = Array.isArray(tuple) ? tuple[3] : tuple && typeof tuple === "object" ? (tuple as Record<string, unknown>).state : undefined;
  if (typeof remaining !== "bigint" || (typeof state !== "number" && typeof state !== "bigint")) throw new Error("paymaster returned malformed reserve");
  return { remaining, state: Number(state) };
}

async function readPaymasterValue(rpc: JsonRpcClient, paymaster: Address, functionName: "maxClaimCost" | "maxExitCost" | "verifyingSigner"): Promise<bigint | Address> {
  const data = encodeFunctionData({ abi: CLAIM_PAYMASTER_READ_ABI, functionName, args: [] });
  const result = await rpc.request<Hex>("eth_call", [{ to: paymaster, data }, "latest"]);
  return functionName === "verifyingSigner" ? decodeAddress(result, functionName) : decodeUint256(result, functionName);
}

async function readReserve(rpc: JsonRpcClient, paymaster: Address, giftId: bigint): Promise<{ remaining: bigint; state: number }> {
  const data = encodeFunctionData({ abi: CLAIM_PAYMASTER_READ_ABI, functionName: "getReserve", args: [giftId] });
  return decodeReserve(await rpc.request<Hex>("eth_call", [{ to: paymaster, data }, "latest"]));
}

async function readSponsorNonce(rpc: JsonRpcClient, paymaster: Address, sponsorNonce: bigint): Promise<boolean> {
  const data = encodeFunctionData({ abi: CLAIM_PAYMASTER_READ_ABI, functionName: "usedSponsorNonces", args: [sponsorNonce] });
  return decodeBool(await rpc.request<Hex>("eth_call", [{ to: paymaster, data }, "latest"]), "usedSponsorNonce");
}

async function readBlockTimestamp(rpc: JsonRpcClient): Promise<bigint> {
  const block = await rpc.request<{ timestamp?: unknown } | null>("eth_getBlockByNumber", ["latest", false]);
  if (!block || typeof block.timestamp !== "string" || !isQuantity(block.timestamp)) throw new Error("execution RPC returned no live block timestamp");
  return BigInt(block.timestamp);
}

export function maxCostFromUserOperation(userOperation: RpcUserOperationV07): bigint {
  assertRpcUserOperationV07(userOperation);
  if (!userOperation.paymasterVerificationGasLimit || !userOperation.paymasterPostOpGasLimit) {
    throw new Error("claim operation is missing paymaster gas limits");
  }
  const requiredGas = BigInt(userOperation.callGasLimit)
    + BigInt(userOperation.verificationGasLimit)
    + BigInt(userOperation.preVerificationGas)
    + BigInt(userOperation.paymasterVerificationGasLimit)
    + BigInt(userOperation.paymasterPostOpGasLimit);
  const maxFeePerGas = BigInt(userOperation.maxFeePerGas);
  if (requiredGas <= 0n || maxFeePerGas <= 0n) throw new Error("claim operation has no gas exposure");
  // ERC-4337 v0.7 EntryPoint pre-funds the complete account and paymaster
  // gas envelope at maxFeePerGas. This is the value passed to
  // validatePaymasterUserOp and must be the value covered by the signature.
  return requiredGas * maxFeePerGas;
}

export const claimMaxCostFromUserOperation = maxCostFromUserOperation;

function seedOperation(value: unknown): RpcUserOperationV07 {
  const record = isObject(value) && isObject(value.userOperation) ? value.userOperation : value;
  assertRpcUserOperationV07(record);
  return record;
}

function transactionHashOf(value: unknown): Hex | undefined {
  if (!isObject(value) || typeof value.transactionHash !== "string" || !isHex(value.transactionHash)) return undefined;
  return value.transactionHash;
}

function packedSeedFromTransaction(input: Hex, sender: Address, nonce: Hex): RpcUserOperationV07 {
  const decoded = decodeFunctionData({ abi: ENTRYPOINT_HANDLE_OPS_ABI, data: input });
  const operations = decoded.args[0] as readonly unknown[];
  const match = operations.find((value) => {
    if (!value || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    return typeof record.sender === "string"
      && record.sender.toLowerCase() === sender.toLowerCase()
      && typeof record.nonce === "bigint"
      && record.nonce === BigInt(nonce);
  });
  if (!match) throw new Error("bundle transaction did not contain the configured gas seed operation");
  return toRpcUserOperation(match as PackedUserOperation);
}

function json(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(body);
}

function authorized(request: IncomingMessage, token: string | undefined): boolean {
  if (!token) return true;
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function readJson(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new HttpProblem(413, "request_too_large");
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) throw new HttpProblem(413, "request_too_large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) throw new HttpProblem(400, "invalid_json");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpProblem(400, "invalid_json");
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseClaimRequest(value: unknown, expectedEntryPoint: Address, expectedPaymaster: Address): ClaimRequest {
  if (!isObject(value) || !isObject(value.userOperation) || typeof value.entryPoint !== "string") {
    throw new HttpProblem(400, "invalid_claim_request");
  }
  if (value.entryPoint.toLowerCase() !== expectedEntryPoint.toLowerCase()) throw new HttpProblem(400, "wrong_entry_point");
  try {
    assertSponsoredUserOperation(value.userOperation);
  } catch {
    throw new HttpProblem(400, "invalid_sponsored_user_operation");
  }
  if (value.userOperation.paymaster!.toLowerCase() !== expectedPaymaster.toLowerCase()) {
    throw new HttpProblem(400, "wrong_paymaster");
  }
  if (value.idempotencyKey !== undefined && (typeof value.idempotencyKey !== "string" || !/^[\x21-\x7e]{8,128}$/.test(value.idempotencyKey))) {
    throw new HttpProblem(400, "invalid_idempotency_key");
  }
  return {
    entryPoint: expectedEntryPoint,
    userOperation: value.userOperation,
    idempotencyKey: value.idempotencyKey as string | undefined,
  };
}

function parseExitAuthorizationRequest(value: unknown, expectedEntryPoint: Address, expectedPaymaster: Address): ExitAuthorizationRequest {
  if (!isObject(value) || !isObject(value.userOperation) || typeof value.entryPoint !== "string") throw new HttpProblem(400, "invalid_exit_authorization_request");
  if (value.entryPoint.toLowerCase() !== expectedEntryPoint.toLowerCase()) throw new HttpProblem(400, "wrong_entry_point");
  try {
    assertRpcUserOperationV07(value.userOperation);
  } catch {
    throw new HttpProblem(400, "invalid_unsigned_user_operation");
  }
  const userOperation = value.userOperation;
  if (userOperation.signature !== "0x") throw new HttpProblem(400, "authorization_requires_unsigned_operation");
  if (userOperation.paymaster?.toLowerCase() !== expectedPaymaster.toLowerCase()) throw new HttpProblem(400, "wrong_paymaster");
  if (!zeroPaymasterData(userOperation.paymasterData)) throw new HttpProblem(400, "authorization_requires_empty_paymaster_data");
  return { entryPoint: expectedEntryPoint, userOperation };
}

function parseExitRequest(value: unknown, expectedEntryPoint: Address, expectedPaymaster: Address): ExitRequest {
  if (!isObject(value) || !isObject(value.userOperation) || typeof value.entryPoint !== "string") throw new HttpProblem(400, "invalid_exit_request");
  if (value.entryPoint.toLowerCase() !== expectedEntryPoint.toLowerCase()) throw new HttpProblem(400, "wrong_entry_point");
  try {
    assertSponsoredUserOperation(value.userOperation);
  } catch {
    throw new HttpProblem(400, "invalid_sponsored_user_operation");
  }
  if (value.userOperation.paymaster!.toLowerCase() !== expectedPaymaster.toLowerCase()) throw new HttpProblem(400, "wrong_paymaster");
  if (value.idempotencyKey !== undefined && (typeof value.idempotencyKey !== "string" || !/^[\x21-\x7e]{8,128}$/.test(value.idempotencyKey))) throw new HttpProblem(400, "invalid_idempotency_key");
  return { entryPoint: expectedEntryPoint, userOperation: value.userOperation, idempotencyKey: value.idempotencyKey as string | undefined };
}

function parseExitQuoteRequest(value: unknown): ExitQuoteRequest {
  if (!isObject(value) || typeof value.asset !== "string" || typeof value.amountIn !== "string") throw new HttpProblem(400, "invalid_exit_quote_request");
  if (!isAddress(value.asset) || !isQuantity(value.amountIn)) throw new HttpProblem(400, "invalid_exit_quote_fields");
  const amountIn = BigInt(value.amountIn);
  if (amountIn <= 0n) throw new HttpProblem(400, "exit_quote_amount_must_be_positive");
  let slippageBps: number | undefined;
  if (value.slippageBps !== undefined) {
    if (typeof value.slippageBps !== "number" || !Number.isInteger(value.slippageBps) || value.slippageBps < 0 || value.slippageBps > 1_000) throw new HttpProblem(400, "invalid_exit_slippage");
    slippageBps = value.slippageBps;
  }
  return { asset: value.asset.toLowerCase() as Address, amountIn, slippageBps };
}

export function statusFromReceipt(userOperationHash: Hex, receipt: any): ClaimRelayStatus {
  if (!receipt) return { userOperationHash, status: "pending" };
  const rawBlockNumber = receipt.receipt?.blockNumber;
  const blockNumber = typeof rawBlockNumber === "string"
    ? rawBlockNumber
    : Number.isSafeInteger(rawBlockNumber) && rawBlockNumber >= 0
      ? `0x${rawBlockNumber.toString(16)}`
      : undefined;
  if (!receipt.receipt || typeof receipt.receipt.transactionHash !== "string" || blockNumber === undefined) {
    throw new Error("private bundler returned a malformed receipt");
  }
  return {
    userOperationHash,
    status: receipt.success === true ? "confirmed" : "failed",
    success: receipt.success === true,
    transactionHash: receipt.receipt.transactionHash,
    blockNumber: blockNumber as Hex,
  };
}

async function statusFromEntryPointEvent(
  execution: JsonRpcClient,
  entryPoint: Address,
  userOperationHash: Hex,
): Promise<ClaimRelayStatus | undefined> {
  try {
    const latestRaw = await execution.request<unknown>("eth_blockNumber");
    if (!isQuantity(latestRaw)) return undefined;
    const latest = BigInt(latestRaw);
    const fromBlock = latest > ENTRYPOINT_STATUS_LOG_LOOKBACK_BLOCKS
      ? latest - ENTRYPOINT_STATUS_LOG_LOOKBACK_BLOCKS
      : 0n;
    const logs = await execution.request<unknown[]>("eth_getLogs", [{
      address: entryPoint,
      fromBlock: toQuantity(fromBlock, "fromBlock"),
      toBlock: "latest",
      topics: [ENTRYPOINT_USER_OPERATION_EVENT_TOPIC, userOperationHash],
    }]);
    if (!Array.isArray(logs)) return undefined;
    for (const value of logs) {
      if (!isObject(value) || !Array.isArray(value.topics) || !isHex(value.data)) continue;
      const topics = value.topics;
      if (typeof topics[1] !== "string" || topics[1].toLowerCase() !== userOperationHash.toLowerCase()) continue;
      if (typeof value.transactionHash !== "string" || !isHex(value.transactionHash)) continue;
      if (typeof value.blockNumber !== "string" || !isQuantity(value.blockNumber)) continue;
      let decoded: readonly unknown[];
      try {
        decoded = decodeAbiParameters([
          { type: "uint256" },
          { type: "bool" },
          { type: "uint256" },
          { type: "uint256" },
        ], value.data);
      } catch {
        continue;
      }
      const success = decoded[1];
      if (typeof success !== "boolean") continue;
      return {
        userOperationHash,
        status: success ? "confirmed" : "failed",
        success,
        transactionHash: value.transactionHash,
        blockNumber: value.blockNumber,
      };
    }
  } catch {
    // A temporary indexing/RPC failure must not turn a pending operation into
    // a false failure. The bundler receipt remains the primary status source.
  }
  return undefined;
}

async function readUserOperationStatus(
  bundler: SelfHostedBundlerClient,
  execution: JsonRpcClient,
  entryPoint: Address,
  userOperationHash: Hex,
): Promise<ClaimRelayStatus> {
  const receipt = await bundler.getUserOperationReceipt(userOperationHash);
  const status = statusFromReceipt(userOperationHash, receipt);
  if (status.status !== "pending") return status;
  return await statusFromEntryPointEvent(execution, entryPoint, userOperationHash) ?? status;
}

function pathOf(request: IncomingMessage): string {
  return new URL(request.url ?? "/", "http://convey-relayer").pathname;
}

export function createRelayerServer(config: SelfHostedRelayerConfig): Server {
  const bundler = new SelfHostedBundlerClient(config.bundlerRpcUrl, config.requestTimeoutMs);
  const execution = new JsonRpcClient(config.executionRpcUrl, { timeoutMs: config.requestTimeoutMs });
  const submissions = new Map<string, { userOperationHash: Hex; expiresAt: number }>();
  const reservedSponsorNonces = new Set<string>();
  const reservedExitSponsorNonces = new Set<string>();
  let sponsorNonceCursor = 0n;
  let exitSponsorNonceCursor = 0n;

  function requireExitConfig(): {
    paymaster: Address;
    signerKey: Hex;
    registry: Address;
    router: Address;
    quoter: Address;
    usdt0: Address;
    routes: readonly { asset: Address; path: Hex }[];
    slippageBps: number;
    deadlineSeconds: number;
  } {
    if (!config.exitPaymaster || !config.exitPaymasterSignerPrivateKey || !config.exitAssetRegistry || !config.exitRouter || !config.exitQuoter || !config.exitUsdt0 || !config.exitRoutePaths || config.exitDefaultSlippageBps === undefined || config.exitDeadlineSeconds === undefined) {
      throw new HttpProblem(503, "exit_sponsor_unavailable");
    }
    return {
      paymaster: config.exitPaymaster,
      signerKey: config.exitPaymasterSignerPrivateKey,
      registry: config.exitAssetRegistry,
      router: config.exitRouter,
      quoter: config.exitQuoter,
      usdt0: config.exitUsdt0,
      routes: config.exitRoutePaths,
      slippageBps: config.exitDefaultSlippageBps,
      deadlineSeconds: config.exitDeadlineSeconds,
    };
  }

  function pruneSubmissions(): void {
    const now = Date.now();
    for (const [key, value] of submissions) if (value.expiresAt <= now) submissions.delete(key);
  }

  async function nextSponsorNonce(): Promise<bigint> {
    for (;;) {
      const candidate = sponsorNonceCursor;
      sponsorNonceCursor += 1n;
      const key = candidate.toString();
      if (reservedSponsorNonces.has(key)) continue;
      if (await readSponsorNonce(execution, config.paymaster, candidate)) continue;
      reservedSponsorNonces.add(key);
      return candidate;
    }
  }

  async function nextExitSponsorNonce(paymaster: Address): Promise<bigint> {
    for (;;) {
      const candidate = exitSponsorNonceCursor;
      exitSponsorNonceCursor += 1n;
      const key = candidate.toString();
      if (reservedExitSponsorNonces.has(key)) continue;
      if (await readSponsorNonce(execution, paymaster, candidate)) continue;
      reservedExitSponsorNonces.add(key);
      return candidate;
    }
  }

  function exitRoute(routes: readonly { asset: Address; path: Hex }[], asset: Address): Hex {
    const route = routes.find((candidate) => candidate.asset.toLowerCase() === asset.toLowerCase());
    if (!route) throw new HttpProblem(409, "asset_has_no_verified_cash_out_route");
    return route.path;
  }

  async function assertLiveGiftable(registry: Address, asset: Address): Promise<void> {
    const data = encodeFunctionData({ abi: EXIT_REGISTRY_ABI, functionName: "isGiftable", args: [asset] });
    const result = await execution.request<Hex>("eth_call", [{ to: registry, data }, "latest"]);
    if (!decodeBool(result, "registry isGiftable")) throw new HttpProblem(409, "asset_is_not_enabled");
  }

  async function quoteExit(request: ExitQuoteRequest): Promise<ExitQuote> {
    const exit = requireExitConfig();
    await assertLiveGiftable(exit.registry, request.asset);
    const path = exitRoute(exit.routes, request.asset);
    const data = encodeFunctionData({ abi: EXIT_QUOTER_ABI, functionName: "quoteExactInput", args: [path, request.amountIn] });
    const result = await execution.request<Hex>("eth_call", [{ to: exit.quoter, data }, "latest"]);
    const [amountOut] = decodeAbiParameters([
      { type: "uint256" },
      { type: "uint160[]" },
      { type: "uint32[]" },
      { type: "uint256" },
    ], result);
    if (typeof amountOut !== "bigint" || amountOut <= 0n) throw new HttpProblem(409, "exit_route_returned_no_quote");
    const slippageBps = request.slippageBps ?? exit.slippageBps;
    const amountOutMinimum = amountOut * BigInt(10_000 - slippageBps) / 10_000n;
    if (amountOutMinimum <= 0n) throw new HttpProblem(409, "exit_quote_below_minimum");
    const deadline = (await readBlockTimestamp(execution)) + BigInt(exit.deadlineSeconds);
    return {
      asset: request.asset,
      amountIn: toQuantity(request.amountIn, "amountIn"),
      amountOut: toQuantity(amountOut, "amountOut"),
      amountOutMinimum: toQuantity(amountOutMinimum, "amountOutMinimum"),
      path,
      deadline: toQuantity(deadline, "deadline"),
      observedAt: new Date().toISOString(),
      source: "uniswap-v3-quoter-v2",
    };
  }

  async function assertLiveCashOutQuote(
    exit: ReturnType<typeof requireExitConfig>,
    callData: Hex,
  ): Promise<void> {
    const cashOut = decodeExitCashOutCalldata(callData);
    if (!cashOut) return;
    const configuredPath = exitRoute(exit.routes, cashOut.inputToken);
    if (cashOut.path.toLowerCase() !== configuredPath.toLowerCase()) {
      throw new HttpProblem(409, "exit_route_changed");
    }
    const quote = await quoteExit({ asset: cashOut.inputToken, amountIn: cashOut.amountIn });
    if (cashOut.amountOutMinimum < BigInt(quote.amountOutMinimum)) {
      throw new HttpProblem(409, "exit_quote_stale");
    }
  }

  async function claimGasSeed(): Promise<ClaimGasSeed> {
    const sourceUserOperationHash = config.claimGasSeedUserOperationHash;
    if (!sourceUserOperationHash) throw new HttpProblem(503, "claim_gas_seed_unavailable");
    const raw = await bundler.getUserOperationByHash(sourceUserOperationHash);
    if (!raw) throw new HttpProblem(503, "claim_gas_seed_unavailable");
    let seed: RpcUserOperationV07;
    try {
      seed = seedOperation(raw);
      if (!seed.paymasterVerificationGasLimit || !seed.paymasterPostOpGasLimit) {
        const transactionHash = transactionHashOf(raw);
        if (!transactionHash) throw new Error("gas seed response is missing its bundle transaction");
        const transaction = await execution.request<{ to?: unknown; input?: unknown } | null>("eth_getTransactionByHash", [transactionHash]);
        if (!transaction || typeof transaction.to !== "string" || transaction.to.toLowerCase() !== config.entryPoint.toLowerCase() || !isHex(transaction.input)) {
          throw new Error("gas seed bundle transaction is not the configured EntryPoint call");
        }
        seed = packedSeedFromTransaction(transaction.input, seed.sender, seed.nonce);
      }
      if (isObject(raw) && typeof raw.entryPoint === "string" && raw.entryPoint.toLowerCase() !== config.entryPoint.toLowerCase()) {
        throw new Error("gas seed belongs to a different EntryPoint");
      }
      assertSponsoredUserOperation(seed);
      assertClaimExecutionCalldata(seed.callData, config.claimEscrow, config.claimFunctionSelector);
    } catch {
      throw new HttpProblem(503, "claim_gas_seed_unavailable");
    }
    const receipt = await bundler.getUserOperationReceipt(sourceUserOperationHash);
    if (!receipt || receipt.success !== true) throw new HttpProblem(503, "claim_gas_seed_unavailable");

    const [gasPriceValue, block] = await Promise.all([
      execution.request<unknown>("eth_gasPrice"),
      execution.request<{ baseFeePerGas?: unknown } | null>("eth_getBlockByNumber", ["latest", false]),
    ]);
    if (!isQuantity(gasPriceValue)) throw new HttpProblem(503, "claim_gas_seed_unavailable");
    let maxPriorityFeePerGas = BigInt(seed.maxPriorityFeePerGas);
    try {
      const livePriority = await execution.request<unknown>("eth_maxPriorityFeePerGas");
      if (isQuantity(livePriority) && BigInt(livePriority) > 0n) maxPriorityFeePerGas = BigInt(livePriority);
    } catch {
      // Some execution RPCs do not expose eth_maxPriorityFeePerGas. The
      // successful seed operation's fee field is still a live observed value.
    }
    if (maxPriorityFeePerGas <= 0n) throw new HttpProblem(503, "claim_gas_seed_unavailable");
    const gasPrice = BigInt(gasPriceValue);
    const baseFee = block && isQuantity(block.baseFeePerGas) ? BigInt(block.baseFeePerGas) : gasPrice;
    const maxFeePerGas = gasPrice > baseFee + maxPriorityFeePerGas
      ? gasPrice
      : baseFee + maxPriorityFeePerGas;
    return {
      callGasLimit: seed.callGasLimit,
      verificationGasLimit: seed.verificationGasLimit,
      preVerificationGas: seed.preVerificationGas,
      maxFeePerGas: toQuantity(maxFeePerGas, "maxFeePerGas"),
      maxPriorityFeePerGas: toQuantity(maxPriorityFeePerGas, "maxPriorityFeePerGas"),
      paymasterVerificationGasLimit: seed.paymasterVerificationGasLimit!,
      paymasterPostOpGasLimit: seed.paymasterPostOpGasLimit!,
      sourceUserOperationHash,
    };
  }

  async function authorizeClaim(request: ClaimAuthorizationRequest): Promise<ClaimPaymasterAuthorizationResponse> {
    const privateKey = config.claimPaymasterSignerPrivateKey;
    if (!privateKey) throw new HttpProblem(503, "claim_sponsor_unavailable");
    const sponsor = privateKeyToAccount(privateKey);
    const liveSigner = await readPaymasterValue(execution, config.paymaster, "verifyingSigner");
    if (typeof liveSigner !== "string" || liveSigner.toLowerCase() !== sponsor.address.toLowerCase()) {
      throw new HttpProblem(503, "claim_sponsor_misconfigured");
    }
    let giftId: bigint;
    try {
      assertClaimExecutionCalldata(request.userOperation.callData, config.claimEscrow, config.claimFunctionSelector);
      ({ giftId } = decodeClaimExecutionCalldata(
        request.userOperation.callData,
        config.claimEscrow,
        config.claimFunctionSelector,
      ));
    } catch {
      throw new HttpProblem(400, "invalid_claim_target");
    }
    let reserve: { remaining: bigint; state: number };
    try {
      reserve = await readReserve(execution, config.paymaster, giftId);
    } catch (error) {
      if (error instanceof JsonRpcRequestError) throw new HttpProblem(409, "gift_claim_reserve_unavailable");
      throw error;
    }
    const maxClaimCost = await readPaymasterValue(execution, config.paymaster, "maxClaimCost");
    if (typeof maxClaimCost !== "bigint" || maxClaimCost <= 0n) throw new HttpProblem(503, "claim_paymaster_policy_unavailable");
    const paymasterVerificationGasLimit = BigInt(request.userOperation.paymasterVerificationGasLimit!);
    const paymasterPostOpGasLimit = BigInt(request.userOperation.paymasterPostOpGasLimit!);
    if (paymasterVerificationGasLimit <= 0n || paymasterPostOpGasLimit <= 0n) {
      throw new HttpProblem(400, "claim_paymaster_gas_limits_required");
    }
    let maxCost: bigint;
    try {
      maxCost = claimMaxCostFromUserOperation(request.userOperation);
    } catch {
      throw new HttpProblem(400, "claim_gas_fields_invalid");
    }
    if (maxCost > maxClaimCost) throw new HttpProblem(409, "claim_cost_exceeds_policy");
    if (reserve.state !== 0 || reserve.remaining < maxCost) throw new HttpProblem(409, "gift_claim_reserve_unavailable");

    const sponsorNonce = await nextSponsorNonce();
    try {
      const validAfter = await readBlockTimestamp(execution);
      const validUntil = validAfter + 300n;
      const operation = fromRpcUserOperation(request.userOperation);
      const authorization = {
        entryPoint: request.entryPoint,
        paymaster: config.paymaster,
        giftId,
        maxCost,
        paymasterVerificationGasLimit,
        paymasterPostOpGasLimit,
        validAfter,
        validUntil,
        sponsorNonce,
      };
      const signed = await signClaimPaymasterAuthorization(operation, authorization, {
        address: sponsor.address,
        sign: ({ hash }) => sponsor.sign({ hash }),
      });
      return {
        paymaster: config.paymaster,
        paymasterVerificationGasLimit: toQuantity(paymasterVerificationGasLimit, "paymasterVerificationGasLimit"),
        paymasterPostOpGasLimit: toQuantity(paymasterPostOpGasLimit, "paymasterPostOpGasLimit"),
        paymasterData: encodeClaimPaymasterData(authorization, signed.signature),
        maxCost: toQuantity(maxCost, "maxCost"),
        validAfter: toQuantity(validAfter, "validAfter"),
        validUntil: toQuantity(validUntil, "validUntil"),
        sponsorNonce: toQuantity(sponsorNonce, "sponsorNonce"),
      };
    } catch (error) {
      reservedSponsorNonces.delete(sponsorNonce.toString());
      throw error;
    }
  }

  async function authorizeExit(request: ExitAuthorizationRequest): Promise<ExitPaymasterAuthorizationResponse> {
    const exit = requireExitConfig();
    const sponsor = privateKeyToAccount(exit.signerKey);
    const liveSigner = await readPaymasterValue(execution, exit.paymaster, "verifyingSigner");
    if (typeof liveSigner !== "string" || liveSigner.toLowerCase() !== sponsor.address.toLowerCase()) throw new HttpProblem(503, "exit_sponsor_misconfigured");
    try {
      assertExitExecutionCalldata(request.userOperation.callData, request.userOperation.sender, exit.routes.map((route) => route.asset), exit.router, exit.usdt0);
    } catch {
      throw new HttpProblem(400, "invalid_exit_target");
    }
    await assertLiveCashOutQuote(exit, request.userOperation.callData);
    const maxExitCost = await readPaymasterValue(execution, exit.paymaster, "maxExitCost");
    if (typeof maxExitCost !== "bigint" || maxExitCost <= 0n) throw new HttpProblem(503, "exit_paymaster_policy_unavailable");
    const paymasterVerificationGasLimit = BigInt(request.userOperation.paymasterVerificationGasLimit!);
    const paymasterPostOpGasLimit = BigInt(request.userOperation.paymasterPostOpGasLimit!);
    if (paymasterVerificationGasLimit <= 0n || paymasterPostOpGasLimit <= 0n) throw new HttpProblem(400, "exit_paymaster_gas_limits_required");
    let maxCost: bigint;
    try {
      maxCost = maxCostFromUserOperation(request.userOperation);
    } catch {
      throw new HttpProblem(400, "exit_gas_fields_invalid");
    }
    if (maxCost > maxExitCost) throw new HttpProblem(409, "exit_cost_exceeds_policy");
    const sponsorNonce = await nextExitSponsorNonce(exit.paymaster);
    try {
      const validAfter = await readBlockTimestamp(execution);
      const validUntil = validAfter + 300n;
      const operation = fromRpcUserOperation(request.userOperation);
      const authorization = {
        entryPoint: request.entryPoint,
        paymaster: exit.paymaster,
        actionHash: exitPaymasterActionHash(request.userOperation.callData),
        maxCost,
        paymasterVerificationGasLimit,
        paymasterPostOpGasLimit,
        validAfter,
        validUntil,
        sponsorNonce,
      };
      const signed = await signExitPaymasterAuthorization(operation, authorization, {
        address: sponsor.address,
        sign: ({ hash }) => sponsor.sign({ hash }),
      });
      return {
        paymaster: exit.paymaster,
        paymasterVerificationGasLimit: toQuantity(paymasterVerificationGasLimit, "paymasterVerificationGasLimit"),
        paymasterPostOpGasLimit: toQuantity(paymasterPostOpGasLimit, "paymasterPostOpGasLimit"),
        paymasterData: encodeExitPaymasterData(authorization, signed.signature),
        maxCost: toQuantity(maxCost, "maxCost"),
        validAfter: toQuantity(validAfter, "validAfter"),
        validUntil: toQuantity(validUntil, "validUntil"),
        sponsorNonce: toQuantity(sponsorNonce, "sponsorNonce"),
      };
    } catch (error) {
      reservedExitSponsorNonces.delete(sponsorNonce.toString());
      throw error;
    }
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!authorized(request, config.authToken)) {
      json(response, 401, { error: "unauthorized" });
      return;
    }
    const path = pathOf(request);
    if (request.method === "GET" && path === "/healthz") {
      const report = await checkRelayerHealth(config);
      json(response, report.healthy ? 200 : 503, report);
      return;
    }
    if (request.method === "GET" && path === "/v1/claims/gas-seed") {
      json(response, 200, await claimGasSeed());
      return;
    }
    if (request.method === "POST" && path === "/v1/exits/quote") {
      const body = await readJson(request, config.maxBodyBytes);
      json(response, 200, await quoteExit(parseExitQuoteRequest(body)));
      return;
    }
    if (request.method === "POST" && path === "/v1/exits/authorize") {
      const body = await readJson(request, config.maxBodyBytes);
      const exit = requireExitConfig();
      const parsed = parseExitAuthorizationRequest(body, config.entryPoint, exit.paymaster);
      json(response, 200, await authorizeExit(parsed));
      return;
    }
    if (request.method === "GET" && /^\/v1\/exits\/0x[0-9a-fA-F]{64}$/.test(path)) {
      const userOperationHash = path.slice("/v1/exits/".length) as Hex;
      assertUserOperationHash(userOperationHash);
      json(response, 200, await readUserOperationStatus(bundler, execution, config.entryPoint, userOperationHash));
      return;
    }
    if (request.method === "POST" && path === "/v1/claims/authorize") {
      const body = await readJson(request, config.maxBodyBytes);
      const claim = parseClaimAuthorizationRequest(body, config.entryPoint, config.paymaster);
      json(response, 200, await authorizeClaim(claim));
      return;
    }
    if (request.method === "GET" && /^\/v1\/claims\/0x[0-9a-fA-F]{64}$/.test(path)) {
      const userOperationHash = path.slice("/v1/claims/".length) as Hex;
      assertUserOperationHash(userOperationHash);
      json(response, 200, await readUserOperationStatus(bundler, execution, config.entryPoint, userOperationHash));
      return;
    }
    if (request.method === "POST" && (path === "/v1/exits" || path === "/v1/exits/estimate")) {
      const exit = requireExitConfig();
      const body = await readJson(request, config.maxBodyBytes);
      const parsed = parseExitRequest(body, config.entryPoint, exit.paymaster);
      try {
        assertExitExecutionCalldata(parsed.userOperation.callData, parsed.userOperation.sender, exit.routes.map((route) => route.asset), exit.router, exit.usdt0);
      } catch {
        throw new HttpProblem(400, "invalid_exit_target");
      }
      if (path === "/v1/exits/estimate") {
        json(response, 200, await bundler.estimateUserOperationGas(parsed.userOperation, parsed.entryPoint));
        return;
      }
      pruneSubmissions();
      if (parsed.idempotencyKey) {
        const existing = submissions.get(`exit:${parsed.idempotencyKey}`);
        if (existing) {
          json(response, 202, { userOperationHash: existing.userOperationHash, status: "submitted" });
          return;
        }
      }
      try {
        await preflightEntryPointUserOperation({
          executionRpcUrl: config.executionRpcUrl,
          entryPoint: parsed.entryPoint,
          beneficiary: config.preflightBeneficiary,
          userOperation: fromRpcUserOperation(parsed.userOperation),
          timeoutMs: config.requestTimeoutMs,
        });
      } catch (error) {
        if (error instanceof JsonRpcRequestError || error instanceof JsonRpcTransportError) throw new HttpProblem(502, "exit_simulation_unavailable");
        throw new HttpProblem(409, "exit_simulation_failed");
      }
      const userOperationHash = await bundler.sendUserOperation(parsed.userOperation, parsed.entryPoint);
      if (parsed.idempotencyKey) submissions.set(`exit:${parsed.idempotencyKey}`, { userOperationHash, expiresAt: Date.now() + 15 * 60_000 });
      json(response, 202, { userOperationHash, status: "submitted" });
      return;
    }
    if (request.method !== "POST" || (path !== "/v1/claims" && path !== "/v1/claims/estimate")) {
      json(response, 404, { error: "not_found" });
      return;
    }

    const body = await readJson(request, config.maxBodyBytes);
    const claim = parseClaimRequest(body, config.entryPoint, config.paymaster);
    try {
      assertClaimExecutionCalldata(claim.userOperation.callData, config.claimEscrow, config.claimFunctionSelector);
    } catch {
      throw new HttpProblem(400, "invalid_claim_target");
    }
    if (path === "/v1/claims/estimate") {
      const estimate = await bundler.estimateUserOperationGas(claim.userOperation, claim.entryPoint);
      json(response, 200, estimate);
      return;
    }

    pruneSubmissions();
    if (claim.idempotencyKey) {
      const existing = submissions.get(claim.idempotencyKey);
      if (existing) {
        json(response, 202, { userOperationHash: existing.userOperationHash, status: "submitted" });
        return;
      }
    }
    try {
      await preflightEntryPointUserOperation({
        executionRpcUrl: config.executionRpcUrl,
        entryPoint: claim.entryPoint,
        beneficiary: config.preflightBeneficiary,
        userOperation: fromRpcUserOperation(claim.userOperation),
        timeoutMs: config.requestTimeoutMs,
      });
    } catch (error) {
      if (error instanceof JsonRpcRequestError || error instanceof JsonRpcTransportError) {
        throw new HttpProblem(502, "claim_simulation_unavailable");
      }
      throw new HttpProblem(409, "claim_simulation_failed");
    }
    const userOperationHash = await bundler.sendUserOperation(claim.userOperation, claim.entryPoint);
    if (claim.idempotencyKey) submissions.set(claim.idempotencyKey, { userOperationHash, expiresAt: Date.now() + 15 * 60_000 });
    json(response, 202, { userOperationHash, status: "submitted" });
  }

  return createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      if (error instanceof HttpProblem) {
        json(response, error.status, { error: error.code });
        return;
      }
      if (error instanceof JsonRpcRequestError || error instanceof JsonRpcTransportError) {
        json(response, 502, { error: "private_bundler_unavailable" });
        return;
      }
      json(response, 500, { error: "relay_unavailable" });
    });
  });
}
