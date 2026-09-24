import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { decodeAbiParameters, encodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { checkRelayerHealth } from "./health.ts";
import { assertClaimExecutionCalldata, decodeClaimExecutionCalldata } from "./claim-policy.ts";
import { encodeClaimPaymasterData, signClaimPaymasterAuthorization } from "./claim-paymaster.ts";
import { JsonRpcRequestError, JsonRpcTransportError } from "./rpc.ts";
import { JsonRpcClient } from "./rpc.ts";
import { SelfHostedBundlerClient } from "./bundler.ts";
import { fromRpcUserOperation, isAddress, isQuantity, toQuantity, type Address, type ClaimPaymasterAuthorizationResponse, type ClaimRelayStatus, type Hex, type RpcUserOperationV07 } from "./types.ts";
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

const CLAIM_PAYMASTER_READ_ABI = [
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

async function readPaymasterValue(rpc: JsonRpcClient, paymaster: Address, functionName: "maxClaimCost" | "verifyingSigner"): Promise<bigint | Address> {
  const data = encodeFunctionData({ abi: CLAIM_PAYMASTER_READ_ABI, functionName, args: [] });
  const result = await rpc.request<Hex>("eth_call", [{ to: paymaster, data }, "latest"]);
  return functionName === "maxClaimCost" ? decodeUint256(result, functionName) : decodeAddress(result, functionName);
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

function pathOf(request: IncomingMessage): string {
  return new URL(request.url ?? "/", "http://convey-relayer").pathname;
}

export function createRelayerServer(config: SelfHostedRelayerConfig): Server {
  const bundler = new SelfHostedBundlerClient(config.bundlerRpcUrl, config.requestTimeoutMs);
  const execution = new JsonRpcClient(config.executionRpcUrl, { timeoutMs: config.requestTimeoutMs });
  const submissions = new Map<string, { userOperationHash: Hex; expiresAt: number }>();
  const reservedSponsorNonces = new Set<string>();
  let sponsorNonceCursor = 0n;

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
    const reserve = await readReserve(execution, config.paymaster, giftId);
    const maxCost = await readPaymasterValue(execution, config.paymaster, "maxClaimCost");
    if (typeof maxCost !== "bigint" || maxCost <= 0n) throw new HttpProblem(503, "claim_paymaster_policy_unavailable");
    if (reserve.state !== 0 || reserve.remaining < maxCost) throw new HttpProblem(409, "gift_claim_reserve_unavailable");
    const paymasterVerificationGasLimit = BigInt(request.userOperation.paymasterVerificationGasLimit!);
    const paymasterPostOpGasLimit = BigInt(request.userOperation.paymasterPostOpGasLimit!);
    if (paymasterVerificationGasLimit <= 0n || paymasterPostOpGasLimit <= 0n) {
      throw new HttpProblem(400, "claim_paymaster_gas_limits_required");
    }

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
    if (request.method === "POST" && path === "/v1/claims/authorize") {
      const body = await readJson(request, config.maxBodyBytes);
      const claim = parseClaimAuthorizationRequest(body, config.entryPoint, config.paymaster);
      json(response, 200, await authorizeClaim(claim));
      return;
    }
    if (request.method === "GET" && /^\/v1\/claims\/0x[0-9a-fA-F]{64}$/.test(path)) {
      const userOperationHash = path.slice("/v1/claims/".length) as Hex;
      assertUserOperationHash(userOperationHash);
      const receipt = await bundler.getUserOperationReceipt(userOperationHash);
      json(response, 200, statusFromReceipt(userOperationHash, receipt));
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
