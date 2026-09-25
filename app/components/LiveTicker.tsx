"use client";

import { XSTOCKS, formatUsd, useLiveQuotes } from "../lib/xstocks";

/** Scrolling tape of live issuer quotes; tickers without a live quote are left out. */
export function LiveTicker() {
  const quotes = useLiveQuotes();
  const items = XSTOCKS.filter(({ ticker }) => quotes[ticker] !== undefined);
  const tape = [
    ...items.map(({ ticker, company }) => (
      <span className="tape-item" key={ticker}><b>{ticker}</b>{company}<em>{formatUsd(quotes[ticker]!)}</em></span>
    )),
    <span className="tape-item" key="chain"><b>X Layer</b>chain 196 · mainnet</span>,
    <span className="tape-item" key="gas"><b>Receiver gas</b>0 OKB</span>,
  ];
  return (
    <div className="tape" aria-label="Live xStock quotes">
      <span className="tape-live"><i />live</span>
      <div className="tape-track">
        <div className="tape-run">{tape}</div>
        <div className="tape-run" aria-hidden="true">{tape}</div>
      </div>
    </div>
  );
}
