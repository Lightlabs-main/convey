# Convey handoff — 2026-09-25

## Decision to resume

The product is **Convey**. The previous name is retired; `AGENTS.md` records this as persistent project memory. The account-abstraction transaction gate has now passed through Convey's private OKBund on X Layer, using NodeFlare as OKBund's execution RPC. Particle is no longer a sponsor dependency. The product registry, escrow, claim paymaster, and launch asset entries are deployed and funded; the receiver vault and claim-flow library plus persistent private gateway are implemented. The public web edge is deployed; a Chromium virtual-authenticator PRF capability proof passed, while persistent browser enrollment/recovery, owner-revocation, and browser mainnet proof remain open.

The selected on-chain account remains the verified OKX Smart Wallet at ERC-4337 EntryPoint v0.7. Its inspected implementation does **not** implement ERC-7579. A proposed per-receiver ECDSA key vault is recorded in `docs/aa-gate-design.md`; its passkey storage, recovery, and revocation paths still need implementation-specific proof. The first sponsor path is an operator-controlled v0.7 paymaster with a dedicated signer and funded EntryPoint deposit/stake. This paymaster is an infrastructure prerequisite to the verification gate; the sender-funded product gas model has one successful live Gift ID `2` proof, while general browser/recovery integration remains open.

## Verified baseline

- `pnpm verify` passed again on 2026-09-25 at `2026-09-25T12:39:21.894Z`
  against X Layer mainnet at pinned block `71,272,554`. Wrapper certification,
  USDT0, and live pool quotes are recorded in `docs/verification.md` and
  `docs/verification.raw.json`; issuer prices and multipliers remain live,
  timestamped observations.
- A fresh isolated VPS compile and Foundry run completed by
  `2026-09-25T11:19:27.379Z` against the current Solidity sources: all `47`
  tests passed, including the four Drop and five recurring-hook tests. The
  temporary directory was removed and no VPS service or chain state changed.
- NodeFlare's keyed X Layer RPC passed the JavaScript-tracer and state-override `debug_traceCall` checks on chain 196.
- The latest redacted `pnpm verify:bundler-rpc` probe passed at
  `2026-09-25T12:20:49.878Z`: chain `196`, canonical EntryPoint v0.7, and both
  required `debug_traceCall` capabilities supported. `trace_call` remains
  unsupported and is not required by the selected OKBund path.
- OKX OKBund is pinned to commit `77ac3770ba7dd4be949975b142623540e28f60e4`. Its Java 21 build passed `mvn verify`; the local loopback runtime probe returned chain 196 and EntryPoint v0.7. The later VPS run included the sponsored bootstrap operation recorded below.
- The previous Particle Network dashboard issue was investigated. Its public dashboard code sends email codes through `POST https://dashboard-api.particle.network/code`. A malformed, non-deliverable probe from this environment received a Cloudflare 403 block page without browser CORS headers, consistent with a generic browser “Network Error”; this does not prove the user's request had the same response. The earlier `login.particle.io/signup` recommendation was incorrect: that domain belongs to a different Particle product. The correct Particle Network dashboard is `https://dashboard.particle.network/`, but this route is no longer required for Convey's gate.
- Coinbase's [VerifyingPaymaster](https://github.com/coinbase/verifying-paymaster) was reviewed as a v0.7 reference but is not selected unchanged. The exact source revision covered by its listed [Cantina review](https://cantina.xyz/portfolio/88b09402-6430-411e-80b0-857854fbe9f3) has not been matched, and no X Layer deployment is listed. The Convey-specific target and cost limits are recorded in `docs/aa-gate-design.md`.

## Workspace state after the latest continuation

- `AGENTS.md` and this handoff are committed project memory files. Use git
  history for the current pushed commit; this document does not duplicate a
  stale short hash.
- A bulk product rename from the retired name to Convey has been applied across package metadata, SDK identifiers, environment variable names, tests, docs, and the OKBund runbook. The package name is `convey`; the client class is `ConveyRelayerClient`; operator variables use the `CONVEY_` prefix. The local ignored `.env` variable names were migrated without displaying secret values.
- The rename and documentation corrections are committed. `pnpm test` passes;
  the live `pnpm verify` rerun is recorded below. Stale Particle
  bootstrap instructions were removed and its unused example credential slots
  were deleted.
