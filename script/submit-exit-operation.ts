import { buildReceiverCashOutCalls, prepareReceiverExit, readReceiverTokenBalance, receiverClaimGasSeedFromLive } from "../src/receiver/flow.ts";
import { receiverSignerFromPrivateKey } from "../src/receiver/signer.ts";
import { ConveyRelayerClient } from "../src/relayer/client.ts";
import { resolveBundlerExecutionRpcUrl } from "./rpc-config.ts";
import type { Address, Hex } from "../src/relayer/types.ts";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function address(name: string): Address {
  const value = required(name);
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${name} must be an address`);
  return value as Address;
}

const executionRpcUrl = resolveBundlerExecutionRpcUrl();
const relay = new ConveyRelayerClient({
  relayUrl: "https://convey.13-62-181-128.sslip.io/api/relay",
  entryPoint: address("NEXT_PUBLIC_CONVEY_ENTRYPOINT_ADDRESS"),
  chainId: 196,
  timeoutMs: 30_000,
});
const account = "0x63B2A84d47cb07fb18EE72Ec386893506Fd963db" as Address;
const asset = address("NEXT_PUBLIC_CONVEY_WNVDA_TOKEN_ADDRESS");
const router = address("NEXT_PUBLIC_CONVEY_EXIT_ROUTER_ADDRESS");
const paymaster = address("NEXT_PUBLIC_CONVEY_EXIT_PAYMASTER_ADDRESS");
const signer = receiverSignerFromPrivateKey(required("SMART_ACCOUNT_OWNER_PRIVATE_KEY") as Hex);
const amountIn = await readReceiverTokenBalance(executionRpcUrl, asset, account);
if (amountIn <= 0n) throw new Error("receiver has no live NVDAx balance to cash out");
const quote = await relay.quoteExit(asset, amountIn);
const calls = buildReceiverCashOutCalls({ inputToken: asset, router, quote, recipient: account, amountIn });
const seed = receiverClaimGasSeedFromLive(await relay.claimGasSeed());
const prepared = await prepareReceiverExit({
  calls,
  executionRpcUrl,
  entryPoint: address("NEXT_PUBLIC_CONVEY_ENTRYPOINT_ADDRESS"),
  factory: address("NEXT_PUBLIC_CONVEY_SMART_WALLET_FACTORY"),
  implementation: address("NEXT_PUBLIC_CONVEY_SMART_WALLET_IMPLEMENTATION"),
  paymaster,
  signer,
  salt: BigInt(required("NEXT_PUBLIC_CONVEY_RECEIVER_SALT")),
  gasSeed: seed,
  relay,
  timeoutMs: 30_000,
});
const accepted = await relay.submitExit(prepared.userOperation.userOperation, {
  idempotencyKey: `cashout-${account.toLowerCase()}-${quote.observedAt}`,
});
const result = await relay.waitForExit(accepted.userOperationHash, { timeoutMs: 180_000, pollMs: 1_000 });
console.log(JSON.stringify({
  account,
  asset,
  amountIn: amountIn.toString(),
  quote,
  userOperationHash: accepted.userOperationHash,
  result,
}, null, 2));
if (result.status !== "confirmed" || result.success !== true) throw new Error("gasless exit was included but did not succeed");
