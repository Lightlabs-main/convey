# Receiver enrollment and claim flow

The receiver starts with no wallet, OKB, account, or app install. Convey creates
the owner key locally, protects it with a PRF-capable passkey, and keeps the
encrypted vault in browser storage. The private key is never sent to Convey's
gateway or bundler.

1. `enrollReceiverAccount()` creates a discoverable WebAuthn passkey, evaluates
   its PRF, generates the OKX owner key with Web Crypto, and persists only the
   encrypted vault, PRF salt, and recovery envelope.
2. The UI displays the returned `recoveryKey` once and requires the receiver to
   save it outside the device. It is not persisted in browser storage. It also
   offers an encrypted recovery bundle download; the bundle contains
   ciphertext only and is useless without the separate key.
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
6. `ConveyRelayerClient.claimGasSeed()` reads gas fields from a recorded,
   successful live claim through the private bundler. When OKBund omits the
   optional v0.7 paymaster fields, the gateway recovers the packed operation
   from its recorded EntryPoint bundle transaction and returns only gas/fee
   fields, never calldata or the secret.
7. `prepareReceiverClaim()` authorizes the exact signed operation, calls the
   private bundler's live estimator, and re-builds/re-authorizes if the live
   estimate requires larger limits. The gateway signs the operation's computed
   v0.7 pre-fund, not the policy cap; the cap remains a live safety ceiling.

The claim is gasless for the receiver. The sender-funded reserve is already
locked in the live claim paymaster at gift creation; no token-price conversion or
native-gas purchase occurs on the claim path.

The deployed receiver account is the verified OKX Smart Wallet at ERC-4337
EntryPoint v0.7. Its inspected implementation is modular but does not implement
ERC-7579, so Convey describes it accurately and does not claim ERC-7579 support.

Recovery creates a new passkey on the replacement device, decrypts the existing
owner key with the separate recovery key and encrypted recovery bundle, and
re-encrypts that same owner under the new credential. On the original device,
the retained encrypted envelope may be used without pasting the bundle. The
application must rotate or revoke that recovery material as a separate product
decision.

When a receiver returns to a claimed gift URL on the same device, the UI reads
the live escrow state and the persisted encrypted vault's owner address,
re-derives the deterministic OKX account through the live factory, and requires
the passkey to unlock the signer before enabling cash-out or transfer actions.
The local vault is not treated as proof that a gift was claimed; the live gift
state remains authoritative. A closed gift opened in a browser with no local
vault exposes no unlock, recovery, or claim controls.

The public HTTPS web edge is deployed at `https://conveyapp.site`. A new
recipient completed a gasless browser claim on mainnet through it (Gift 2,
`0x47236b16…0283`), using Chromium's WebAuthn virtual authenticator. The
evidence is in [`docs/verification.md`](verification.md). The full flow
(enrollment, claim and recovery) has since been completed on a physical
device.

For a first-time receiver, the claim flow asks the gateway to create the OKX
Smart Wallet (`POST /v1/accounts`) before the sponsored claim, because OKBund's
validation simulation rejects an operation that both deploys the account and
claims.
The deployed receiver now fetches issuer valuation through its allowlisted
same-origin proxy; the closed-Gift browser smoke and its zero-error result are
recorded in the verification log.

The Next.js surface in `app/g/[secret]` reads the escrow and registry from the
configured public X Layer RPC, fetches the issuer value for wrapped xStocks,
and never invents a balance or USD amount. After local key enrollment and
explicit recovery-key confirmation it builds, live-estimates, and submits the
gasless claim through the same-origin `/api/relay/*` proxy. The relay URL and
bearer token are server-only environment variables. The live-quoted cash-out
route and direct gasless withdrawal route are implemented; the operator
cash-out has one UserOperation proof, while browser withdrawal proof remains
open.
