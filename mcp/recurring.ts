import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Recurring gift plans for the Convey agent.
 *
 * A plan is the user's standing approval: one xStock, a fixed amount per gift,
 * an interval, and a total budget. `run_due_gifts` sends at most one gift per
 * plan per run and never exceeds the budget. Missed runs are skipped, never
 * batched. Before sending, a plan is marked in flight, so a crash between the
 * transaction and the record is reconciled against the chain instead of
 * producing a second gift.
 */

export const MIN_INTERVAL_SECONDS = 3600;
const LOCK_STALE_MS = 10 * 60 * 1000;

export interface SentGift {
  giftId: string;
  claimLink: string;
  transaction: string;
  sentAt: string;
}

export interface RecurringPlan {
  id: string;
  ticker: string;
  /** Decimal amount in xStock units, as the user approved it. */
  amountPerGift: string;
  intervalSeconds: number;
  /** Decimal total in xStock units; the plan completes once it is spent. */
  totalBudget: string;
  recipient: string;
  note?: string;
  status: "active" | "completed" | "cancelled";
  createdAt: string;
  nextRunAt: string;
  sent: SentGift[];
  /**
   * Set before a gift transaction is sent and cleared once it is recorded. The
   * secret is saved first so a crash can be reconciled against the chain with
   * the full claim link intact.
   */
  inFlight?: { since: string; secret: string };
}

interface PlanFile {
  version: 1;
  plans: RecurringPlan[];
}

/** Exact decimal arithmetic on xStock amounts, without float rounding. */
export function toUnits(amount: string, decimals = 18): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/u.exec(amount);
  if (!match) throw new Error(`invalid amount: ${amount}`);
  const fraction = (match[2] ?? "").padEnd(decimals, "0");
  if (fraction.length > decimals) throw new Error(`amount has more than ${decimals} decimals: ${amount}`);
  return BigInt(match[1]) * 10n ** BigInt(decimals) + BigInt(fraction || "0");
}

export function spentUnits(plan: RecurringPlan): bigint {
  return toUnits(plan.amountPerGift) * BigInt(plan.sent.length);
}

export function remainingGifts(plan: RecurringPlan): number {
  const perGift = toUnits(plan.amountPerGift);
  return Number((toUnits(plan.totalBudget) - spentUnits(plan)) / perGift);
}

export class PlanStore {
  readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  read(): RecurringPlan[] {
    try {
      const file = JSON.parse(readFileSync(this.path, "utf8")) as PlanFile;
      return file.plans;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  /** Atomic write: a crash mid-write never leaves a truncated plan file. */
  write(plans: RecurringPlan[]): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify({ version: 1, plans } satisfies PlanFile, null, 2), { mode: 0o600 });
    renameSync(temporary, this.path);
  }

  update(id: string, change: (plan: RecurringPlan) => void): RecurringPlan {
    const plans = this.read();
    const plan = plans.find((candidate) => candidate.id === id);
    if (!plan) throw new Error(`no recurring plan with id ${id}`);
    change(plan);
    this.write(plans);
    return plan;
  }

  /** Runs `task` while holding an exclusive lock, so two scheduler runs cannot overlap. */
  async withLock<T>(task: () => Promise<T>): Promise<T> {
    const lockPath = `${this.path}.lock`;
    mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
    let handle: number;
    try {
      handle = openSync(lockPath, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() - statSync(lockPath).mtimeMs < LOCK_STALE_MS) throw new Error("another run_due_gifts is in progress");
      rmSync(lockPath, { force: true });
      handle = openSync(lockPath, "wx");
    }
    try {
      return await task();
    } finally {
      closeSync(handle);
      rmSync(lockPath, { force: true });
    }
  }
}

export interface NewPlan {
  ticker: string;
  amountPerGift: string;
  intervalSeconds: number;
  totalBudget: string;
  recipient: string;
  note?: string;
  startAt?: Date;
}

export function createPlan(input: NewPlan, maxGiftAmount: string, now = new Date()): RecurringPlan {
  const perGift = toUnits(input.amountPerGift);
  if (perGift <= 0n) throw new Error("amount per gift must be greater than zero");
  if (perGift > toUnits(maxGiftAmount)) throw new Error(`${input.amountPerGift} exceeds the per-gift cap of ${maxGiftAmount}`);
  if (toUnits(input.totalBudget) < perGift) throw new Error("total budget must cover at least one gift");
  if (!Number.isInteger(input.intervalSeconds) || input.intervalSeconds < MIN_INTERVAL_SECONDS) {
    throw new Error("interval must be at least one hour");
  }
  const start = input.startAt ?? now;
  if (Number.isNaN(start.getTime())) throw new Error("start time is not a valid date");
  return {
    id: randomUUID().slice(0, 8),
    ticker: input.ticker,
    amountPerGift: input.amountPerGift,
    intervalSeconds: input.intervalSeconds,
    totalBudget: input.totalBudget,
    recipient: input.recipient,
    note: input.note,
    status: "active",
    createdAt: now.toISOString(),
    nextRunAt: start.toISOString(),
    sent: [],
  };
}

export function isDue(plan: RecurringPlan, now = new Date()): boolean {
  return plan.status === "active" && !plan.inFlight && new Date(plan.nextRunAt) <= now && remainingGifts(plan) > 0;
}

/** Records a sent gift and schedules the next one, skipping any missed periods. */
export function recordSent(plan: RecurringPlan, gift: SentGift, now = new Date()): void {
  plan.sent.push(gift);
  plan.inFlight = undefined;
  let next = new Date(plan.nextRunAt).getTime() + plan.intervalSeconds * 1000;
  if (next <= now.getTime()) next = now.getTime() + plan.intervalSeconds * 1000;
  plan.nextRunAt = new Date(next).toISOString();
  if (remainingGifts(plan) === 0) plan.status = "completed";
}
