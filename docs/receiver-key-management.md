# Receiver key enrollment and recovery

Status: encrypted vault and receiver-flow integration implemented; the public
HTTPS web edge is deployed, while the real browser ceremony and live
owner-management proof remain open.

Convey's deployed OKX Smart Wallet uses its built-in ECDSA validator. Each
receiver therefore needs a dedicated secp256k1 owner key. Convey must never
send that private key to the gateway, bundler, sponsor, or application server.

[`src/receiver/vault.ts`](../src/receiver/vault.ts) implements the storage
boundary:

- Generate the 32-byte owner key with Web Crypto on the receiver device.
- Derive an AES-256-GCM key from a WebAuthn PRF output using HKDF-SHA-256 with a
  random 32-byte salt and a Convey/version-specific context.
- Bind the encrypted record to its version, OKX owner address, and WebAuthn
  credential ID as authenticated data.
- Create a separate recovery envelope encrypted by a random 32-byte recovery
  key. The recovery key is returned once for the receiver to store outside the
  device; it is not part of the vault and must not be sent to Convey.
- On migration, decrypt with that recovery key and re-encrypt the same OKX
  owner under a new credential's PRF output. The owner address and `keyHash`
  remain unchanged.

[`src/receiver/passkey.ts`](../src/receiver/passkey.ts) implements the browser
ceremony boundary. It creates a discoverable passkey with required user
verification, rejects authenticators that do not advertise WebAuthn PRF,
evaluates a per-vault random PRF salt, and can obtain the same PRF output during
unlock. Challenges are generated freshly for each local ceremony. This module
uses passkeys only to unlock local encryption; it does not treat that ceremony
as server authentication.

The module fails closed on the wrong PRF output, wrong recovery key, modified
ciphertext, modified owner metadata, or unsupported record version. Tests cover
normal unlock, wrong-PRF rejection, recovery and migration, and tampering.

## Deliberate boundary

This is recovery of the existing owner key, not email recovery and not on-chain
owner rotation. It does not establish that a browser supports the WebAuthn PRF
extension or that a credential is synchronized safely across devices. The
sender/receiver application must:

1. integrate the PRF-capable WebAuthn ceremony into the receiver UI and test
   the supported browser/authenticator matrix;
2. persist only the encrypted vault, PRF salt, and recovery envelope;
3. show the recovery key once and require an explicit save confirmation;
4. keep decrypted key material in memory only for the shortest signing window;
5. prove enrollment, migration, and claim signing in supported browsers; and
6. separately inspect and test the deployed OKX owner-management calls before
   claiming on-chain owner revocation or replacement.

Until those browser and on-chain checks pass, receiver enrollment and recovery
remain in progress rather than product-complete.
