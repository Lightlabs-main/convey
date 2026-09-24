# Convey handoff — 2026-09-24

## Decision to resume

The product is **Convey**. The previous name is retired; `AGENTS.md` records this as persistent project memory. The account-abstraction transaction gate has now passed through Convey's private OKBund on X Layer, using NodeFlare as OKBund's execution RPC. Particle is no longer a sponsor dependency. The product registry, escrow, claim paymaster, and launch asset entries are deployed and funded; the private claim integration and receiver recovery remain separate work.

The selected on-chain account remains the verified OKX Smart Wallet at ERC-4337 EntryPoint v0.7. Its inspected implementation does **not** implement ERC-7579. A proposed per-receiver ECDSA key vault is recorded in `docs/aa-gate-design.md`; its passkey storage, recovery, and revocation paths still need implementation-specific proof. The first sponsor path is an operator-controlled v0.7 paymaster with a dedicated signer and funded EntryPoint deposit/stake. This paymaster is an infrastructure prerequisite to the verification gate; the sender-funded product gas model needs separate proof before gifting.

## Verified baseline

- `pnpm verify` previously passed against X Layer mainnet at pinned block 71,272,554. Wrapper certification, USDT0, and live pool quotes are recorded in `docs/verification.md` and `docs/verification.raw.json`.
- NodeFlare's keyed X Layer RPC passed the JavaScript-tracer and state-override `debug_traceCall` checks on chain 196.
- OKX OKBund is pinned to commit `77ac3770ba7dd4be949975b142623540e28f60e4`. Its Java 21 build passed `mvn verify`; the local loopback runtime probe returned chain 196 and EntryPoint v0.7. The later VPS run included the sponsored bootstrap operation recorded below.
- The previous Particle Network dashboard issue was investigated. Its public dashboard code sends email codes through `POST https://dashboard-api.particle.network/code`. A malformed, non-deliverable probe from this environment received a Cloudflare 403 block page without browser CORS headers, consistent with a generic browser “Network Error”; this does not prove the user's request had the same response. The earlier `login.particle.io/signup` recommendation was incorrect: that domain belongs to a different Particle product. The correct Particle Network dashboard is `https://dashboard.particle.network/`, but this route is no longer required for Convey's gate.
- Coinbase's [VerifyingPaymaster](https://github.com/coinbase/verifying-paymaster) was reviewed as a v0.7 reference but is not selected unchanged. The exact source revision covered by its listed [Cantina review](https://cantina.xyz/portfolio/88b09402-6430-411e-80b0-857854fbe9f3) has not been matched, and no X Layer deployment is listed. The Convey-specific target and cost limits are recorded in `docs/aa-gate-design.md`.

## Workspace state after the latest continuation

- `AGENTS.md` and this handoff are committed project memory files; the latest
  pushed commits are `4f82635` and `b9c947f`.
- A bulk product rename from the retired name to Convey has been applied across package metadata, SDK identifiers, environment variable names, tests, docs, and the OKBund runbook. The package name is `convey`; the client class is `ConveyRelayerClient`; operator variables use the `CONVEY_` prefix. The local ignored `.env` variable names were migrated without displaying secret values.
- The rename and documentation corrections are committed. `pnpm test` passes;
  no fresh live `pnpm verify` was run during this continuation. Stale Particle
  bootstrap instructions were removed and its unused example credential slots
  were deleted.
