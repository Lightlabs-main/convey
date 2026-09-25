import { assertPrivateRpcUrl } from "./rpc.ts";
import type {
  Address,
  ClaimPaymasterAuthorizationResponse,
  ClaimGasSeed,
  ClaimRelayAccepted,
  ClaimRelayStatus,
  ExitPaymasterAuthorizationResponse,
  ExitQuote,
  Hex,
  PackedUserOperation,
  RpcUserOperationV07,
  UserOperationGasEstimate,
} from "./types.ts";
import {
  assertSponsoredUserOperation,
  assertAddress,
  assertHex,
  assertQuantity,
  assertUserOperationHash,
  assertRpcUserOperationV07,
  toRpcUserOperation,
} from "./types.ts";

export interface RelayClientOptions {
  relayUrl: string;
  entryPoint: Address;
  chainId?: number;
  timeoutMs?: number;
  authToken?: string;
  fetchImpl?: typeof fetch;
}

export interface SubmitClaimOptions {
  idempotencyKey?: string;
}

export interface SubmitExitOptions {
  idempotencyKey?: string;
}

export class RelayHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
  super(`Convey relay HTTP ${status}: ${message}`);
    this.name = "RelayHttpError";
    this.status = status;
  }
}

function timeoutValue(value: number | undefined): number {
  if (value === undefined) return 15_000;
  if (!Number.isInteger(value) || value < 500 || value > 120_000) throw new Error("relay timeout must be between 500 and 120000 milliseconds");
  return value;
}

function requestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  throw new Error("a cryptographically secure randomUUID implementation is required");
}

function asRpcUserOperation(userOperation: PackedUserOperation | RpcUserOperationV07): RpcUserOperationV07 {
  return typeof userOperation.nonce === "bigint" ? toRpcUserOperation(userOperation as PackedUserOperation) : userOperation as RpcUserOperationV07;
}

function safeMessage(body: unknown): string {
  if (!body || typeof body !== "object") return "relay request failed";
  const message = (body as Record<string, unknown>).error;
  return typeof message === "string" && message.length <= 200 ? message : "relay request failed";
}