- [`contracts/bootstrap/ConveyBootstrapPaymasterV07.sol`](contracts/bootstrap/ConveyBootstrapPaymasterV07.sol) implements the one-operation, chain-196 v0.7 policy. Twelve Foundry tests pass. The expiry case uses a local EntryPoint stub; this is not a mainnet simulation or independent audit.
- Added Foundry build config and `pnpm bootstrap:deploy`, `pnpm bootstrap:fund`, `pnpm bootstrap:build`, and `pnpm bootstrap:submit`. The bootstrap paymaster was deployed, funded/staked, and exercised through the sponsored operation recorded below.
- Reviewed the bootstrap scripts and added fail-fast checks that keep the receiver owner, paymaster owner, and sponsor signer on distinct addresses. `pnpm operator:addresses` also rejects reused addresses among configured operator keys. These are implementation guards, not an independent security audit.
- Fixed `account:inspect` so empty bytecode (`0x`) is reported as undeployed and the script checks the canonical X Layer v0.7 EntryPoint and OKX factory. Bootstrap scripts now use `BOOTSTRAP_PAYMASTER_ADDRESS`, kept separate from the claim relay's `PAYMASTER_ADDRESS`.
- Fixed the OKX owner-signature recovery check: it now recovers against the EIP-191 digest, with a local cryptographic test.
- The project builder reviewed the bootstrap contract, tests, deployment and funding scripts, operation encoding, and the official OKX/EntryPoint v0.7 call and prefund paths. Findings were corrected and covered by local tests. This is an in-house source review, not a third-party audit or live sponsorship proof.
- A read-only VPS check at `2026-09-23T16:16:45Z` confirmed the OKBund service and chain/EntryPoint RPC responses. It found no Convey gateway service or container at that historical point. The host had 260 MiB available with 458 MiB swap in use; see [`docs/verification.md`](docs/verification.md). No services or chain state were changed.
- Local bootstrap source review pinned the deploy/build scripts to the verified OKX factory and implementation and added a live implementation-to-EntryPoint check. The operation file writer rejects symlinks and enforces mode `0600`; submit and wait commands now validate that file before use. Submission waits for an ERC-4337 receipt and reports UserOperation status, transaction status, transaction hash, and block number. `pnpm bootstrap:wait` checks inclusion without resubmitting.
- [`docs/aa-gate-design.md`](docs/aa-gate-design.md) records the receiver signer shape, the in-house source review, and the implemented bootstrap policy. The encrypted vault core is implemented; browser passkey/recovery and state-changing owner-revocation proof remain open. The live read-only owner-call simulation and sponsorship evidence are recorded in [`docs/verification.md`](docs/verification.md).
- Coinbase VerifyingPaymaster was reviewed as a v0.7 reference but not selected unchanged: its generic policy does not enforce Convey's exact operation target, its listed deployments are Base deployments, and the Cantina review's exact source revision has not been matched. See [`docs/aa-provider-research.md`](docs/aa-provider-research.md).
- The operator provisioned distinct `SMART_ACCOUNT_OWNER_PRIVATE_KEY`, `DEPLOYER_PRIVATE_KEY`, and `BOOTSTRAP_PAYMASTER_SIGNER_PRIVATE_KEY` values in the ignored local `.env`. Their public role addresses are distinct; no private values were printed. The receiver account `0x63B2A84d47cb07fb18EE72Ec386893506Fd963db` is now deployed on chain 196 by the sponsored operation. The deployed paymaster is `0x6647cef848fc54b0c821f91a88d83227f65e36b9`; its deployment and sponsorship transactions are recorded in `docs/verification.md`. Sponsor nonce `0`, paymaster verification gas limit `200000`, and max-cost cap `0.01 OKB` are configured. The receiver's EntryPoint nonce is now `1`; the paymaster authorization is consumed. `BUNDLER_PRIVATE_KEY` remains only in the VPS root-owned service environment, and its public wallet retains `0.000781673979083699 OKB`.
- The ignored local `.env` was found with mode `0666` and changed to owner-only mode `0600` without reading or printing its contents. Keep operator keys in this file or a secret manager, never in chat.
- Pinned OKBund is installed and running as a persistent loopback-only service on the Lightsail VPS. Its dedicated bundler wallet is funded. The product contracts and registry entries are deployed on X Layer; public addresses, receipts, and policy are in `docs/product-deployment.json`. Gift ID `1` reached on-chain claim inclusion but failed internally and was reclaimed. Gift ID `2` was subsequently created and claimed successfully through Convey's private route; the evidence is recorded below.
- The connected-wallet sender module is committed and exported as
  `convey/sender`; the Next.js home surface now connects an injected existing
  wallet, reads live certified assets, and creates real signature-bound gifts.
  QR rendering remains separate.
