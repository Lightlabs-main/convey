"use client";

import { useEffect, useState } from "react";
import { EXPLORER, XSTOCKS, formatUsd } from "../lib/xstocks";
import { XStockArt } from "./XStockArt";

interface ActivityGift {
  giftId: string;
  ticker: string;
  amount: string;
  sender: string;
  createdAt: number;
  createdTx: string;
  status: "waiting" | "claimed" | "returned";
  recipient?: string;
  settledAt?: number;
  settledTx?: string;
  valueUsd?: number;
}

interface Activity {
  escrow: string;
  stats: { sent: number; claimed: number; recipients: number; recipientGasOkb: number };
  recent: ActivityGift[];
}

const STATUS = {
  claimed: { label: "Claimed", className: "status-claimed" },
  waiting: { label: "Waiting to be claimed", className: "status-waiting" },
  returned: { label: "Returned to sender", className: "status-returned" },
} as const;

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function ago(seconds: number, now: number): string {
  const diff = Math.max(0, Math.floor(now / 1000 - seconds));
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86_400)}d ago`;
}

function amountLabel(amount: string): string {
  const value = Number(amount);
  return value >= 1 ? value.toLocaleString("en-US", { maximumFractionDigits: 4 }) : value.toPrecision(2).replace(/\.?0+$/u, "");
}

/** Counts up to a stat once it has loaded. */
function useCountUp(target: number | undefined, durationMs = 900): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (target === undefined) return;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      setValue(Math.round(target * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);
  return value;
}

function Stat({ value, label, suffix = "" }: { value: number | undefined; label: string; suffix?: string }) {
  const shown = useCountUp(value);
  return (
    <div className="activity-stat">
      <span className="activity-number">{value === undefined ? "—" : `${shown}${suffix}`}</span>
      <span className="activity-label">{label}</span>
    </div>
  );
}

export function LiveActivity() {
  const [activity, setActivity] = useState<Activity>();
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/activity", { cache: "no-store" });
        if (!response.ok) throw new Error();
        const body = (await response.json()) as Activity;
        if (!cancelled) { setActivity(body); setFailed(false); setNow(Date.now()); }
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    void load();
    const timer = window.setInterval(load, 30_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  const stats = activity?.stats;
  const rate = stats && stats.sent > 0 ? Math.round((stats.claimed / stats.sent) * 100) : undefined;

  return (
    <div className="activity">
      <div className="activity-stats">
        <Stat value={stats?.sent} label="Gifts sent" />
        <Stat value={stats?.claimed} label={rate === undefined ? "Claimed" : `Claimed · ${rate}%`} />
        <Stat value={stats?.recipients} label="People who received a stock" />
        <div className="activity-stat activity-stat-accent">
          <span className="activity-number">0 OKB</span>
          <span className="activity-label">Gas paid by recipients</span>
        </div>
      </div>

      <div className="activity-feed">
        <div className="activity-feed-head">
          <span><i className="pulse" />Recent gifts</span>
          {activity ? <a className="mono-link" href={`${EXPLORER}/address/${activity.escrow}`} target="_blank" rel="noreferrer">GiftEscrow {short(activity.escrow)} ↗</a> : null}
        </div>
        {failed && !activity ? <p className="activity-empty">Live activity is unavailable right now. Every gift remains on X Layer.</p> : null}
        {!failed && !activity ? <p className="activity-empty">Reading gifts from X Layer…</p> : null}
        {activity && activity.recent.length === 0 ? <p className="activity-empty">No gifts yet. Yours could be the first.</p> : null}
        {activity?.recent.map((gift) => {
          const stock = XSTOCKS.find((candidate) => candidate.ticker === gift.ticker) ?? XSTOCKS[0];
          const status = STATUS[gift.status];
          const tx = gift.settledTx ?? gift.createdTx;
          return (
            <a className="activity-row" key={gift.giftId} href={`${EXPLORER}/tx/${tx}`} target="_blank" rel="noreferrer">
              <XStockArt stock={stock} size={40} />
              <span className="activity-asset">
                <b>{amountLabel(gift.amount)} {gift.ticker}</b>
                <small>{gift.valueUsd !== undefined ? `≈ ${formatUsd(gift.valueUsd)} today` : "live value unavailable"}</small>
              </span>
              <span className={`activity-status ${status.className}`}>{status.label}</span>
              <span className="activity-parties mono">
                {short(gift.sender)} → {gift.recipient ? short(gift.recipient) : "link holder"}
              </span>
              <span className="activity-time">{ago(gift.settledAt ?? gift.createdAt, now)}</span>
              <span className="activity-link">↗</span>
            </a>
          );
        })}
      </div>
      <p className="fine-print">
        Every number is read live from the GiftEscrow contract on X Layer and refreshes every 30 seconds. Recipients appear
        only as their smart-account address.
      </p>
    </div>
  );
}