export class ConveyRelayerClient {
  readonly relayUrl: string;
  readonly entryPoint: Address;
  readonly chainId?: number;
  readonly timeoutMs: number;
  private readonly authToken?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: RelayClientOptions) {
    const relayUrl = assertPrivateRpcUrl(options.relayUrl, "relay URL");
    assertAddress(options.entryPoint, "entryPoint");
    if (options.chainId !== undefined && options.chainId !== 196) throw new Error("Convey relay client only supports X Layer chain 196");
    this.relayUrl = relayUrl.toString().replace(/\/$/, "");
    this.entryPoint = options.entryPoint.toLowerCase() as Address;
    this.chainId = options.chainId;
    this.timeoutMs = timeoutValue(options.timeoutMs);
    this.authToken = options.authToken;
    // Bound so browsers accept it: a detached window.fetch throws "Illegal invocation".
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async health(): Promise<unknown> {
    return this.request("GET", "/healthz");
  }

  /**
   * Asks the gateway to create a first-time receiver's OKX Smart Wallet for an
   * open gift, so the sponsored claim can run against a deployed account.
   */
  async deployAccount(owner: Address, salt: bigint, giftId: bigint): Promise<{ account: Address; deployed: boolean; transactionHash?: Hex }> {
    return this.request("POST", "/v1/accounts", { owner, salt: salt.toString(), giftId: giftId.toString() }, 90_000);
  }

  async estimateClaim(userOperation: PackedUserOperation | RpcUserOperationV07): Promise<UserOperationGasEstimate> {
    const rpcUserOperation = asRpcUserOperation(userOperation);
    assertSponsoredUserOperation(rpcUserOperation);
    const body = await this.request("POST", "/v1/claims/estimate", {
      entryPoint: this.entryPoint,
      userOperation: rpcUserOperation,
    });
    return body as UserOperationGasEstimate;
  }

  /** Reads live gas limits and current fee fields from Convey's private gateway. */
  async claimGasSeed(): Promise<ClaimGasSeed> {
    const body = await this.request("GET", "/v1/claims/gas-seed");
    if (!body || typeof body !== "object") throw new Error("relay returned an invalid claim gas seed");
    const response = body as Record<string, unknown>;
    for (const field of [
      "callGasLimit",
      "verificationGasLimit",
      "preVerificationGas",
      "maxFeePerGas",
      "maxPriorityFeePerGas",
      "paymasterVerificationGasLimit",
      "paymasterPostOpGasLimit",
    ]) {
      if (typeof response[field] !== "string") throw new Error(`relay gas seed is missing ${field}`);
      assertQuantity(response[field], `relay gas seed ${field}`);
    }
    if (typeof response.sourceUserOperationHash !== "string") throw new Error("relay gas seed is missing sourceUserOperationHash");
    assertUserOperationHash(response.sourceUserOperationHash, "relay gas seed sourceUserOperationHash");
    return response as unknown as ClaimGasSeed;
  }

  async quoteExit(asset: Address, amountIn: bigint, slippageBps?: number): Promise<ExitQuote> {
    assertAddress(asset, "exit asset");
    if (amountIn <= 0n) throw new Error("exit amount must be greater than zero");
    const body = await this.request("POST", "/v1/exits/quote", {
      asset,
      amountIn: `0x${amountIn.toString(16)}`,
      ...(slippageBps === undefined ? {} : { slippageBps }),
    });
    if (!body || typeof body !== "object") throw new Error("relay returned an invalid exit quote");
    const response = body as Record<string, unknown>;
    for (const field of ["asset", "amountIn", "amountOut", "amountOutMinimum", "path", "deadline", "observedAt", "source"]) {
      if (typeof response[field] !== "string") throw new Error(`relay exit quote is missing ${field}`);
    }
    assertAddress(response.asset, "exit quote asset");
    assertQuantity(response.amountIn, "exit quote amountIn");
    assertQuantity(response.amountOut, "exit quote amountOut");
    assertQuantity(response.amountOutMinimum, "exit quote amountOutMinimum");
    assertQuantity(response.deadline, "exit quote deadline");
    assertHex(response.path, "exit quote path");
    if (response.source !== "uniswap-v3-quoter-v2") throw new Error("relay returned an unknown exit quote source");
    return response as unknown as ExitQuote;
  }

  /**
   * Requests a short-lived paymaster authorization for an unsigned claim
   * operation. The sponsor key remains in Convey's private gateway; the
   * returned paymaster data is safe to place into the locally signed operation.
   */
  async authorizeClaim(userOperation: PackedUserOperation | RpcUserOperationV07): Promise<ClaimPaymasterAuthorizationResponse> {
    const rpcUserOperation = asRpcUserOperation(userOperation);
    assertRpcUserOperationV07(rpcUserOperation);
    if (!rpcUserOperation.paymaster) throw new Error("claim authorization requires the Convey paymaster");
    if (rpcUserOperation.signature !== "0x") throw new Error("claim authorization requires an unsigned operation");
    const body = await this.request("POST", "/v1/claims/authorize", {
      entryPoint: this.entryPoint,
      userOperation: rpcUserOperation,
    });
    if (!body || typeof body !== "object") throw new Error("relay returned an invalid claim authorization");
    const response = body as Record<string, unknown>;
    for (const field of [
      "paymaster",
      "paymasterVerificationGasLimit",
      "paymasterPostOpGasLimit",
      "paymasterData",
      "maxCost",
      "validAfter",
      "validUntil",
      "sponsorNonce",
    ]) {
      if (typeof response[field] !== "string") throw new Error(`relay authorization is missing ${field}`);
    }
    assertAddress(response.paymaster, "relay authorization paymaster");
    assertQuantity(response.paymasterVerificationGasLimit, "relay authorization verification gas limit");
    assertQuantity(response.paymasterPostOpGasLimit, "relay authorization post-op gas limit");
    assertQuantity(response.maxCost, "relay authorization max cost");
    assertQuantity(response.validAfter, "relay authorization valid after");
    assertQuantity(response.validUntil, "relay authorization valid until");
    assertQuantity(response.sponsorNonce, "relay authorization sponsor nonce");
    assertHex(response.paymasterData, "relay authorization paymaster data");
    if (response.paymaster.toLowerCase() !== rpcUserOperation.paymaster.toLowerCase()) {
      throw new Error("relay authorization returned a different paymaster");
    }
    return response as unknown as ClaimPaymasterAuthorizationResponse;
  }

  async authorizeExit(userOperation: PackedUserOperation | RpcUserOperationV07): Promise<ExitPaymasterAuthorizationResponse> {
    const rpcUserOperation = asRpcUserOperation(userOperation);
    assertRpcUserOperationV07(rpcUserOperation);
    if (!rpcUserOperation.paymaster) throw new Error("exit authorization requires the Convey exit paymaster");
    if (rpcUserOperation.signature !== "0x") throw new Error("exit authorization requires an unsigned operation");
    const body = await this.request("POST", "/v1/exits/authorize", {
      entryPoint: this.entryPoint,
      userOperation: rpcUserOperation,
    });
    if (!body || typeof body !== "object") throw new Error("relay returned an invalid exit authorization");
    const response = body as Record<string, unknown>;
    for (const field of ["paymaster", "paymasterVerificationGasLimit", "paymasterPostOpGasLimit", "paymasterData", "maxCost", "validAfter", "validUntil", "sponsorNonce"]) {
      if (typeof response[field] !== "string") throw new Error(`relay exit authorization is missing ${field}`);
    }
    assertAddress(response.paymaster, "exit authorization paymaster");
    assertQuantity(response.paymasterVerificationGasLimit, "exit authorization verification gas limit");
    assertQuantity(response.paymasterPostOpGasLimit, "exit authorization post-op gas limit");
    assertQuantity(response.maxCost, "exit authorization max cost");
    assertQuantity(response.validAfter, "exit authorization valid after");
    assertQuantity(response.validUntil, "exit authorization valid until");
    assertQuantity(response.sponsorNonce, "exit authorization sponsor nonce");
    assertHex(response.paymasterData, "exit authorization paymaster data");
    if (response.paymaster.toLowerCase() !== rpcUserOperation.paymaster.toLowerCase()) throw new Error("exit authorization returned a different paymaster");
    return response as unknown as ExitPaymasterAuthorizationResponse;
  }

  async estimateExit(userOperation: PackedUserOperation | RpcUserOperationV07): Promise<UserOperationGasEstimate> {
    const rpcUserOperation = asRpcUserOperation(userOperation);
    assertSponsoredUserOperation(rpcUserOperation);
    const body = await this.request("POST", "/v1/exits/estimate", { entryPoint: this.entryPoint, userOperation: rpcUserOperation });
    return body as UserOperationGasEstimate;
  }

  /**
   * Sends only through Convey's private claim gateway. There is intentionally
   * no public-bundler or raw-transaction fallback in this class.
   */
  async submitClaim(
    userOperation: PackedUserOperation | RpcUserOperationV07,
    options: SubmitClaimOptions = {},
  ): Promise<ClaimRelayAccepted> {
    const rpcUserOperation = asRpcUserOperation(userOperation);
    assertSponsoredUserOperation(rpcUserOperation);
    const idempotencyKey = options.idempotencyKey ?? requestId();
    if (!/^[\x21-\x7e]{8,128}$/.test(idempotencyKey)) throw new Error("idempotencyKey must be 8-128 printable ASCII characters");
    const body = await this.request("POST", "/v1/claims", {
      entryPoint: this.entryPoint,
      userOperation: rpcUserOperation,
      idempotencyKey,
    });
    if (!body || typeof body !== "object") throw new Error("relay returned an invalid claim response");
    const userOperationHash = (body as Record<string, unknown>).userOperationHash;
    assertUserOperationHash(userOperationHash, "relay userOperationHash");
    return { userOperationHash, status: "submitted" };
  }

  async submitExit(userOperation: PackedUserOperation | RpcUserOperationV07, options: SubmitExitOptions = {}): Promise<ClaimRelayAccepted> {
    const rpcUserOperation = asRpcUserOperation(userOperation);
    assertSponsoredUserOperation(rpcUserOperation);
    const idempotencyKey = options.idempotencyKey ?? requestId();
    if (!/^[\x21-\x7e]{8,128}$/.test(idempotencyKey)) throw new Error("idempotencyKey must be 8-128 printable ASCII characters");
    const body = await this.request("POST", "/v1/exits", { entryPoint: this.entryPoint, userOperation: rpcUserOperation, idempotencyKey });
    if (!body || typeof body !== "object") throw new Error("relay returned an invalid exit response");
    const userOperationHash = (body as Record<string, unknown>).userOperationHash;
    assertUserOperationHash(userOperationHash, "relay exit userOperationHash");
    return { userOperationHash, status: "submitted" };
  }

  async claimStatus(userOperationHash: Hex): Promise<ClaimRelayStatus> {
    assertUserOperationHash(userOperationHash);
    const body = await this.request("GET", `/v1/claims/${userOperationHash}`);
    if (!body || typeof body !== "object") throw new Error("relay returned an invalid claim status");
    return body as ClaimRelayStatus;
  }

  async waitForClaim(userOperationHash: Hex, options: { timeoutMs?: number; pollMs?: number } = {}): Promise<ClaimRelayStatus> {
    assertUserOperationHash(userOperationHash);
    const timeoutMs = options.timeoutMs ?? 120_000;
    const pollMs = options.pollMs ?? 1_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 600_000) throw new Error("claim wait timeout is out of range");
    if (!Number.isInteger(pollMs) || pollMs < 250 || pollMs > 30_000) throw new Error("claim polling interval is out of range");
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = await this.claimStatus(userOperationHash);
      if (status.status !== "pending") return status;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    throw new Error("claim relay timed out while waiting for a receipt");
  }

  async exitStatus(userOperationHash: Hex): Promise<ClaimRelayStatus> {
    assertUserOperationHash(userOperationHash);
    const body = await this.request("GET", `/v1/exits/${userOperationHash}`);
    if (!body || typeof body !== "object") throw new Error("relay returned an invalid exit status");
    return body as ClaimRelayStatus;
  }

  async waitForExit(userOperationHash: Hex, options: { timeoutMs?: number; pollMs?: number } = {}): Promise<ClaimRelayStatus> {
    assertUserOperationHash(userOperationHash);
    const timeoutMs = options.timeoutMs ?? 120_000;
    const pollMs = options.pollMs ?? 1_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 600_000) throw new Error("exit wait timeout is out of range");
    if (!Number.isInteger(pollMs) || pollMs < 250 || pollMs > 30_000) throw new Error("exit polling interval is out of range");
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = await this.exitStatus(userOperationHash);
      if (status.status !== "pending") return status;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    throw new Error("exit relay timed out while waiting for a receipt");
  }

  private async request(method: "GET" | "POST", path: string, body?: unknown, timeoutMs = this.timeoutMs): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.authToken) headers.authorization = `Bearer ${this.authToken}`;
    let response: Response;
    let parsed: unknown;
    try {
      response = await this.fetchImpl(`${this.relayUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      try {
        parsed = text ? JSON.parse(text) : undefined;
      } catch {
        throw new RelayHttpError(response.status, "relay returned non-JSON data");
      }
    } catch (error) {
      if (error instanceof RelayHttpError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new Error("Convey relay request timed out");
      throw new Error(`Convey relay transport failed: ${error instanceof Error ? error.message : "unknown network error"}`);
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new RelayHttpError(response.status, safeMessage(parsed));
    return parsed;
  }
}