- [`contracts/bootstrap/ConveyBootstrapPaymasterV07.sol`](contracts/bootstrap/ConveyBootstrapPaymasterV07.sol) implements the one-operation, chain-196 v0.7 policy. Twelve Foundry tests pass. The expiry case uses a local EntryPoint stub; this is not a mainnet simulation or independent audit.
- Added Foundry build config and `pnpm bootstrap:deploy`, `pnpm bootstrap:fund`, `pnpm bootstrap:build`, and `pnpm bootstrap:submit`. The bootstrap paymaster was deployed, funded/staked, and exercised through the sponsored operation recorded below.
- Reviewed the bootstrap scripts and added fail-fast checks that keep the receiver owner, paymaster owner, and sponsor signer on distinct addresses. `pnpm operator:addresses` also rejects reused addresses among configured operator keys. These are implementation guards, not an independent security audit.
- Fixed `account:inspect` so empty bytecode (`0x`) is reported as undeployed and the script checks the canonical X Layer v0.7 EntryPoint and OKX factory. Bootstrap scripts now use `BOOTSTRAP_PAYMASTER_ADDRESS`, kept separate from the claim relay's `PAYMASTER_ADDRESS`.
- Fixed the OKX owner-signature recovery check: it now recovers against the EIP-191 digest, with a local cryptographic test.
- The project builder reviewed the bootstrap contract, tests, deployment and funding scripts, operation encoding, and the official OKX/EntryPoint v0.7 call and prefund paths. Findings were corrected and covered by local tests. This is an in-house source review, not a third-party audit or live sponsorship proof.
- A read-only VPS check at `2026-09-23T16:16:45Z` confirmed the OKBund service and chain/EntryPoint RPC responses. It found no Convey gateway service or container. The host had 260 MiB available with 458 MiB swap in use; see [`docs/verification.md`](docs/verification.md). No services or chain state were changed.
- Local bootstrap source review pinned the deploy/build scripts to the verified OKX factory and implementation and added a live implementation-to-EntryPoint check. The operation file writer rejects symlinks and enforces mode `0600`; submit and wait commands now validate that file before use. Submission waits for an ERC-4337 receipt and reports UserOperation status, transaction status, transaction hash, and block number. `pnpm bootstrap:wait` checks inclusion without resubmitting.
- [`docs/aa-gate-design.md`](docs/aa-gate-design.md) records the proposed receiver signer shape, the in-house source review, and the implemented bootstrap policy. The passkey storage/recovery path remains proposed. Live sponsorship evidence is recorded in [`docs/verification.md`](docs/verification.md).
- Coinbase VerifyingPaymaster was reviewed as a v0.7 reference but not selected unchanged: its generic policy does not enforce Convey's exact operation target, its listed deployments are Base deployments, and the Cantina review's exact source revision has not been matched. See [`docs/aa-provider-research.md`](docs/aa-provider-research.md).
- The operator provisioned distinct `SMART_ACCOUNT_OWNER_PRIVATE_KEY`, `DEPLOYER_PRIVATE_KEY`, and `BOOTSTRAP_PAYMASTER_SIGNER_PRIVATE_KEY` values in the ignored local `.env`. Their public role addresses are distinct; no private values were printed. The receiver account `0x63B2A84d47cb07fb18EE72Ec386893506Fd963db` is now deployed on chain 196 by the sponsored operation. The deployed paymaster is `0x6647cef848fc54b0c821f91a88d83227f65e36b9`; its deployment and sponsorship transactions are recorded in `docs/verification.md`. Sponsor nonce `0`, paymaster verification gas limit `200000`, and max-cost cap `0.01 OKB` are configured. The receiver's EntryPoint nonce is now `1`; the paymaster authorization is consumed. `BUNDLER_PRIVATE_KEY` remains only in the VPS root-owned service environment, and its public wallet retains `0.000781673979083699 OKB`.
- The ignored local `.env` was found with mode `0666` and changed to owner-only mode `0600` without reading or printing its contents. Keep operator keys in this file or a secret manager, never in chat.
- Pinned OKBund is installed and running as a persistent loopback-only service on the Lightsail VPS. Its dedicated bundler wallet is funded. The product contracts and registry entries are deployed on X Layer; public addresses, receipts, and policy are in `docs/product-deployment.json`. Gift ID `1` reached on-chain claim inclusion but failed internally and was reclaimed; no Gift ID `2` exists.

### Live sponsored bootstrap evidence

- UserOperation hash: `0x1361ecee72221c81ee911f1446e3531e6086ffa9b2bee87bec22cd0ecc7f413c`
- Bundler transaction: `0xfdb3ef41083b02282a304c948194b1ec9dca42d14f5fec258b8a12c2e7b4df09`
- X Layer block: `71422410` (`0x441d1ca`), transaction status `0x1`
- Sender: `0x63B2A84d47cb07fb18EE72Ec386893506Fd963db`
- OKBund receipt: `success = true`, `actualGasUsed = 0x55602`, `actualGasCost = 0x65c6885b002` wei

The operation deployed the receiver account and executed the fixed zero-value
bootstrap call through the canonical EntryPoint v0.7. Earlier expired attempts
were excluded from this evidence. No private key or credential was printed.

## Supplied Lightsail VPS

