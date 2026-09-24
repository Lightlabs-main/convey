import type { Hex } from "viem";

export interface ReceiverPasskeyEnrollment {
  credentialId: string;
  prfSalt: Hex;
  prfOutput: Uint8Array;
}

interface PrfClientExtensionResults extends AuthenticationExtensionsClientOutputs {
  prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
}

const random = (length: number): Uint8Array => {
  if (!globalThis.crypto?.getRandomValues) throw new Error("Web Crypto is required for passkey enrollment");
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
};

const toHex = (bytes: Uint8Array): Hex =>
  `0x${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}` as Hex;

const fromHex = (value: Hex): Uint8Array => {
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(value)) throw new Error("invalid PRF salt");
  return Uint8Array.from(value.slice(2).match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
};

const base64url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
};

const unbase64url = (value: string): Uint8Array => {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("invalid passkey credential ID");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
};

function credentials(): CredentialsContainer {
  if (!globalThis.navigator?.credentials) throw new Error("WebAuthn is unavailable in this browser");
  return globalThis.navigator.credentials;
}

export function extractPrfOutput(result: AuthenticationExtensionsClientOutputs): Uint8Array {
  const first = (result as PrfClientExtensionResults).prf?.results?.first;
  if (!(first instanceof ArrayBuffer) || first.byteLength < 32) {
    throw new Error("this passkey did not return a WebAuthn PRF result");
  }
  return new Uint8Array(first);
}

async function evaluatePrf(credentialId: string, prfSalt: Uint8Array, rpId?: string): Promise<Uint8Array> {
  const assertion = await credentials().get({
    publicKey: {
      challenge: random(32),
      rpId,
      allowCredentials: [{ type: "public-key", id: unbase64url(credentialId) }],
      userVerification: "required",
      timeout: 60_000,
      extensions: { prf: { eval: { first: prfSalt } } } as AuthenticationExtensionsClientInputs,
    },
  });
  if (!(assertion instanceof PublicKeyCredential)) throw new Error("passkey assertion was cancelled");
  return extractPrfOutput(assertion.getClientExtensionResults());
}

export async function enrollReceiverPasskey(options: {
  userId: Uint8Array;
  userName: string;
  displayName: string;
  rpName?: string;
  rpId?: string;
}): Promise<ReceiverPasskeyEnrollment> {
  if (options.userId.length < 16) throw new Error("passkey userId must contain at least 16 random bytes");
  if (!options.userName.trim() || !options.displayName.trim()) throw new Error("passkey user name is required");
  const credential = await credentials().create({
    publicKey: {
      challenge: random(32),
      rp: { name: options.rpName ?? "Convey", id: options.rpId },
      user: { id: options.userId, name: options.userName, displayName: options.displayName },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      attestation: "none",
      timeout: 60_000,
      extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
    },
  });
  if (!(credential instanceof PublicKeyCredential)) throw new Error("passkey enrollment was cancelled");
  const extension = credential.getClientExtensionResults() as PrfClientExtensionResults;
  if (extension.prf?.enabled !== true) throw new Error("this authenticator does not support the WebAuthn PRF extension");
  const credentialId = base64url(new Uint8Array(credential.rawId));
  const prfSalt = random(32);
  return { credentialId, prfSalt: toHex(prfSalt), prfOutput: await evaluatePrf(credentialId, prfSalt, options.rpId) };
}

export async function unlockReceiverPasskey(credentialId: string, prfSalt: Hex, rpId?: string): Promise<Uint8Array> {
  const salt = fromHex(prfSalt);
  if (salt.length !== 32) throw new Error("PRF salt must contain exactly 32 bytes");
  return evaluatePrf(credentialId, salt, rpId);
}
