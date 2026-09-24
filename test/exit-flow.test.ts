import assert from "node:assert/strict";
import test from "node:test";
import { buildCashOutCalls, buildWithdrawalCall, encodeOkxExitExecution, assertExitExecutionCalldata } from "../src/relayer/exit-policy.ts";
import { encodeExitPaymasterData, exitPaymasterActionHash } from "../src/relayer/exit-paymaster.ts";
import type { Address, Hex } from "../src/relayer/types.ts";

const asset = "0x00000000000000000000000000000000000000a1" as Address;
const router = "0x00000000000000000000000000000000000000a2" as Address;
const usdt0 = "0x00000000000000000000000000000000000000a3" as Address;
const receiver = "0x00000000000000000000000000000000000000a4" as Address;
const recipient = "0x00000000000000000000000000000000000000a5" as Address;
const path = `0x${asset.slice(2)}0001f4${usdt0.slice(2)}` as Hex;

test("exit policy encodes and accepts a live withdrawal", () => {
  const callData = encodeOkxExitExecution([buildWithdrawalCall(asset, recipient, 10n)]);
  assert.doesNotThrow(() => assertExitExecutionCalldata(callData, receiver, [asset], router, usdt0));
  assert.throws(() => assertExitExecutionCalldata(callData, receiver, [], router, usdt0), /not an enabled asset/);
});

test("exit policy requires a three-call cash-out and reset", () => {
  const calls = buildCashOutCalls({
    inputToken: asset,
    router,
    path,
    recipient: receiver,
    amountIn: 10n,
    amountOutMinimum: 9n,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 60),
  });
  const callData = encodeOkxExitExecution(calls);
  assert.doesNotThrow(() => assertExitExecutionCalldata(callData, receiver, [asset], router, usdt0));
  calls[2] = { ...calls[2], data: calls[0].data };
  assert.throws(() => assertExitExecutionCalldata(encodeOkxExitExecution(calls), receiver, [asset], router, usdt0), /cash-out approval reset/);
});

test("exit paymaster payload binds the call hash and stays fixed width", () => {
  const callData = encodeOkxExitExecution([buildWithdrawalCall(asset, recipient, 10n)]);
  const actionHash = exitPaymasterActionHash(callData);
  const payload = encodeExitPaymasterData({
    entryPoint: "0x0000000071727de22e5e9d8baf0edac6f37da032" as Address,
    paymaster: "0x00000000000000000000000000000000000000a6" as Address,
    actionHash,
    maxCost: 1n,
    paymasterVerificationGasLimit: 1n,
    paymasterPostOpGasLimit: 1n,
    validAfter: 1n,
    validUntil: 2n,
    sponsorNonce: 0n,
  }, `0x${"11".repeat(65)}` as Hex);
  assert.equal((payload.length - 2) / 2, 141);
  assert.equal(payload.slice(2, 66), actionHash.slice(2));
});