- Use the existing Lightsail instance; do not ask the user for another server.
- Instance label: `Holybunnie`; Ubuntu; Stockholm region `eu-north-1a`; public IPv4 `13.62.181.128`; SSH user `ubuntu`; plan shown as 1 GB RAM, 2 vCPUs, 40 GB SSD. NodeFlare is the execution RPC, so this host does not need to run an X Layer node.
- Its existing private SSH key is the ignored workspace file `LightsailDefaultKey-eu-north-1 (3).pem`. It is owner-readable only, parses as a 2048-bit RSA SSH key, and `.gitignore` excludes `*.pem`. Never print, copy into docs, or commit its contents.
- The existing key is usable from this workspace; ordinary sandboxed SSH is blocked, so use the approved SSH escalation path. The VPS runs Ubuntu 24.04.4, has 2 GB swap, and already hosts other services; do not restart or overwrite them.
- Pinned OKBund `77ac3770ba7dd4be949975b142623540e28f60e4` passed `mvn verify` on the VPS with Java 21/Maven. Jar SHA-256: `7aa098ee3629a83c7d08a8672deb2747205c418fbef59d104158b61b4ace7c60`.
- `convey-okbund.service` is enabled and active. It binds only to `127.0.0.1:3000/rpc`; live RPC returned chain `0xc4` and the canonical v0.7 EntryPoint. A later workspace `pnpm bundler:check` through a temporary SSH tunnel passed for chain 196 and EntryPoint v0.7, superseding an earlier generic connection failure. Gateway connectivity remains unconfirmed.
- The generated bundler wallet is `0xa537812DdaD4AcaA3617E316c8f9b4Add6C9D67e`. Its key and the existing NodeFlare credential are stored in root-only `/etc/convey/okbund.env`; never read or print that file's contents. Its latest live balance is `0.000781673979083699 OKB`; the earlier zero-balance reading preceded funding. The initial gas price observation was `0x1406f40` wei.
- After service start, it used about 199 MiB under a 650 MiB service cap; the host reported about 288 MiB memory available. Watch host memory before adding the gateway workload. The local workspace has no `BUNDLER_RPC_URL`; from another process on this same VPS, the internal URL is `http://127.0.0.1:3000/rpc`.

## Resume in this order

1. The project builder's in-house source review is complete for the one-operation bootstrap path; no third-party audit is claimed. The successful live evidence is recorded above and in `docs/verification.md`. The current TypeScript suite and script syntax checks pass; Foundry is unavailable in the current workspace, with the earlier handoff recording 12 passing Foundry tests.
2. Use the event-aware private EntryPoint preflight, validate a higher
   account-level call-gas allocation within the per-gift reserve, and obtain
   authorization before creating/claiming Gift ID `2`. Keep the claim paymaster
   and sender-funded reserve separate from the one-use bootstrap paymaster.
3. Specify and implement receiver key enrollment, passkey PRF storage, device migration, recovery, and owner revocation for the OKX ECDSA owner path.
4. Deploy the Convey gateway only after a fresh VPS capacity check; the supplied host currently has no gateway service and is loopback-only for OKBund.
5. Verify private claim routing, reserve accounting on success and failure, duplicate settlement, and recurring-gift owner permissions on the deployed integration.

## Pause checkpoint — sender funding for the first product gift

The operator asked what remains to be funded before pausing. A live X Layer
balance read was performed without printing any private key or credential.

- For the controlled first end-to-end product gift, use the existing
  `DEPLOYER_PRIVATE_KEY` as the sender. Its public address is
  `0x5fA8199ad34373A063c96D24a1BF5b4a105D3399`.
- At the pause checkpoint, that sender had `0.000561866933093345 OKB` and no
  NVDAx, AAPLx, or TSLAx. No additional OKB top-up was required for the first
  small gift at the observed X Layer floor; `createGift` must include the configured
  `0.00002 OKB` claim reserve in its transaction value.
- Preferred acquisition path: fund the sender on X Layer mainnet (chain 196)
  with approximately `$5–$20` of USDT0, then execute a fresh live-quoted
  Uniswap route `USDT0 → USDG → wrapped xStock` into one of the registered
  assets. USDT0 is `0x779ded0c9e1022225f8e0630b35a9b54be713736`.
- A direct xStock transfer is also accepted if the operator already holds the
  correct X Layer wrapper:
  - NVDAx wrapper: `0xa8ddb5cd96b5222afe198316e9a57caa642850d5`
  - AAPLx wrapper: `0x943bf64d566c32a2bcd41ac92fb63c111cc9de8f`
- A live quote check returned an executable reverse route for both NVDAx and
  AAPLx at a `$5` USDT0 input; refresh the quote immediately before execution.