- The persistent gateway's server-only claim authorization route is deployed.
  Its signer matches the live paymaster verifier; a non-mutating request for
  closed Gift ID `2` returned `409 gift_claim_reserve_unavailable`, and no new
  UserOperation was submitted.
- The receiver flow library now joins the encrypted vault to the live claim
  path: PRF enrollment/unlock/recovery, live Gift preview, link parsing, claim
  calldata, live gas seed/estimation, and private two-pass paymaster
  authorization are implemented and locally tested. The virtual-authenticator
  PRF capability check is recorded below; persistent production browser
  enrollment/recovery and state-changing on-chain owner-management/revocation
  proof remain open. The public HTTPS web edge is deployed separately.
- The Next.js receiver surface is implemented and production-built. It reads
  live escrow/registry state and issuer valuation, shows the recovery key once
  with an encrypted recovery bundle and explicit save confirmation, performs the live seed/estimate/claim path,
  and proxies only allowlisted relay and issuer-valuation paths server-side. It has not been
  presented as a completed browser claim: persistent production browser
  enrollment/recovery and browser mainnet proof remain open.
- The corrected exit paymaster is now deployed at
  `0xcfd241979d578e0b43f4c3f6b9b3fab83b41974c` and funded/staked through the
  canonical EntryPoint v0.7. Deployment, deposit, and stake receipts are in
  `docs/verification.md` and `docs/product-deployment.json`. The private
  gateway and public web bundle were updated to this address and smoke-tested.
  A real gasless cash-out then completed through OKBund; the UserOperation,
  bundle transaction, final balances, and public status readback are recorded
  in `docs/verification.md`.
- Added the read-only `pnpm ops:check` monitor for the claim paymaster, exit
  paymaster, and optional bundler-wallet balance. Added the guarded
  `pnpm ops:topup` dry-run/write path, five-minute systemd service/timer
  templates, CI, and the `convey/receiver` SDK export. No top-up transaction
  was sent during this continuation. The timer is installed and its first
  live run passed on the supplied VPS; current refill shortfalls are recorded
  in `docs/verification.md`. A read-only recheck at `2026-09-25T09:27:59Z`
  still found all Convey services and the timer healthy, with about `417 MiB`
  available VPS memory. A final read-only check at `2026-09-25T09:38:56Z` found
  OKBund, gateway, web, and the timer active; the latest monitor run completed
  successfully with no failures. A later monitor run at
  `2026-09-25T10:15:54.816Z` again returned `healthy = true` with no failures;
  at `2026-09-25T10:16:59Z` all four units were active.
- Added `pnpm account:owner-check` and deterministic passkey API-boundary tests.
  The read-only owner check at `2026-09-25T09:56:25.561Z` confirmed the live
  receiver has one active admin owner, the built-in ECDSA validator, no hook,
  zero expiration, and the canonical v0.7 EntryPoint. Its `eth_call` simulation
  of `owner EOA -> execute -> removeOwner` succeeded and the post-call state was
  unchanged. No revocation mutation was attempted; a disposable/multi-owner
  state-changing proof remains open.
- Corrected the guarded withdrawal script's owner check to compare the configured
  owner EOA with the verified receiver owner rather than the smart-account
  address. Its timestamped dry-run at `2026-09-25T09:53:46.773Z` read the full
  live `6932357`-unit USDT0 balance, completed private authorization and
  estimation for the documented operator sender, and kept `writeEnabled = false`.
  Mined withdrawal inclusion remains open.
