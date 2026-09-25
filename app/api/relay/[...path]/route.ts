import { NextRequest } from "next/server";
import { FixedWindowLimiter } from "@/src/relayer/limits";

const CLAIM_HASH = /^0x[0-9a-fA-F]{64}$/u;
const EXIT_HASH = /^0x[0-9a-fA-F]{64}$/u;

function allowedPath(path: string): boolean {
  return path === "healthz"
    || path === "v1/claims"
    || path === "v1/claims/authorize"
    || path === "v1/claims/estimate"
    || path === "v1/claims/gas-seed"
    || path === "v1/accounts"
    || (path.startsWith("v1/claims/") && CLAIM_HASH.test(path.slice("v1/claims/".length)))
    || path === "v1/exits"
    || path === "v1/exits/quote"
    || path === "v1/exits/authorize"
    || path === "v1/exits/estimate"
    || (path.startsWith("v1/exits/") && EXIT_HASH.test(path.slice("v1/exits/".length)));
}

// Sponsor-signing and submission routes are the costly ones; reads stay cheap.
const SPONSOR_WRITE_PATHS = new Set(["v1/accounts", "v1/claims", "v1/claims/authorize", "v1/exits", "v1/exits/authorize", "v1/exits/quote"]);
const writesPerIp = new FixedWindowLimiter(30, 10 * 60 * 1000);
const requestsPerIp = new FixedWindowLimiter(300, 10 * 60 * 1000);

/** Nginx appends the connecting address last, so earlier entries are client-controlled. */
function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").map((part) => part.trim()).filter(Boolean);
  return forwarded?.at(-1) ?? "unknown";
}

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path: segments } = await context.params;
  const path = segments.join("/");
  if (!allowedPath(path)) return Response.json({ error: "not_found" }, { status: 404 });
  const ip = clientIp(request);
  if (!requestsPerIp.take(ip) || (request.method === "POST" && SPONSOR_WRITE_PATHS.has(path) && !writesPerIp.take(ip))) {
    return Response.json({ error: "rate_limited" }, { status: 429, headers: { "retry-after": "600" } });
  }
  const relayUrl = process.env.CONVEY_RELAYER_URL?.trim();
  if (!relayUrl) return Response.json({ error: "relay_not_configured" }, { status: 503 });
  let upstream: URL;
  try {
    upstream = new URL(`/${path}`, relayUrl);
  } catch {
    return Response.json({ error: "relay_not_configured" }, { status: 503 });
  }
  const headers = new Headers({ accept: "application/json" });
  const token = process.env.CONVEY_RELAYER_AUTH_TOKEN?.trim();
  if (token) headers.set("authorization", `Bearer ${token}`);
  let body: string | undefined;
  if (request.method !== "GET") {
    headers.set("content-type", "application/json");
    body = await request.text();
  }
  try {
    const response = await fetch(upstream, { method: request.method, headers, body, cache: "no-store" });
    return new Response(response.body, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
    });
  } catch {
    return Response.json({ error: "relay_unavailable" }, { status: 502 });
  }
}

export const GET = proxy;
export const POST = proxy;
