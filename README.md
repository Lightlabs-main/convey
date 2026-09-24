# Convey

Convey is a private X Layer mainnet application for gifting tokenized
real-world assets, beginning with xStocks. A sender funds a gift, the receiver
claims it into an ERC-4337 smart account, and the claim is submitted through a
private Convey gateway and operator-controlled OKBund bundler.

The product is currently in live verification, not production release. The
account-abstraction bootstrap gate passed on X Layer. The product contracts are
deployed and funded. The first real claim reached chain inclusion but failed
inside the UserOperation and was safely reclaimed; a successful product claim
has not yet been proven.

The authoritative continuation record is [`HANDOFF.md`](HANDOFF.md). Detailed
architecture, deployment, and live evidence are in [`docs/architecture.md`](docs/architecture.md),
[`docs/product-deployment.json`](docs/product-deployment.json), and
[`docs/verification.md`](docs/verification.md).

## Current checkpoint

As of 2026-09-24:

- X Layer mainnet, chain ID `196`, is the only supported deployment.
- The selected receiver is the deployed OKX Smart Wallet at ERC-4337 EntryPoint
  v0.7. It is an OKX-specific modular account and does **not** implement
  ERC-7579.
- The Convey registry, gift escrow, and claim paymaster are deployed and
  funded.
- OKBund is pinned, running on the supplied Lightsail VPS, and uses NodeFlare
  as its private X Layer execution RPC.
- The claim gateway now performs event-aware `debug_traceCall` preflight before
  forwarding a claim. It requires the matching EntryPoint
  `UserOperationEvent.success` to be true and fails closed if tracing is
  unavailable.
- Gift ID `1` is `Reclaimed`. Its claim secret was exposed by the failed
  operation and must never be reused. All NVDAx and claim reserve accounting
  were recovered or cleared.
- No Gift ID `2` exists. Creating it and submitting its claim require explicit
  operator authorization after the usage-limit pause.

## Product flow

```text
Sender wallet
    │  approve token + createGift(amount, secretHash, expiry, reserve)
    ▼
AssetRegistry ── validates certified/enabled assets
    │
    ▼
GiftEscrow ── locks ERC-20 asset and hashlocked claim state
    │
    │  receiver signs a scoped ERC-4337 v0.7 UserOperation
    ▼
Convey private gateway
    │  target/selector policy + event-aware EntryPoint preflight
    ▼
Private OKBund ── NodeFlare execution RPC
    ▼
EntryPoint v0.7 ── validates paymaster and account
    ▼
OKX Smart Wallet ── calls exactly GiftEscrow.claim(...)
    ▼
GiftEscrow ── transfers the asset only to msg.sender
```

The sender funds the claim allowance in native OKB when creating the gift. The
claim paymaster reserves the maximum authorized cost before execution and
reconciles actual gas cost in `postOp`. The gift token is never swapped for gas.

The bootstrap sponsor used to deploy and exercise the receiver account is a
separate one-operation paymaster. It must not be reused for product claims.

## Deployed X Layer components

| Component | Address | Purpose |
|---|---|---|
| EntryPoint v0.7 | `0x0000000071727de22e5e9d8baf0edac6f37da032` | ERC-4337 execution entry point |
| OKX Smart Wallet factory | `0xdd3fea01cd550c9effc893f346690b9a649f35ef` | Receiver account deployment/address derivation |
| OKX Smart Wallet implementation | `0xe40ccb2d94975c51bff0c004efdfd9b3a5796fa4` | Inspected modular account implementation |
| Receiver account | `0x63B2A84d47cb07fb18EE72Ec386893506Fd963db` | Selected claim recipient account |
| `AssetRegistry` | `0x156d160e004B7fb2021CFCA8fC6cF069c3b8b029` | Certified/enabled asset policy |
| `ConveyClaimPaymasterV07` | `0xe6913061bc2021B0dfdeECB867F7a9F5F77236B6` | Sender-funded claim reserve and sponsorship |
| `GiftEscrow` | `0xaa396c814d38cf9e707c6bbc0635f1ee7d584062` | Hashlocked single-gift custody |
| USDT0 | `0x779ded0c9e1022225f8e0630b35a9b54be713736` | Acquisition funding token |
| Uniswap SwapRouter02 | `0x4f0c28f5926afda16bf2506d5d9e57ea190f9bca` | Registered asset route |