- TSLAx is certified and giftable but remains hold-only because its recorded
  cash-out route is too thin for this first claim proof.
- The private bundler wallet
  `0xa537812DdaD4AcaA3617E316c8f9b4Add6C9D67e` has
  `0.000781673979083699 OKB` live. The product claim paymaster has a
  `0.0002 OKB` EntryPoint deposit, a `1 wei` stake, and zero open or in-flight
  gift reserves. No direct transfer to the bundler, escrow, or paymaster is
  needed for the first gift.

### Live sender asset acquisition — 2026-09-24

- A live X Layer read at block `71458391` confirmed exactly `7` USDT0 at the
  sender wallet.
- The exact `7` USDT0 approval to the verified SwapRouter02 succeeded in
  transaction `0xade67ce967bf701f92b7574b55c7840939f4f0647c83a281770308ce57330130`
  at block `71459201`.
- The fresh direct `USDT0 → NVDAx` 0.3% route quoted
  `0.030965586663211895 NVDAx`. The swap succeeded in transaction
  `0xbd4f39e17fb02851abe6affb4b4a6e57a5adcf0105cb9dfdcae89be39a7cadae`
  at block `71459663`, using `175721` gas. The receipt transferred exactly
  `0.030965586663211895 NVDAx` from the pool to the sender.
- A final private-RPC read at block `71459762` reported `0` USDT0,
  `0.030965586663211895` NVDAx, `0.000557285212864259` OKB, and zero remaining
  USDT0 allowance to the router. This proves asset acquisition only; no claim
  UserOperation had been submitted at that point.

### Live NVDAx gift creation — 2026-09-24

- The sender approved exactly `0.030965586663211895` NVDAx to `GiftEscrow` in
  transaction `0xcc4b7c963e4ec26f36cb508e402a8bc7412a15811ad8e061fb6cc021e7dcf1ac`
  at block `71460696`, using `53693` gas.
- `GiftEscrow.createGift` then succeeded in transaction
  `0x58921e5bc238bf36534ff6c8fd828dd1af17808e54aa3900cad5c6f9e609bf9e` at
  block `71460786`, using `338499` gas. It created Gift ID `1` with the exact
  NVDAx amount, a fresh owner-only secret hash, no code hash, and a 7-day
  expiry at Unix timestamp `1790834618` (`2026-10-01T06:03:38Z`). The reserve
  value was exactly `0.00002 OKB`.
- That was the pre-claim state. The accepted claim UserOperation
  `0xd3efe7e60f40e556d6f4fea79335723f0f5aab8924c0b015393a2451534346b1`
  was included by bundle transaction
  `0xc4610b7cc244c7ec728c486d90493e94bfa976de9fcf4cfa46e04f744c1a05f6`
  at block `71463789`. The bundle transaction succeeded, but its
  `UserOperationEvent.success` was `false`; the revert selector decoded to
  `TokenTransferFailed()`. Actual gas was `365198` and actual cost was
  `7303960365198` wei. No NVDAx reached the receiver.
- Because inclusion exposed the claim secret while the gift remained open,
  the sender immediately reclaimed Gift ID `1` in transaction
  `0x6add4c95079719111eab9b3ebd9c7b6a6cc91df9b8e58384c4d57f12fc4fff9f`
  at block `71463978`. Gift ID `1` is now `Reclaimed`; all
  `0.030965586663211895` NVDAx is back with the sender, escrow holds zero, and
  `openReserveTotal`, `inFlightTotal`, and `pendingRefundTotal` are zero.
- The Gift ID `1` secret is permanently exposed and must never be reused. Its
  owner-only incident record remains at `/tmp/convey-gift-1-secret.json` with
  mode `0600`; no secret value is stored in the repository.
- OKBund now disables its incompatible node-side fallback estimator while
  retaining EntryPoint/EVM simulation. The gateway also accepts OKBund's
  numeric receipt `blockNumber` and normalizes it to RPC hex. The durable
  relayer now includes an event-aware `debug_traceCall` preflight; a live
  read-only trace confirmed the private RPC accepts the tracer and captures
  event data.

### Next continuation step

Before creating Gift ID `2`, run the new preflight against a fresh operation,
then validate a higher account-level `callGasLimit` while keeping total
prefund within the `0.00002 OKB` reserve. Generate an entirely new secret and
use sponsor nonce `1`. Gift creation and claim submission require fresh
operator authorization.

Current git command form: `git --git-dir=convey-repo/.git --work-tree=.`.
