import { keccak256, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const VAULT_VERSION = 1 as const;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const SALT_BYTES = 32;
const PRF_CONTEXT = new TextEncoder().encode("convey/receiver-vault/prf/v1");
const RECOVERY_CONTEXT = new TextEncoder().encode("convey/receiver-vault/recovery/v1");

export interface ReceiverVaultCiphertext {
  version: typeof VAULT_VERSION;
  credentialId: string;
  owner: Address;
  keyHash: Hex;
  salt: Hex;
  iv: Hex;
  ciphertext: Hex;
}

export interface ReceiverRecoveryEnvelope {
  version: typeof VAULT_VERSION;
  owner: Address;
  salt: Hex;
  iv: Hex;
  ciphertext: Hex;
}

export interface ReceiverEnrollment {
  vault: ReceiverVaultCiphertext;
  recovery: ReceiverRecoveryEnvelope;
  /** Display once and require the receiver to save it outside the device. */
  recoveryKey: Hex;
}

function requireCrypto(): Crypto {
  const value = globalThis.crypto;
  if (!value?.subtle || typeof value.getRandomValues !== "function") {
    throw new Error("Web Crypto is required for receiver key enrollment");
  }
  return value;
}

function randomBytes(length: number): Uint8Array {
  return requireCrypto().getRandomValues(new Uint8Array(length));
}

function bytesToHex(bytes: Uint8Array): Hex {
  return `0x${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}` as Hex;
}

function hexToBytes(value: Hex, expectedLength?: number): Uint8Array {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) throw new Error("expected a byte-aligned hex value");
  const bytes = new Uint8Array((value.length - 2) / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(2 + index * 2, 4 + index * 2), 16);
  }
  if (expectedLength !== undefined && bytes.length !== expectedLength) {
    throw new Error(`expected ${expectedLength} bytes`);
  }
  return bytes;
}

function aad(version: number, owner: Address, credentialId?: string): Uint8Array {
  return new TextEncoder().encode(`${version}:${owner.toLowerCase()}:${credentialId ?? "recovery"}`);
}

async function deriveAesKey(material: Uint8Array, salt: Uint8Array, info: Uint8Array): Promise<CryptoKey> {
  if (material.length < KEY_BYTES) throw new Error("key material must contain at least 32 bytes");
  const crypto = requireCrypto();
  const baseKey = await crypto.subtle.importKey("raw", material, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptPrivateKey(
  privateKey: Hex,
  material: Uint8Array,
  context: Uint8Array,
  owner: Address,
  credentialId?: string,
): Promise<{ salt: Hex; iv: Hex; ciphertext: Hex }> {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveAesKey(material, salt, context);
  const ciphertext = await requireCrypto().subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad(VAULT_VERSION, owner, credentialId), tagLength: 128 },
    key,
    hexToBytes(privateKey, KEY_BYTES),
  );
  return { salt: bytesToHex(salt), iv: bytesToHex(iv), ciphertext: bytesToHex(new Uint8Array(ciphertext)) };
}

async function decryptPrivateKey(
  envelope: { version: number; owner: Address; salt: Hex; iv: Hex; ciphertext: Hex },
  material: Uint8Array,
  context: Uint8Array,
  credentialId?: string,
): Promise<Hex> {
  if (envelope.version !== VAULT_VERSION) throw new Error(`unsupported receiver vault version ${envelope.version}`);
  const key = await deriveAesKey(material, hexToBytes(envelope.salt, SALT_BYTES), context);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await requireCrypto().subtle.decrypt(
      {
        name: "AES-GCM",
        iv: hexToBytes(envelope.iv, IV_BYTES),
        additionalData: aad(envelope.version, envelope.owner, credentialId),
        tagLength: 128,
      },
      key,
      hexToBytes(envelope.ciphertext),
    );
  } catch {
    throw new Error("receiver vault could not be unlocked");
  }
  const privateKey = bytesToHex(new Uint8Array(plaintext));
  hexToBytes(privateKey, KEY_BYTES);
  if (privateKeyToAccount(privateKey).address.toLowerCase() !== envelope.owner.toLowerCase()) {
    throw new Error("receiver vault owner verification failed");
  }
  return privateKey;
}

export async function enrollReceiverKey(credentialId: string, prfOutput: Uint8Array): Promise<ReceiverEnrollment> {
  if (!credentialId.trim()) throw new Error("credentialId is required");
  const privateKey = bytesToHex(randomBytes(KEY_BYTES));
  const account = privateKeyToAccount(privateKey);
  const keyHash = keccak256(account.address);
  const recoveryKeyBytes = randomBytes(KEY_BYTES);
  const [encryptedVault, encryptedRecovery] = await Promise.all([
    encryptPrivateKey(privateKey, prfOutput, PRF_CONTEXT, account.address, credentialId),
    encryptPrivateKey(privateKey, recoveryKeyBytes, RECOVERY_CONTEXT, account.address),
  ]);
  return {
    vault: { version: VAULT_VERSION, credentialId, owner: account.address, keyHash, ...encryptedVault },
    recovery: { version: VAULT_VERSION, owner: account.address, ...encryptedRecovery },
    recoveryKey: bytesToHex(recoveryKeyBytes),
  };
}

export async function unlockReceiverKey(vault: ReceiverVaultCiphertext, prfOutput: Uint8Array): Promise<Hex> {
  const privateKey = await decryptPrivateKey(vault, prfOutput, PRF_CONTEXT, vault.credentialId);
  if (keccak256(privateKeyToAccount(privateKey).address).toLowerCase() !== vault.keyHash.toLowerCase()) {
    throw new Error("receiver vault key hash verification failed");
  }
  return privateKey;
}

export async function recoverReceiverKey(recovery: ReceiverRecoveryEnvelope, recoveryKey: Hex): Promise<Hex> {
  return decryptPrivateKey(recovery, hexToBytes(recoveryKey, KEY_BYTES), RECOVERY_CONTEXT);
}

export async function rewrapRecoveredReceiverKey(
  recovery: ReceiverRecoveryEnvelope,
  recoveryKey: Hex,
  newCredentialId: string,
  newPrfOutput: Uint8Array,
): Promise<ReceiverVaultCiphertext> {
  if (!newCredentialId.trim()) throw new Error("newCredentialId is required");
  const privateKey = await recoverReceiverKey(recovery, recoveryKey);
  const account = privateKeyToAccount(privateKey);
  const encrypted = await encryptPrivateKey(privateKey, newPrfOutput, PRF_CONTEXT, account.address, newCredentialId);
  return {
    version: VAULT_VERSION,
    credentialId: newCredentialId,
    owner: account.address,
    keyHash: keccak256(account.address),
    ...encrypted,
  };
}
