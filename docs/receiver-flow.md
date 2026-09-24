# Receiver enrollment and claim flow

The receiver starts with no wallet, OKB, account, or app install. Convey creates
the owner key locally, protects it with a PRF-capable passkey, and keeps the
encrypted vault in browser storage. The private key is never sent to Convey's
gateway or bundler.

1. `enrollReceiverAccount()` creates a discoverable WebAuthn passkey, evaluates
   its PRF, generates the OKX owner key with Web Crypto, and persists only the
   encrypted vault, PRF salt, and recovery envelope.
2. The UI displays the returned `recoveryKey` once and requires the receiver to
   save it outside the device. It is not persisted in browser storage.
3. `unlockReceiverAccount()` evaluates the passkey PRF and returns a short-lived
   signer adapter for the deployed OKX Smart Wallet owner. The account remains
   counterfactual until the claim operation needs deployment.
4. The receiver parses `/g/<secret>?giftId=<id>`, reads the live escrow record,
   and shows only chain-backed gift details. The `giftId` is a non-secret lookup
   hint; possession of the secret is still required.
5. `buildReceiverClaim()` builds an unsigned operation with a zeroed
   authorization field, asks Convey's authenticated private gateway to sign the
   live operation fields, then signs the exact authorized operation locally.
   `ConveyRelayerClient.submitClaim()` sends it only to the private gateway and
   OKBund. There is no public-mempool fallback.

The claim is gasless for the receiver. The sender-funded reserve is already
locked in the live claim paymaster at gift creation; no token-price conversion or
native-gas purchase occurs on the claim path.

The deployed receiver account is the verified OKX Smart Wallet at ERC-4337
EntryPoint v0.7. Its inspected implementation is modular but does not implement
ERC-7579, so Convey describes it accurately and does not claim ERC-7579 support.

Recovery creates a new passkey on the replacement device, decrypts the existing
owner key with the one-time recovery key, and re-encrypts that same owner under
the new credential. The recovery envelope is retained so the recovery key can
be used again if the new vault is lost; the application must rotate or revoke
that recovery material as a separate product decision.

The browser integration still needs a real PRF-capable browser/device test and
an authenticated HTTPS edge in front of the private gateway. Until those are
proven, this library path is not described as product-complete.

The Next.js surface in `app/g/[secret]` is intentionally live-data-only: it
reads the escrow and registry from the configured public X Layer RPC, fetches
the issuer value for wrapped xStocks, and never invents a balance or USD
amount. The `/api/relay/*` route is a same-origin server proxy; its relay URL
and bearer token are server-only environment variables.
