import assert from "node:assert/strict";
import test from "node:test";
import { DailySpendCap, FixedWindowLimiter } from "../src/relayer/limits.ts";
import { assertRelayerAuthConfigured } from "../src/relayer/server.ts";

test("fixed-window limiter blocks a key after its budget and resets after the window", () => {
  const limiter = new FixedWindowLimiter(2, 1_000);
  assert.equal(limiter.take("a", 0), true);
  assert.equal(limiter.take("a", 10), true);
  assert.equal(limiter.take("a", 20), false);
  assert.equal(limiter.take("b", 20), true, "keys are independent");
  assert.equal(limiter.take("a", 1_000), true, "window resets");
});

test("daily exit spend cap refuses sponsorship past the cap and resets at UTC midnight", () => {
  const cap = new DailySpendCap(100n);
  const day = Date.UTC(2026, 8, 25, 12);
  assert.equal(cap.reserve(60n, day), true);
  assert.equal(cap.reserve(50n, day), false);
  cap.release(60n);
  assert.equal(cap.reserve(100n, day), true);
  assert.equal(cap.reserve(1n, day), false);
  assert.equal(cap.reserve(100n, Date.UTC(2026, 8, 26, 0)), true);
});

test("relayer refuses to start without a bearer token outside loopback development", () => {
  const token = "t".repeat(32);
  assert.doesNotThrow(() => assertRelayerAuthConfigured({ authToken: token, bindAddress: "0.0.0.0" }));
  assert.throws(() => assertRelayerAuthConfigured({ bindAddress: "127.0.0.1" }), /CONVEY_RELAYER_AUTH_TOKEN is required/);
  assert.throws(() => assertRelayerAuthConfigured({ bindAddress: "0.0.0.0", allowUnauthenticated: true }), /required/);
  assert.throws(() => assertRelayerAuthConfigured({ authToken: "short", bindAddress: "127.0.0.1" }), /at least 32/);
  assert.doesNotThrow(() => assertRelayerAuthConfigured({ bindAddress: "127.0.0.1", allowUnauthenticated: true }));
});
