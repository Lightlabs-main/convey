import { NextRequest } from "next/server";

const ISSUER_API_BASE = "https://api.backed.fi/api/v2/public";
const SYMBOLS = new Map([
  ["NVDAx", "NVDAx"],
  ["wNVDAx", "NVDAx"],
  ["TSLAx", "TSLAx"],
  ["wTSLAx", "TSLAx"],
  ["AAPLx", "AAPLx"],
  ["wAAPLx", "AAPLx"],
]);
const METRICS = new Set(["price-data", "multiplier"]);

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ symbol: string; metric: string }> },
): Promise<Response> {
  const { symbol, metric } = await context.params;
  const issuerSymbol = SYMBOLS.get(symbol);
  if (!issuerSymbol || !METRICS.has(metric)) return jsonError("not_found", 404);

  const network = request.nextUrl.searchParams.get("network");
  if (metric === "multiplier" && network !== "XLayer") return jsonError("network_required", 400);
  if (metric === "price-data" && network !== null) return jsonError("unexpected_query", 400);

  const upstream = new URL(`${ISSUER_API_BASE}/assets/${issuerSymbol}/${metric}`);
  if (metric === "multiplier") upstream.searchParams.set("network", "XLayer");

  try {
    const response = await fetch(upstream, { cache: "no-store", headers: { accept: "application/json" } });
    if (!response.ok) return jsonError("issuer_unavailable", 502);
    const payload: unknown = await response.json();
    return Response.json(payload, {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return jsonError("issuer_unavailable", 502);
  }
}
