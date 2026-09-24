import { NextRequest } from "next/server";

const CLAIM_HASH = /^0x[0-9a-fA-F]{64}$/u;
const EXIT_HASH = /^0x[0-9a-fA-F]{64}$/u;

function allowedPath(path: string): boolean {
  return path === "healthz"
    || path === "v1/claims"
    || path === "v1/claims/authorize"
    || path === "v1/claims/estimate"
    || path === "v1/claims/gas-seed"
    || (path.startsWith("v1/claims/") && CLAIM_HASH.test(path.slice("v1/claims/".length)))
    || path === "v1/exits"
    || path === "v1/exits/quote"
    || path === "v1/exits/authorize"
    || path === "v1/exits/estimate"
    || (path.startsWith("v1/exits/") && EXIT_HASH.test(path.slice("v1/exits/".length)));
}

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path: segments } = await context.params;
  const path = segments.join("/");
  if (!allowedPath(path)) return Response.json({ error: "not_found" }, { status: 404 });
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