The claim paymaster policy is configured with a `0.00002 OKB` minimum reserve
and maximum claim cost. Its initial EntryPoint deposit was `0.0002 OKB`, with a
`1` wei stake and an `86,400` second unstake delay. Deployment and funding
receipts are recorded in [`docs/product-deployment.json`](docs/product-deployment.json).

## Registered assets

| Asset | Wrapper | Status |
|---|---|---|
| NVDAx | `0xa8ddb5cd96b5222afe198316e9a57caa642850d5` | Certified, enabled, executable cash-out route |
| AAPLx | `0x943bf64d566c32a2bcd41ac92fb63c111cc9de8f` | Certified, enabled, executable cash-out route |
| TSLAx | `0xc3fdbe3a68ee5de461d30415a8165cf9aefe1171` | Certified and giftable, hold-only until liquidity passes policy |

Convey treats these as EVM wrapper contracts on X Layer. Solana Token-2022 is
not part of this deployment. Wrapper conversion supplies underlying units;
display valuation and cash-out require independent live data and executable
routes.

## Account and key model

The receiver uses the deployed OKX account path at EntryPoint v0.7. Convey
describes it accurately as an OKX-specific modular ERC-4337 account, not an
ERC-7579 account. The account owner signs the OKX owner envelope locally; the
gateway and sponsor service must never receive the owner private key.

Operator roles are deliberately separate:

- receiver smart-account owner;
- product deployer/contract owner;
- bootstrap paymaster signer;
- claim paymaster signer; and
- OKBund bundle-sender key.

Private keys belong only in the ignored `.env` or an external secret manager.
The existing Lightsail SSH key and VPS root environment are also secret
material. Never print, paste, commit, or add them to documentation.

The proposed WebAuthn PRF storage, device migration, recovery, and owner
revocation path is not yet implementation-proven. Losing the receiver owner
key currently means losing control of that account.

## Claim relay

The browser-safe SDK is `ConveyRelayerClient`. The server-side gateway uses
`SelfHostedBundlerClient` and exposes:

| Route | Behavior |
|---|---|
| `GET /healthz` | Checks execution RPC, chain, EntryPoint, bundler capability, and paymaster funding |
| `POST /v1/claims/estimate` | Forwards a scoped gas-estimation request to the private bundler |
| `POST /v1/claims` | Preflights and then submits one signed sponsored UserOperation |
| `GET /v1/claims/:userOperationHash` | Returns pending, confirmed, or failed receipt status |

The gateway accepts only a signed, sponsored v0.7 operation that:

1. uses the configured EntryPoint and Convey claim paymaster;
2. contains exactly one zero-value OKX `executeUserOp` call;
3. targets the configured `GiftEscrow`; and
4. invokes only the configured claim selector.

There is no raw-transaction route, public-bundler fallback, or secret storage
in the gateway. Idempotency retains only a short-lived request key and
UserOperation hash.

### Event-aware preflight

`src/relayer/preflight.ts` builds the exact v0.7 EntryPoint `handleOps` call and
traces it through the private execution RPC. It decodes:

- `UserOperationEvent`, including `success`, actual gas cost, and actual gas
  used; and
- `UserOperationRevertReason` when the inner operation fails.

An outer `handleOps` call can complete while an inner UserOperation reports
`success = false`; therefore a top-level `eth_call` result is not sufficient.
The gateway runs this preflight immediately before `eth_sendUserOperation` and
rejects failed or untraceable claims.

The preflight beneficiary is configured by `RELAYER_PREFLIGHT_BENEFICIARY` and
defaults to the zero address for the read-only simulation. It is not a claim
recipient and does not become a transaction recipient.

## OKBund and infrastructure

OKBund is pinned to commit
`77ac3770ba7dd4be949975b142623540e28f60e4` and was built with Java 21/Maven.
The checked-in launcher requires:

```text
CHAIN_ID=196
ENTRYPOINT=<canonical v0.7 EntryPoint>
BUNDLER_ENV=prod
SAFE_MODE=true
EIP1559=true
```