- Implemented the minimal `DropEscrow` contract with a mandatory future expiry,
  exact pre-funding, one claim per account address, and sender-only recovery of
  unclaimed slots. Added the local OKX-specific recurring-gift hook policy with
  immutable target, asset, per-gift, reserve, cumulative-budget, and expiry
  bounds. The supplied Lightsail host compiled the current sources with
  Solidity `0.8.23` and passed all `47` Foundry tests, including four Drop and
  five recurring-hook tests. Neither feature is deployed or connected to the
  live gateway; see [`docs/drop-design.md`](docs/drop-design.md) and
  [`docs/recurring-authorization.md`](docs/recurring-authorization.md).
- Added source-matched, dry-run-by-default deployment paths for the two local
  features: `pnpm drop:deploy` and `pnpm recurring:deploy`. Neither command has
  sent a deployment transaction; both require two explicit confirmations for a
  mainnet write.
- The Drop dry-run was exercised again against X Layer at
  `2026-09-25T12:35:52.882Z`; it revalidated chain `196`, the live registry
  `0x156d160e004B7fb2021CFCA8fC6cF069c3b8b029`, and the source-matched
  `DropEscrow` artifact with `3846` deployable bytecode bytes. Neither
  confirmation was present, so it returned `writeEnabled = false`; no
  deployment transaction was produced. The recurring-hook dry-run remains
  unconfigured until a disposable or already multi-owner wallet is supplied;
  the production sole-owner receiver is not used as a substitute.
- CI now checks both guarded deployment scripts with `pnpm scripts:typecheck`
  and `pnpm scripts:syntax`; both pass locally.
- A fresh VPS monitor run at `2026-09-25T11:23:00Z` returned `healthy = true`
  with no failures; the oneshot service returned to `inactive (dead)` normally.
  A read-only edge check at `2026-09-25T11:24:20.378Z` found all four managed
  units active, the public home page at `200`, and an unlisted relay path at
  `404`.
- The latest supplied-host read-only check at `2026-09-25T12:01:01Z` found
  OKBund, relayer, web, and the monitoring timer active; the monitor oneshot
  completed with exit status `0` and returned to `inactive (dead)` normally.
  The unauthenticated local relayer health boundary returned `401`, local web
  returned `200`, and a public-edge check from the supplied host at
  `2026-09-25T12:04:48Z` returned `200` for `/` and `404` for the unlisted
  relay path. No service or chain state was changed.
- A manually triggered read-only monitor run at
  `2026-09-25T12:36:52.855Z` returned `healthy = true` with no failures.
  The canonical EntryPoint code size was `16035` bytes; claim paymaster
  deposit/stake were `197696031949403`/`1` wei, exit paymaster deposit/stake
  were `73206079000000`/`1` wei, and the bundler balance was
  `786293569236941` wei. The oneshot returned to `inactive (dead)` and the
  five-minute timer remained active. No chain write or managed-service restart
 was performed.
- On `2026-09-25` the Namecheap DNS records for `conveyapp.site` and
  `www.conveyapp.site` were pointed at `13.62.181.128`. Nginx was added as a
  separate site, Let's Encrypt issued a certificate covering both names
  (expiry `2026-12-24`), and the verified frontend bundle was activated in
  `convey-web.service`. At `2026-09-25T13:57:50Z`, both HTTPS hosts returned
  `200`, the redesigned home copy was present, and `convey-web`,
  `convey-relayer`, and `convey-okbund` were active. No chain write was made.
- A fresh `pnpm account:owner-check` at `2026-09-25T12:20:32.805Z` again
  confirmed the receiver has exactly one active admin owner, zero hook, and
  unchanged state after the read-only revocation simulation.
- The latest guarded withdrawal dry-run at `2026-09-25T11:56:19.202Z` prepared
  the full live `6932357`-unit USDT0 balance for the documented operator
  recipient and kept `writeEnabled = false`; no UserOperation was submitted.
- A read-only browser capability check at `2026-09-25T11:10:27.355Z` loaded the
  deployed HTTPS edge in Chrome for Testing with Chromium's virtual CTAP2.2
  authenticator. WebAuthn PRF enrollment and repeated assertion succeeded with
  user verification and stable 32-byte output. This is not physical-device,
  persistent-storage, recovery, revocation, or browser mainnet proof.
- The deployed receiver bundle was corrected to use an allowlisted same-origin
  issuer-valuation proxy and to map live wrapper symbols to Backed issuer symbols.
  At `2026-09-25T11:51:29.979Z`, Chromium loaded the home and closed Gift ID `2`
  routes with zero console/page/request errors; the closed route offered no claim
  or enrollment action. No operator credential names appeared in rendered HTML.
