import type { Address } from "viem";

/** Launch xStocks on X Layer, keyed by lowercase token address. All use 18 decimals. Server-side only. */
export const XSTOCK_TOKENS: Record<string, { ticker: string; issuer: string }> = {
  "0xa8ddb5cd96b5222afe198316e9a57caa642850d5": { ticker: "NVDAx", issuer: "NVDAx" },
  "0x943bf64d566c32a2bcd41ac92fb63c111cc9de8f": { ticker: "AAPLx", issuer: "AAPLx" },
  "0xc3fdbe3a68ee5de461d30415a8165cf9aefe1171": { ticker: "TSLAx", issuer: "TSLAx" },
};

export const XSTOCK_TOKEN_ADDRESSES = Object.keys(XSTOCK_TOKENS) as Address[];

/** Live value of one wrapper unit: issuer price x wrapper multiplier. Tickers whose reads fail are omitted. */
export async function unitValues(): Promise<Record<string, number>> {
  const entries = await Promise.all(Object.values(XSTOCK_TOKENS).map(async ({ ticker, issuer }) => {
    try {
      const base = `https://api.backed.fi/api/v2/public/assets/${issuer}`;
      const [price, multiplier] = await Promise.all([
        fetch(`${base}/price-data`, { cache: "no-store" }).then((r) => r.json() as Promise<{ quote?: number }>),
        fetch(`${base}/multiplier?network=XLayer`, { cache: "no-store" }).then((r) => r.json() as Promise<{ currentMultiplier?: number }>),
      ]);
      return typeof price.quote === "number" && typeof multiplier.currentMultiplier === "number"
        ? [[ticker, price.quote * multiplier.currentMultiplier]] as const
        : [];
    } catch {
      return [];
    }
  }));
  return Object.fromEntries(entries.flat());
}