It binds to loopback by default and disables only OKBund's incompatible
node-side fallback estimator. EntryPoint/EVM simulation remains enabled. The
bundler's execution RPC must be a private tracing endpoint; the public X Layer
RPC is not sufficient for safe bundling.

The supplied Lightsail VPS is the intended operator host. Its current OKBund
service listens on `127.0.0.1:3000/rpc`. See [`infra/okbund/README.md`](infra/okbund/README.md)
for the pinned build, service, RPC, funding, and firewall runbook. See
[`HANDOFF.md`](HANDOFF.md) for the host-specific continuation record. Do not
ask for or provision another server before checking that handoff.

## Repository layout

```text
contracts/
  bootstrap/       one-operation account gate paymaster
  core/            AssetRegistry, GiftEscrow, and related escrow contracts
  paymaster/       sender-funded ConveyClaimPaymasterV07
docs/              architecture, design, deployment, and verification evidence
infra/okbund/      pinned OKBund launcher and operator runbook
script/            verification, deployment, funding, and operator commands
src/relayer/       UserOperation codec, OKX builder, gateway, client, preflight
test/              Node test suite for codecs, policy, and relay behavior
HANDOFF.md         current live state and resume instructions
PROGRESS.md        chronological implementation record
```

## Local setup

Install dependencies and create a private local environment file:

```sh
pnpm install
cp .env.example .env
chmod 600 .env
```

Populate only the values required for the command being run. The environment
file contains placeholders for chain configuration, private execution and
bundler endpoints, deployed contract addresses, paymaster policy, and operator
keys. Do not commit `.env`.

The minimum public network invariants are:

```text
XLAYER_CHAIN_ID=196
ENTRYPOINT_ADDRESS=0x0000000071727de22e5e9d8baf0edac6f37da032
OKX_SMART_WALLET_FACTORY=0xdd3fea01cd550c9effc893f346690b9a649f35ef
OKX_SMART_WALLET_IMPLEMENTATION=0xe40ccb2d94975c51bff0c004efdfd9b3a5796fa4
```

Use a keyed NodeFlare endpoint through `NODEFLARE_API_KEY`, or set
`BUNDLER_EXECUTION_RPC_URL` to another private X Layer execution RPC that
passes both tracer and state-override capability checks. `BUNDLER_RPC_URL` is
the private OKBund endpoint and must never be exposed to browser code.

## Commands

### Read-only checks

```sh
pnpm test
pnpm verify
pnpm verify:bundler-rpc
pnpm account:inspect
pnpm operator:addresses
pnpm bundler:check
pnpm relayer:check
```

`pnpm verify` uses the documented pinned X Layer block and writes raw evidence
under `docs/`. `pnpm verify:bundler-rpc` redacts credential-bearing RPC paths.
The account and operator commands derive public addresses without printing
private keys.

### Build and contract tests

```sh
pnpm contracts:build
pnpm contracts:test
```

Foundry is not installed in the Codespace used for this handoff. The supplied
Lightsail host has Foundry 1.8.3 and has run the expanded Solidity suite
successfully. Local Solidity tests use a controlled EntryPoint stub for some
cases; they are not a third-party audit or a substitute for live mainnet
verification.

### Bootstrap account gate

These commands can send mainnet transactions when run with a funded operator
environment:

```sh
pnpm bootstrap:deploy
pnpm bootstrap:fund
pnpm bootstrap:build
pnpm bootstrap:submit
pnpm bootstrap:wait
```

The bootstrap path is one-use and separate from product claim sponsorship.
Operation files are written under `/tmp` with mode `0600`, reject symlinks, and
must never be committed.

### Product deployment and registry

```sh
pnpm product:deploy
pnpm product:fund
pnpm product:register-assets
```

These commands can deploy, fund, bind, or register contracts on X Layer. Use
only after reviewing the live configuration and intended transaction scope.

### Gateway

```sh
pnpm relayer:serve
```

The default bind address is loopback. Production deployment requires a private
HTTPS route, authentication policy, capacity review, and a private OKBund
endpoint. The current workspace contains the gateway implementation but does
not claim that a public production gateway is deployed.

## Live verification record

### Account-abstraction gate

The successful bootstrap operation deployed the selected receiver account:

- UserOperation:
  `0x1361ecee72221c81ee911f1446e3531e6086ffa9b2bee87bec22cd0ecc7f413c`
- bundle transaction:
  `0xfdb3ef41083b02282a304c948194b1ec9dca42d14f5fec258b8a12c2e7b4df09`
- block: `71422410`
- receipt: `success = true`

This proves the selected account path and bootstrap sponsor gate. It does not
prove product claim reserve accounting or receiver recovery.

### Sender-funded Gift ID 1 incident

The sender acquired `0.030965586663211895` NVDAx from `7` USDT0. Gift ID `1`
was created with a `0.00002 OKB` reserve. The claim then reached inclusion:

- UserOperation:
  `0xd3efe7e60f40e556d6f4fea79335723f0f5aab8924c0b015393a2451534346b1`
- bundle transaction:
  `0xc4610b7cc244c7ec728c486d90493e94bfa976de9fcf4cfa46e04f744c1a05f6`
- block: `71463789`
- `UserOperationEvent.success`: `false`
- decoded failure: `TokenTransferFailed()`

The secret was consequently public in transaction calldata while the gift was
still open. The sender immediately reclaimed the gift:

- reclaim transaction:
  `0x6add4c95079719111eab9b3ebd9c7b6a6cc91df9b8e58384c4d57f12fc4fff9f`
- block: `71463978`
- final state: Gift ID `1` `Reclaimed`, escrow token balance zero, and all
  reserve buckets zero.

The failure is retained as a live incident, not hidden as a successful claim.
The likely execution issue was insufficient account-level `callGasLimit` for
the complete account → escrow → token path. The new preflight specifically
checks the inner EntryPoint event before a future submission.

## Security and operating rules

- Never use mock prices, balances, sponsorship, claims, or transaction hashes
  in verification records.
- Never reuse the exposed Gift ID `1` secret.
- Never print or commit private keys, RPC credentials, SSH keys, or secret
  claim files.
- Keep receiver owner, deployer, paymaster signer, bundler, and SSH roles
  separate.
- Keep `BUNDLER_RPC_URL` and execution RPC credentials server-side.
- Do not call the OKX account ERC-7579; the inspected implementation is
  modular ERC-4337 v0.7 without ERC-7579 support.
- Do not reuse the bootstrap paymaster for product claims.
- Treat all deployment, funding, registration, gift creation, reclaim, and
  claim commands as potentially state-changing; verify target, amount, nonce,
  and live receipt before proceeding.
- A successful outer EntryPoint transaction is not proof of a successful inner
  UserOperation. Inspect `UserOperationEvent.success` and the revert event.

## Resume point

The project is paused until the operator's usage limit resets. On resumption:

1. Refresh live chain, paymaster, reserve, nonce, and gas-price state.
2. Generate a completely new Gift ID `2` secret; do not use Gift ID `1` data.
3. Build an operation with a higher account-level `callGasLimit` while keeping
   the declared maximum exposure within `0.00002 OKB`.
4. Run the event-aware private EntryPoint preflight.
5. Obtain explicit operator authorization immediately before Gift ID `2`
   creation and claim submission.
6. Record every live receipt, UserOperation hash, bundle transaction, event
   result, reserve settlement, and final balance in the handoff and verification
   documents.

The full checkpoint is in [`HANDOFF.md`](HANDOFF.md); do not infer Gift ID 2
authorization from this README.

## Further documentation

- [`HANDOFF.md`](HANDOFF.md) — current state, infrastructure, live hashes, and
  exact resume order.
- [`PROGRESS.md`](PROGRESS.md) — implementation history and remaining work.
- [`docs/architecture.md`](docs/architecture.md) — contract and account model.
- [`docs/claim-paymaster-design.md`](docs/claim-paymaster-design.md) — reserve,
  validation, and `postOp` accounting.
- [`docs/relayer.md`](docs/relayer.md) — gateway, SDK, and preflight boundary.
- [`docs/aa-gate-design.md`](docs/aa-gate-design.md) — receiver and bootstrap
  sponsorship design.
- [`docs/verification.md`](docs/verification.md) — live evidence and incident
  record.
- [`infra/okbund/README.md`](infra/okbund/README.md) — pinned OKBund and VPS
  operating runbook.
