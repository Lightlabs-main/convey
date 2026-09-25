import assert from "node:assert/strict";
import test from "node:test";
import { planPaymasterTopUp } from "../src/relayer/operations.ts";

test("paymaster top-up planning only funds the shortfall", () => {
  assert.deepEqual(
    planPaymasterTopUp(
      { depositWei: 7n, stakeWei: 2n, staked: true },
      { depositWei: 10n, stakeWei: 5n },
    ),
    { depositWei: 3n, stakeWei: 3n, needsStake: true },
  );
});

test("paymaster top-up planning does not add stake when an adequate stake is active", () => {
  assert.deepEqual(
    planPaymasterTopUp(
      { depositWei: 10n, stakeWei: 5n, staked: true },
      { depositWei: 10n, stakeWei: 5n },
    ),
    { depositWei: 0n, stakeWei: 0n, needsStake: false },
  );
});

test("paymaster top-up planning rejects zero targets", () => {
  assert.throws(
    () => planPaymasterTopUp({ depositWei: 1n, stakeWei: 1n, staked: true }, { depositWei: 0n, stakeWei: 1n }),
    /targets must be greater than zero/,
  );
});
