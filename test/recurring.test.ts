import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPlan, isDue, PlanStore, recordSent, remainingGifts, toUnits } from "../mcp/recurring.ts";

const day = 86_400;
const t0 = new Date("2026-10-01T00:00:00Z");
const at = (seconds: number) => new Date(t0.getTime() + seconds * 1000);
const gift = (id: string) => ({ giftId: id, claimLink: `https://conveyapp.site/g/x?giftId=${id}`, transaction: "0x", sentAt: t0.toISOString() });

test("recurring plans enforce the per-gift cap, budget and minimum interval", () => {
  const base = { ticker: "AAPLx", amountPerGift: "0.01", intervalSeconds: 30 * day, totalBudget: "0.03", recipient: "Maya" };
  assert.throws(() => createPlan({ ...base, amountPerGift: "0.05" }, "0.02", t0), /per-gift cap/);
  assert.throws(() => createPlan({ ...base, totalBudget: "0.005" }, "0.02", t0), /at least one gift/);
  assert.throws(() => createPlan({ ...base, intervalSeconds: 60 }, "0.02", t0), /at least one hour/);
  assert.throws(() => createPlan({ ...base, amountPerGift: "0" }, "0.02", t0), /greater than zero/);
  const plan = createPlan(base, "0.02", t0);
  assert.equal(remainingGifts(plan), 3);
  assert.equal(toUnits("0.1") + toUnits("0.2"), toUnits("0.3"), "amounts use exact decimal arithmetic");
});

test("a plan sends once per period, skips missed periods and completes at its budget", () => {
  const plan = createPlan({ ticker: "AAPLx", amountPerGift: "0.01", intervalSeconds: 30 * day, totalBudget: "0.025", recipient: "Maya" }, "0.02", t0);
  assert.equal(isDue(plan, t0), true);
  recordSent(plan, gift("1"), t0);
  assert.equal(isDue(plan, at(29 * day)), false, "not due before the interval");
  assert.equal(plan.nextRunAt, at(30 * day).toISOString());

  // The scheduler was down for 95 days: one gift now, then a full interval.
  assert.equal(isDue(plan, at(95 * day)), true);
  recordSent(plan, gift("2"), at(95 * day));
  assert.equal(plan.nextRunAt, at(125 * day).toISOString(), "missed periods are skipped, not batched");

  // 0.025 budget / 0.01 per gift = 2 gifts, so the plan is complete.
  assert.equal(plan.status, "completed");
  assert.equal(isDue(plan, at(400 * day)), false);
});

test("a plan in flight or cancelled is never due", () => {
  const plan = createPlan({ ticker: "NVDAx", amountPerGift: "0.01", intervalSeconds: day, totalBudget: "1", recipient: "Sam" }, "0.02", t0);
  plan.inFlight = { since: t0.toISOString(), secret: `0x${"11".repeat(32)}` };
  assert.equal(isDue(plan, at(day)), false);
  plan.inFlight = undefined;
  plan.status = "cancelled";
  assert.equal(isDue(plan, at(day)), false);
});

test("plan store persists plans and refuses overlapping runs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "convey-plans-"));
  const store = new PlanStore(join(dir, "plans.json"));
  assert.deepEqual(store.read(), []);
  const plan = createPlan({ ticker: "TSLAx", amountPerGift: "0.01", intervalSeconds: day, totalBudget: "0.02", recipient: "Lee" }, "0.02", t0);
  store.write([plan]);
  store.update(plan.id, (stored) => { stored.status = "cancelled"; });
  assert.equal(store.read()[0].status, "cancelled");

  await store.withLock(async () => {
    await assert.rejects(store.withLock(async () => undefined), /in progress/);
  });
  await store.withLock(async () => undefined);

  writeFileSync(join(dir, "plans.json.lock"), "");
  await assert.rejects(store.withLock(async () => undefined), /in progress/, "a fresh lock from another process blocks");
});
