import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";
import type { Address, Hex, RpcUserOperationV07 } from "../src/relayer/types.ts";
import {
  assertAddress,
  assertRpcUserOperationV07,
  assertUserOperationHash,
} from "../src/relayer/types.ts";

export const BOOTSTRAP_CHAIN_ID = 196;
export const BOOTSTRAP_ENTRY_POINT_V07 = "0x0000000071727de22e5e9d8baf0edac6f37da032" as Address;

export interface BootstrapOperationRecord {
  chainId: number;
  entryPoint: Address;
  paymaster: Address;
  userOpHash: Hex;
  userOperation: RpcUserOperationV07;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readBootstrapOperationRecord(
  operationPath: string,
  expectedPaymaster?: Address,
): Promise<BootstrapOperationRecord> {
  const handle = await open(operationPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  let contents: string;
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new Error("bootstrap operation path must be a regular file");
    if ((stats.mode & 0o077) !== 0) {
      throw new Error("bootstrap operation file permissions must be restricted to its owner (mode 0600)");
    }
    contents = await handle.readFile("utf8");
  } finally {
    await handle.close();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error("bootstrap operation file is not valid JSON");
  }
  if (!isRecord(parsed)) throw new Error("bootstrap operation file must contain an object");
  if (parsed.chainId !== BOOTSTRAP_CHAIN_ID) {
    throw new Error("bootstrap operation file is not for X Layer chain 196");
  }
  assertAddress(parsed.entryPoint, "bootstrap operation EntryPoint");
  if (parsed.entryPoint.toLowerCase() !== BOOTSTRAP_ENTRY_POINT_V07.toLowerCase()) {
    throw new Error("bootstrap operation file uses a different EntryPoint");
  }
  assertAddress(parsed.paymaster, "bootstrap operation paymaster");
  if (expectedPaymaster && parsed.paymaster.toLowerCase() !== expectedPaymaster.toLowerCase()) {
    throw new Error("bootstrap operation file uses a different paymaster");
  }
  assertUserOperationHash(parsed.userOpHash, "bootstrap operation hash");
  assertRpcUserOperationV07(parsed.userOperation);
  if (parsed.userOperation.paymaster?.toLowerCase() !== parsed.paymaster.toLowerCase()) {
    throw new Error("bootstrap UserOperation is not sponsored by the paymaster in the operation file");
  }
  if (parsed.userOperation.signature === "0x") {
    throw new Error("bootstrap UserOperation has no account signature");
  }

  return {
    chainId: parsed.chainId,
    entryPoint: parsed.entryPoint,
    paymaster: parsed.paymaster,
    userOpHash: parsed.userOpHash,
    userOperation: parsed.userOperation,
  };
}

export function bootstrapOperationFilePath(): string {
  return process.env.BOOTSTRAP_OPERATION_FILE?.trim() || "/tmp/convey-bootstrap-operation.json";
}