- Added same-device receiver resume hardening: live `Claimed` state gates the
  path, the persisted owner re-derives the deterministic OKX account through the
  factory, and a fresh passkey unlock is required before exit actions are enabled.
  The rebuilt web bundle was deployed without chain writes; at
  `2026-09-25T12:16:30Z`, read-only edge checks returned `200` for `/` and both
  valuation routes, `400` for an invalid valuation network, and `404` for an
  unlisted relay path. A browser with no local vault remains fail-closed on a
  closed gift. A direct read-only helper check at `2026-09-25T12:22:51.149Z`
  re-derived the deployed receiver address exactly; no key material was printed.
  A subsequent chain-196 guard redeploy remained active at
  `2026-09-25T12:28:05Z`; the same edge checks passed and the live helper matched
  the receiver again at `2026-09-25T12:28:11.185Z`.

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
- Its existing private SSH key now lives outside the repository at `~/.ssh/convey-lightsail.pem` (moved from the workspace root on 2026-09-25). It is owner-readable only, parses as a 2048-bit RSA SSH key, and `.gitignore` excludes `*.pem`. Never print, copy into docs, or commit its contents.
- The existing key is usable from this workspace; ordinary sandboxed SSH is blocked, so use the approved SSH escalation path. The VPS runs Ubuntu 24.04.4, has 2 GB swap, and already hosts other services; do not restart or overwrite them.
- Pinned OKBund `77ac3770ba7dd4be949975b142623540e28f60e4` passed `mvn verify` on the VPS with Java 21/Maven. Jar SHA-256: `7aa098ee3629a83c7d08a8672deb2747205c418fbef59d104158b61b4ace7c60`.
- `convey-okbund.service` is enabled and active. It binds only to `127.0.0.1:3000/rpc`; live RPC returned chain `0xc4` and the canonical v0.7 EntryPoint. A later workspace `pnpm bundler:check` through a temporary SSH tunnel passed for chain 196 and EntryPoint v0.7, superseding an earlier generic connection failure. The persistent `convey-relayer.service` is now enabled and active on `127.0.0.1:8800`; its authenticated live health evidence is in [`docs/verification.md`](docs/verification.md).
- `convey-web.service` is enabled and active on `127.0.0.1:3001`. Separate
  Nginx sites terminate HTTPS at `https://conveyapp.site` and
  `https://www.conveyapp.site` and forward to that loopback app. The
  custom-domain certificate was issued by Let's Encrypt on 2026-09-25, expires
  on 2026-12-24, and automatic renewal is configured. The original
  `sslip.io` site remains available as a compatibility endpoint.
- The generated bundler wallet is `0xa537812DdaD4AcaA3617E316c8f9b4Add6C9D67e`. Its key and the existing NodeFlare credential are stored in root-only `/etc/convey/okbund.env`; never read or print that file's contents. Its latest live balance is `0.000781673979083699 OKB`; the earlier zero-balance reading preceded funding. The initial gas price observation was `0x1406f40` wei.
- After service start, it used about 199 MiB under a 650 MiB service cap; the host reported about 288 MiB memory available. The gateway has since been added after a fresh capacity check; continue watching host memory and the paymaster deposit. The local workspace has no `BUNDLER_RPC_URL`; from another process on this same VPS, the internal URL is `http://127.0.0.1:3000/rpc`.

## Resume in this order

1. Run the production WebAuthn enrollment/recovery ceremonies with persistent
   client storage or a physical authenticator, then prove the inspected OKX
   owner-revocation path on a disposable or multi-owner account.
2. Exercise the deployed receiver UI with that persistent browser state; the
   virtual-authenticator PRF capability proof is recorded above, but the full
   browser-to-receiver flow is not yet claimed.
3. Submit and record one explicit live-quoted gasless withdrawal; the separate
   operator cash-out proof is complete and recorded above.
4. Execute and record one complete browser-to-browser X Layer mainnet flow.
5. Keep the installed monitoring timer healthy and fund the paymaster refill
   shortfalls only after reviewing the guarded live plan.
6. Run and review the guarded Drop dry-run, then integrate and explicitly
   deploy the locally tested Drop contract after deciding its anti-bot/access
   and gas policy.
