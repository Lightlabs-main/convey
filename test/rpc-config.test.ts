import assert from "node:assert/strict";
import test from "node:test";
import { redactRpcUrl, resolveBundlerExecutionRpcUrl } from "../script/rpc-config.ts";

test("private bundler RPC prefers an explicit operator endpoint", () => {
  const url = resolveBundlerExecutionRpcUrl({
    BUNDLER_EXECUTION_RPC_URL: "https://private.example/rpc",
    NODEFLARE_API_KEY: "nodeflare-secret",
    XLAYER_RPC_URL: "https://rpc.xlayer.tech",
  });
  assert.equal(url, "https://private.example/rpc");
});

test("private bundler RPC derives the keyed NodeFlare X Layer endpoint", () => {
  const url = resolveBundlerExecutionRpcUrl({
    NODEFLARE_API_KEY: "nodeflare-secret",
    XLAYER_RPC_URL: "https://rpc.xlayer.tech",
  });
  assert.equal(url, "https://rpc.nodeflare.app/xlayer/v1/nodeflare-secret");
});

test("RPC logs redact provider paths that can contain credentials", () => {
  const sanitized = redactRpcUrl("https://rpc.nodeflare.app/xlayer/v1/nodeflare-secret?token=also-secret");
  assert.equal(sanitized, "https://rpc.nodeflare.app/[RPC path redacted]");
  assert.equal(sanitized.includes("nodeflare-secret"), false);
  assert.equal(sanitized.includes("also-secret"), false);
});
