import type { Address, Hex } from "../src/relayer/types.ts";
import { JsonRpcClient } from "../src/relayer/rpc.ts";
import {
  assertAddress,
  assertUserOperationHash,
  assertQuantity,
  toQuantity,
} from "../src/relayer/types.ts";

export interface BootstrapReceiptSummary {
  userOpHash: Hex;
  sender: Address;
  nonce: Hex;
  success: boolean;
  actualGasCost: Hex;
  actualGasUsed: Hex;
  transactionHash: Hex;
  blockNumber: Hex;
  transactionSucceeded: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * OKBund returns some receipt quantities as JSON numbers while the ERC-4337
 * RPC shape normally uses hex quantity strings. Normalize both forms before
 * exposing the receipt to the rest of the relayer.
 */
function receiptQuantity(value: unknown, name: string): Hex {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${name} must be a non-negative safe integer or hex quantity`);
    }
    return toQuantity(BigInt(value), name);
  }
  assertQuantity(value, name);
  return value;
}

export function parseBootstrapReceipt(
  value: unknown,
  expectedHash: Hex,
  expectedSender: Address,
): BootstrapReceiptSummary {
  if (!isRecord(value)) throw new Error("private bundler returned a malformed UserOperation receipt");
  assertUserOperationHash(value.userOpHash, "receipt.userOpHash");
  assertAddress(value.sender, "receipt.sender");
  const nonce = receiptQuantity(value.nonce, "receipt.nonce");
  const actualGasCost = receiptQuantity(value.actualGasCost, "receipt.actualGasCost");
  const actualGasUsed = receiptQuantity(value.actualGasUsed, "receipt.actualGasUsed");
  if (typeof value.success !== "boolean") throw new Error("receipt.success must be boolean");
  if (!isRecord(value.receipt)) throw new Error("receipt.receipt is missing");
  assertUserOperationHash(value.receipt.transactionHash, "receipt.transactionHash");
  const blockNumber = receiptQuantity(value.receipt.blockNumber, "receipt.blockNumber");
  const status = receiptQuantity(value.receipt.status, "receipt.status");

  if (value.userOpHash.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new Error("private bundler receipt is for a different UserOperation hash");
  }
  if (value.sender.toLowerCase() !== expectedSender.toLowerCase()) {
    throw new Error("private bundler receipt is for a different sender");
  }

  return {
    userOpHash: value.userOpHash,
    sender: value.sender,
    nonce,
    success: value.success,
    actualGasCost,
    actualGasUsed,
    transactionHash: value.receipt.transactionHash,
    blockNumber,
    transactionSucceeded: BigInt(status) === 1n,
  };
}

export async function waitForBootstrapReceipt(
  bundler: JsonRpcClient,
  userOpHash: Hex,
  sender: Address,
  timeoutMs = 300_000,
  pollIntervalMs = 2_000,
): Promise<BootstrapReceiptSummary> {
  assertUserOperationHash(userOpHash, "userOpHash");
  assertAddress(sender, "sender");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 900_000) {
    throw new Error("inclusion timeout must be an integer between 10000 and 900000 milliseconds");
  }
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 250 || pollIntervalMs > 10_000) {
    throw new Error("receipt poll interval must be an integer between 250 and 10000 milliseconds");
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const receipt = await bundler.request<unknown | null>("eth_getUserOperationReceipt", [userOpHash]);
    if (receipt !== null) return parseBootstrapReceipt(receipt, userOpHash, sender);
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error(`timed out waiting for inclusion; UserOperation remains submitted: ${userOpHash}`);
}
