import type { Hex } from "viem";
import type { ReceiverEnrollment, ReceiverRecoveryEnvelope, ReceiverVaultCiphertext } from "./vault.ts";

export interface StoredReceiverVault {
  version: 1;
  vault: ReceiverVaultCiphertext;
  recovery: ReceiverRecoveryEnvelope;
  prfSalt: Hex;
}

export interface ReceiverVaultStorage {
  load(): StoredReceiverVault | null;
  save(value: StoredReceiverVault): void;
  clear(): void;
}

const STORAGE_KEY = "convey.receiver.vault.v1";

function assertStored(value: unknown): asserts value is StoredReceiverVault {
  if (!value || typeof value !== "object") throw new Error("stored receiver vault is invalid");
  const record = value as Partial<StoredReceiverVault>;
  if (record.version !== 1 || !record.vault || !record.recovery || typeof record.prfSalt !== "string") {
    throw new Error("stored receiver vault is invalid");
  }
}

export function createBrowserReceiverVaultStorage(storage: Storage = globalThis.localStorage): ReceiverVaultStorage {
  return {
    load(): StoredReceiverVault | null {
      const serialized = storage.getItem(STORAGE_KEY);
      if (serialized === null) return null;
      let value: unknown;
      try {
        value = JSON.parse(serialized);
      } catch {
        throw new Error("stored receiver vault is not valid JSON");
      }
      assertStored(value);
      return value;
    },
    save(value: StoredReceiverVault): void {
      assertStored(value);
      storage.setItem(STORAGE_KEY, JSON.stringify(value));
    },
    clear(): void {
      storage.removeItem(STORAGE_KEY);
    },
  };
}

export function storedReceiverVault(enrollment: ReceiverEnrollment, prfSalt: Hex): StoredReceiverVault {
  return { version: 1, vault: enrollment.vault, recovery: enrollment.recovery, prfSalt };
}
