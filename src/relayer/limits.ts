/**
 * In-memory abuse limits for the private gateway. They bound how fast any one
 * caller can ask the sponsor to sign, and how much exit gas the operator
 * sponsors per UTC day. Limits reset on restart; the on-chain paymaster
 * deposit and per-operation cost caps remain the hard backstop.
 */
export class FixedWindowLimiter {
  private readonly windows = new Map<string, { count: number; resetsAt: number }>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit: number, windowMs: number) {
    if (!Number.isInteger(limit) || limit <= 0) throw new Error("limiter limit must be a positive integer");
    if (!Number.isInteger(windowMs) || windowMs <= 0) throw new Error("limiter window must be a positive integer");
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** Records one request for `key`; returns false once the window is spent. */
  take(key: string, now = Date.now()): boolean {
    if (this.windows.size > 10_000) this.prune(now);
    const window = this.windows.get(key);
    if (!window || window.resetsAt <= now) {
      this.windows.set(key, { count: 1, resetsAt: now + this.windowMs });
      return true;
    }
    if (window.count >= this.limit) return false;
    window.count += 1;
    return true;
  }

  private prune(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetsAt <= now) this.windows.delete(key);
    }
  }
}

/** Caps the total wei the sponsor signs for in one UTC day. */
export class DailySpendCap {
  private day = "";
  private spent = 0n;
  private readonly capWei: bigint;

  constructor(capWei: bigint) {
    if (capWei <= 0n) throw new Error("daily spend cap must be positive");
    this.capWei = capWei;
  }

  reserve(amountWei: bigint, now = Date.now()): boolean {
    const day = new Date(now).toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.spent = 0n;
    }
    if (amountWei <= 0n || this.spent + amountWei > this.capWei) return false;
    this.spent += amountWei;
    return true;
  }

  release(amountWei: bigint): void {
    this.spent = this.spent > amountWei ? this.spent - amountWei : 0n;
  }
}
