import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { checkRelayerHealth } from "./health.ts";
import { assertClaimExecutionCalldata } from "./claim-policy.ts";
import { JsonRpcRequestError, JsonRpcTransportError } from "./rpc.ts";
import { SelfHostedBundlerClient } from "./bundler.ts";
import type { Address, ClaimRelayStatus, Hex, RpcUserOperationV07 } from "./types.ts";
import {
  assertSponsoredUserOperation,
  assertUserOperationHash,
} from "./types.ts";
import type { SelfHostedRelayerConfig } from "./config.ts";

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

function statusFromReceipt(userOperationHash: Hex, receipt: any): ClaimRelayStatus {
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
  const submissions = new Map<string, { userOperationHash: Hex; expiresAt: number }>();

  function pruneSubmissions(): void {
    const now = Date.now();
    for (const [key, value] of submissions) if (value.expiresAt <= now) submissions.delete(key);
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
