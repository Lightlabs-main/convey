import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BOOTSTRAP_ENTRY_POINT_V07,
  readBootstrapOperationRecord,
} from "../script/bootstrap-operation-record.ts";
import { parseBootstrapReceipt } from "../script/bootstrap-operation-receipt.ts";
import type { Address, Hex, RpcUserOperationV07 } from "../src/relayer/types.ts";

const sender = "0x1111111111111111111111111111111111111111" as Address;
const paymaster = "0x2222222222222222222222222222222222222222" as Address;
const userOpHash = `0x${"ab".repeat(32)}` as Hex;
const transactionHash = `0x${"cd".repeat(32)}` as Hex;

const userOperation: RpcUserOperationV07 = {
  sender,
  nonce: "0x0",
  callData: "0x12345678",
  callGasLimit: "0x10000",
  verificationGasLimit: "0x20000",
  preVerificationGas: "0x5000",
  maxFeePerGas: "0x10",
  maxPriorityFeePerGas: "0x2",
  paymaster,
  paymasterVerificationGasLimit: "0x10000",
  paymasterPostOpGasLimit: "0x0",
  paymasterData: "0x",
  signature: "0x1234",
};

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    userOpHash,
    sender,
    nonce: "0x0",
    actualGasCost: "0x1234",
    actualGasUsed: "0x5678",
    success: true,
    receipt: {
      transactionHash,
      blockNumber: "0x123",
      status: "0x1",
    },
    ...overrides,
  };
}

test("bootstrap receipt parser captures included UserOperation and transaction evidence", () => {
  assert.deepEqual(parseBootstrapReceipt(receipt(), userOpHash, sender), {
    userOpHash,
    sender,
    nonce: "0x0",
    success: true,
    actualGasCost: "0x1234",
    actualGasUsed: "0x5678",
    transactionHash,
    blockNumber: "0x123",
    transactionSucceeded: true,
  });
});

test("bootstrap receipt parser preserves included failures", () => {
  const userOperationFailure = parseBootstrapReceipt(receipt({ success: false }), userOpHash, sender);
  assert.equal(userOperationFailure.success, false);
  assert.equal(userOperationFailure.transactionSucceeded, true);

  const transactionFailure = parseBootstrapReceipt(receipt({
    receipt: { transactionHash, blockNumber: "0x123", status: "0x0" },
  }), userOpHash, sender);
  assert.equal(transactionFailure.success, true);
  assert.equal(transactionFailure.transactionSucceeded, false);
});

test("bootstrap receipt parser rejects another operation, sender, or malformed transaction evidence", () => {
  assert.throws(() => parseBootstrapReceipt(receipt(), `0x${"ef".repeat(32)}` as Hex, sender), /different UserOperation hash/);
  assert.throws(() => parseBootstrapReceipt(receipt({ sender: paymaster }), userOpHash, sender), /different sender/);
  assert.throws(() => parseBootstrapReceipt(receipt({
    receipt: { transactionHash: "0x12", blockNumber: "0x123", status: "0x1" },
  }), userOpHash, sender), /transactionHash/);
});

test("bootstrap operation reader requires owner-only regular files and validates the operation envelope", async () => {
  const directory = await mkdtemp(join(tmpdir(), "convey-bootstrap-receipt-"));
  const operationPath = join(directory, "operation.json");
  const targetPath = join(directory, "target.json");
  const record = {
    chainId: 196,
    entryPoint: BOOTSTRAP_ENTRY_POINT_V07,
    paymaster,
    userOpHash,
    userOperation,
  };
  try {
    await writeFile(operationPath, JSON.stringify(record), { mode: 0o600 });
    const loaded = await readBootstrapOperationRecord(operationPath, paymaster);
    assert.equal(loaded.userOpHash, userOpHash);
    assert.equal(loaded.userOperation.sender, sender);

    await chmod(operationPath, 0o644);
    await assert.rejects(readBootstrapOperationRecord(operationPath), /permissions/);
    await writeFile(targetPath, await readFile(operationPath));
    await rm(operationPath);
    await symlink(targetPath, operationPath);
    await assert.rejects(readBootstrapOperationRecord(operationPath));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
