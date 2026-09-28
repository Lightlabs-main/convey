"use client";

import { useEffect, useState } from "react";

type Holding = { token: string; ticker: string; amount: string; raw: string; valueUsd?: number };
type PortfolioBody = { account: string; holdings: Holding[]; totalUsd?: number; readAt: number };

function formatAmount(value: string): string {
  const number = Number(value);
  return number === 0 ? "0" : number < 0.0001 ? "<0.0001" : number.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

/** Live holdings of a receiver smart account, read from X Layer through /api/portfolio. */
export function Portfolio({ account, title = "Portfolio", refreshKey = 0 }: { account: string; title?: string; refreshKey?: number }) {
  const [body, setBody] = useState<PortfolioBody>();
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    void fetch(`/api/portfolio?account=${account}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() as Promise<PortfolioBody> : Promise.reject(new Error("unavailable"))))
      .then((next) => { if (!cancelled) setBody(next); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [account, refreshKey, reload]);

  const held = body?.holdings.filter((holding) => holding.raw !== "0") ?? [];

  return (
    <div className="recovery portfolio">
      <div className="portfolio-head">
        <div className="recovery-label">{title}</div>
        {body?.totalUsd !== undefined ? <strong className="portfolio-total">${body.totalUsd.toFixed(2)}</strong> : null}
      </div>
      {error ? <p className="error" role="alert">The live balances could not be read from X Layer right now.</p> : null}
      {!body && !error ? <p>Reading live balances…</p> : null}
      {body && held.length === 0 ? <p>This account holds no xStocks or USDT0 right now. They may have been cashed out or moved.</p> : null}
      {held.length > 0 ? (
        <ul className="portfolio-list">
          {held.map((holding) => (
            <li key={holding.token}>
              <span><strong>{holding.ticker}</strong><small>{formatAmount(holding.amount)} {holding.ticker === "USDT0" ? "" : "shares"}</small></span>
              <span>{holding.valueUsd !== undefined ? `$${holding.valueUsd.toFixed(2)}` : "value unavailable"}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p>
        <a href={`https://www.oklink.com/xlayer/address/${account}`} target="_blank" rel="noreferrer">{account.slice(0, 6)}…{account.slice(-4)} on OKLink</a>
        {" · "}
        <button className="text-button" type="button" onClick={() => setReload((value) => value + 1)}>Refresh</button>
      </p>
    </div>
  );
}
