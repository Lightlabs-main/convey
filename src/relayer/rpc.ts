import type { Hex } from "./types.ts";

export interface JsonRpcErrorShape {
  code: number;
  message: string;
  data?: unknown;
}

export class JsonRpcRequestError extends Error {
  readonly method: string;
  readonly code?: number;

  constructor(method: string, error: JsonRpcErrorShape | string) {
    const message = typeof error === "string" ? error : error.message;
    super(`JSON-RPC ${method} failed: ${message}`);
    this.name = "JsonRpcRequestError";
    this.method = method;
    this.code = typeof error === "string" ? undefined : error.code;
  }
}

export class JsonRpcTransportError extends Error {
  readonly method: string;

  constructor(method: string, message: string) {
    super(`JSON-RPC ${method} transport failed: ${message}`);
    this.name = "JsonRpcTransportError";
    this.method = method;
  }
}

export interface JsonRpcClientOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

function isLocalHttpUrl(value: URL): boolean {
  return value.protocol === "http:" && (value.hostname === "localhost" || value.hostname === "127.0.0.1" || value.hostname === "::1");
}

export function assertPrivateRpcUrl(rawUrl: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (url.protocol !== "https:" && !isLocalHttpUrl(url)) {
    throw new Error(`${name} must use HTTPS; plain HTTP is only allowed on localhost`);
  }
  return url;
}

function boundedTimeout(value: number | undefined): number {
  if (value === undefined) return 15_000;
  if (!Number.isInteger(value) || value < 500 || value > 120_000) {
    throw new Error("RPC timeout must be an integer between 500 and 120000 milliseconds");
  }
  return value;
}

export class JsonRpcClient {
  readonly url: URL;
  readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private nextId = 0;

  constructor(rawUrl: string, options: JsonRpcClientOptions = {}) {
    this.url = assertPrivateRpcUrl(rawUrl, "RPC URL");
    this.timeoutMs = boundedTimeout(options.timeoutMs);
    // Bound so browsers accept it: a detached window.fetch throws "Illegal invocation".
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async request<T>(method: string, params: readonly unknown[] = []): Promise<T> {
    const id = ++this.nextId;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    let body: any;
    try {
      response = await this.fetchImpl(this.url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: controller.signal,
      });
      const text = await response.text();
      try {
        body = JSON.parse(text);
      } catch {
        throw new JsonRpcTransportError(method, `endpoint returned non-JSON HTTP ${response.status}`);
      }
    } catch (error) {
      if (error instanceof JsonRpcTransportError || error instanceof JsonRpcRequestError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new JsonRpcTransportError(method, "request timed out");
      }
      throw new JsonRpcTransportError(method, error instanceof Error ? error.message : "unknown network error");
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) throw new JsonRpcTransportError(method, `HTTP ${response.status}`);
    if (!body || body.jsonrpc !== "2.0" || body.id !== id) throw new JsonRpcTransportError(method, "invalid JSON-RPC response");
    if (body.error) throw new JsonRpcRequestError(method, body.error as JsonRpcErrorShape);
    return body.result as T;
  }
}

export function asRpcQuantity(value: bigint): Hex {
  if (value < 0n) throw new Error("RPC quantities cannot be negative");
  return `0x${value.toString(16)}` as Hex;
}

