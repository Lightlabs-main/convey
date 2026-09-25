import assert from "node:assert/strict";
import test from "node:test";
import { createPublicClient, custom, zeroAddress, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { localAccountProvider } from "../mcp/local-provider.ts";

const reads: string[] = [];
const publicClient = createPublicClient({
  transport: custom({ request: async ({ method }: { method: string }) => { reads.push(method); return "0x1"; } }),
}) as PublicClient;

test("watch-only MCP provider exposes reads but refuses to send", async () => {
  const provider = localAccountProvider(publicClient);
  assert.deepEqual(await provider.request({ method: "eth_requestAccounts" }), [zeroAddress]);
  assert.equal(await provider.request({ method: "eth_chainId" }), "0xc4");
  assert.equal(await provider.request({ method: "eth_blockNumber" }), "0x1");
  assert.ok(reads.includes("eth_blockNumber"), "reads are forwarded to the chain");
  await assert.rejects(
    provider.request({ method: "eth_sendTransaction", params: [{ to: zeroAddress, data: "0x" }] }),
    /No agent wallet is configured/,
  );
});

test("agent MCP provider reports its key's address and rejects foreign senders", async () => {
  const account = privateKeyToAccount(`0x${"42".repeat(32)}`);
  const provider = localAccountProvider(publicClient, account);
  assert.deepEqual(await provider.request({ method: "eth_accounts" }), [account.address]);
  await assert.rejects(
    provider.request({ method: "eth_sendTransaction", params: [{ from: "0x0000000000000000000000000000000000000001", to: zeroAddress }] }),
    /does not match the agent wallet/,
  );
});