7. Exercise the local recurring-hook policy against a disposable or multi-owner
   OKX wallet, including mined admin revocation and post-revocation failure.
8. Finish any remaining SDK, CI, README, and production-review polish. The
   connected-wallet sender module is already implemented and exported as
   `convey/sender`.

The project builder's in-house source review is complete for the one-operation
bootstrap path; no third-party audit is claimed. The successful live evidence
is recorded above and in `docs/verification.md`. The current TypeScript suite
and script syntax checks pass; Foundry is unavailable in the current workspace,
while the supplied Lightsail host compiled and ran the current 47-test Solidity
suite in an isolated temporary directory. No Drop or recurring-hook deployment
was attempted; both paths remain dry-run-by-default and require explicit write
confirmations.

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

### Pause checkpoint — resume after operator limit reset

The workspace is intentionally paused until the operator's usage limit resets.
The latest repository commit is `ba61d5d` (`focus README on working claim
experience`), and the TypeScript suite passes 3/3. On 2026-09-24, the private
execution RPC accepted the event tracer again and a fresh read-only state
check confirmed the claim checkpoint below.

At this historical checkpoint, do not reuse Gift ID `1` or its exposed secret.
Gift ID `1` was `Reclaimed`, all NVDAx was back with the sender, and all gift
reserve buckets were zero. Gift ID `2` was subsequently created and claimed;
the completed evidence follows below.

The next authorized decision is to create Gift ID `2` with a completely fresh
secret, validate a higher account-level `callGasLimit` within the `0.00002 OKB`
reserve using the event-aware preflight, and then submit its claim with sponsor
nonce `1`. Obtain explicit operator authorization immediately before the Gift
ID `2` creation and claim actions.

The pre-claim 2026-09-24 continuation checks found the receiver deployed, OKBund active
on chain 196, `nextGiftId = 2`, Gift ID `1` `Reclaimed`, zero open/in-flight/
pending reserve totals, and the claim paymaster still staked with
`198988059949403` wei deposited at EntryPoint. No transaction or UserOperation
was submitted during those read-only checks. The refreshed tracer report is in
`docs/verification.rpc-capabilities.json`.

Current git command form: `git --git-dir=convey-repo/.git --work-tree=.`.

### Completed Gift ID 2 claim — 2026-09-24

The operator authorized continuation. Gift ID `2` was created with a fresh
owner-only secret and the full `0.030965586663211895` NVDAx amount. The exact
approval transaction was
`0x1a11677c158c7486bf635d283b3dc917ce0c0bb3ade5baf24dac2ced04366468`
at block `71480514`; `createGift` was
`0x67d63026316a0d929edd434436806f6dca4fe8d07aa0c1fd839f330274e01f68`
at block `71480785`.

The gasless sponsored claim UserOperation
`0x1ed2abda8798479bd1dd74c81073007ca791a292b1c727af198da552e3a94403`
was included by transaction
`0x05179c720349f882b589562ad56df7c57385094233dabc6559947e5c8ea6945b`
at block `71489278`. Both the transaction and `UserOperationEvent` succeeded.
Actual UserOperation gas used was `389113`, and actual cost was
`7821171300000` wei.

Final live state: Gift ID `2` is `Claimed`; the receiver holds exactly
`0.030965586663211895` NVDAx; escrow and sender NVDAx balances are zero;
`openReserveTotal`, `inFlightTotal`, and `pendingRefundTotal` are zero; and the
receiver EntryPoint nonce is `3`. No claim secret or private key is stored in
the repository.

OKBund remains in safe mode. Its NodeFlare JavaScript tracer was corrected to
mark out-of-gas only from an actual tracer fault (while retaining the EIP-150
SSTORE gas-floor check), avoiding a false positive from dynamic CALL cost
reporting. The pinned upstream revision remains
`77ac3770ba7dd4be949975b142623540e28f60e4`; the two-file runtime source diff
passed `mvn verify`. OKBund defaults to manual bundling in this deployment, so
the accepted operation was included with its supported
`debug_bundler_sendBundleNow` RPC. The claim proof used an ephemeral localhost
gateway before the persistent service was installed. The persistent private
gateway is now active on the supplied VPS, and the public web edge is deployed
separately; no public gateway endpoint is exposed and no browser mainnet claim
is recorded yet.
