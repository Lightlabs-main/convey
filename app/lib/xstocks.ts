"use client";

import { useEffect, useState } from "react";
import { isAddress, type Address } from "viem";

/** X Layer xStocks certified in Convey's live AssetRegistry. */
export interface XStock {
  ticker: "NVDAx" | "AAPLx" | "TSLAx";
  company: string;
  token?: Address;
  /** Visual identity for the generated card art. Not a company logo. */
  hue: [string, string];
}

function envAddress(value: string | undefined): Address | undefined {
  return value && isAddress(value) ? (value as Address) : undefined;
}

export const XSTOCKS: readonly XStock[] = [
  { ticker: "NVDAx", company: "NVIDIA", token: envAddress(process.env.NEXT_PUBLIC_CONVEY_WNVDA_TOKEN_ADDRESS), hue: ["#9be15d", "#1f7a3a"] },
  { ticker: "AAPLx", company: "Apple", token: envAddress(process.env.NEXT_PUBLIC_CONVEY_WAAPL_TOKEN_ADDRESS), hue: ["#d7dde8", "#5b6475"] },
  { ticker: "TSLAx", company: "Tesla", token: envAddress(process.env.NEXT_PUBLIC_CONVEY_WTSLA_TOKEN_ADDRESS), hue: ["#ff7a6b", "#9c1f2e"] },
];

export const EXPLORER = "https://www.oklink.com/xlayer";

/**
 * Live issuer quotes (USD per underlying share) through Convey's same-origin
 * valuation proxy. A ticker without a live quote is omitted, never estimated.
 */
export function useLiveQuotes(refreshMs = 30_000): Partial<Record<XStock["ticker"], number>> {
  const [quotes, setQuotes] = useState<Partial<Record<XStock["ticker"], number>>>({});
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const entries = await Promise.all(XSTOCKS.map(async ({ ticker }) => {
        try {
          const response = await fetch(`/api/valuation/assets/${ticker}/price-data`, { cache: "no-store" });
          if (!response.ok) return undefined;
          const { quote } = (await response.json()) as { quote?: unknown };
          return typeof quote === "number" && Number.isFinite(quote) ? ([ticker, quote] as const) : undefined;
        } catch {
          return undefined;
        }
      }));
      if (!cancelled) setQuotes(Object.fromEntries(entries.filter((entry) => entry !== undefined)));
    }
    void load();
    const timer = window.setInterval(load, refreshMs);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [refreshMs]);
  return quotes;
}

export function formatUsd(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
