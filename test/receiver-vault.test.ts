import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import {
  enrollReceiverKey,
  recoverReceiverKey,
  rewrapRecoveredReceiverKey,
  unlockReceiverKey,
} from "../src/receiver/vault.ts";
import { createBrowserReceiverVaultStorage, storedReceiverVault } from "../src/receiver/storage.ts";

const prf = (fill: number) => new Uint8Array(32).fill(fill);

test("receiver key enrolls, unlocks, and matches its public owner", async () => {
  const enrollment = await enrollReceiverKey("credential-one", prf(1));
  const privateKey = await unlockReceiverKey(enrollment.vault, prf(1));
  assert.equal(privateKeyToAccount(privateKey).address, enrollment.vault.owner);
  assert.notEqual(enrollment.vault.ciphertext, privateKey);
});

test("wrong PRF output cannot unlock the receiver vault", async () => {
  const enrollment = await enrollReceiverKey("credential-one", prf(2));
  await assert.rejects(unlockReceiverKey(enrollment.vault, prf(3)), /could not be unlocked/);
});

test("recovery key restores and rewraps the same owner for a new credential", async () => {
  const enrollment = await enrollReceiverKey("credential-one", prf(4));
  const recovered = await recoverReceiverKey(enrollment.recovery, enrollment.recoveryKey);
  assert.equal(privateKeyToAccount(recovered).address, enrollment.vault.owner);

  const migrated = await rewrapRecoveredReceiverKey(
    enrollment.recovery,
    enrollment.recoveryKey,
    "credential-two",
    prf(5),
  );
  const migratedKey = await unlockReceiverKey(migrated, prf(5));
  assert.equal(privateKeyToAccount(migratedKey).address, enrollment.vault.owner);
  await assert.rejects(unlockReceiverKey(migrated, prf(4)), /could not be unlocked/);
});

test("tampering with encrypted receiver material fails closed", async () => {
  const enrollment = await enrollReceiverKey("credential-one", prf(6));
  const last = enrollment.vault.ciphertext.at(-1);
  const ciphertext = `${enrollment.vault.ciphertext.slice(0, -1)}${last === "0" ? "1" : "0"}` as const;
  await assert.rejects(
    unlockReceiverKey({ ...enrollment.vault, ciphertext }, prf(6)),
    /could not be unlocked/,
  );
});

test("browser storage persists only encrypted receiver material", async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: () => null,
    length: 0,
  } as Storage;
  const enrollment = await enrollReceiverKey("credential-one", prf(7));
  const adapter = createBrowserReceiverVaultStorage(storage);
  adapter.save(storedReceiverVault(enrollment, "0x010203".padEnd(66, "0") as `0x${string}`));
  const serialized = values.values().next().value as string;
  assert.equal(serialized.includes(enrollment.recoveryKey), false);
  assert.equal(adapter.load()?.vault.owner, enrollment.vault.owner);
  adapter.clear();
  assert.equal(adapter.load(), null);
});
