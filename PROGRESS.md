# Progress

## Current checkpoint — 2026-09-25

- Replaced the front-runnable secret-reveal claim with a signature-bound claim
  key (GiftEscrow v2) and redeployed the claim paymaster pair on mainnet after
  confirming zero open v1 gifts; the v1 surplus deposit funded the migration.
  Hardened the gateway: fail-closed bearer auth, per-account/global sponsor
  signing limits, a daily exit-spend cap, and a per-IP limit on the public
  relay proxy. Both are live on the VPS. Evidence is in
  `docs/verification.md`. The first v2 mainnet claim is still to be recorded.
- Implemented the scoped gasless exit path: live Uniswap V3 quote plumbing, withdrawal/cash-out policy, separate v0.7 exit paymaster contract, relay endpoints, receiver actions, and tests. The existing claim paymaster remains claim-only.
- The Namecheap DNS records for `conveyapp.site` and `www.conveyapp.site`
  now point to the supplied VPS. Let's Encrypt covers both names, Nginx
  forwards them to the loopback web service, and the verified blue/white
  animated frontend build is live at both HTTPS URLs. The live checks returned
  `200` for both hosts at `2026-09-25T13:57:50Z`; no chain write was made.
- Corrected the X Layer SwapRouter02 `exactInput` ABI to the deployed four-field
  shape, added quote-expiry enforcement, and made exit deployment refuse a stale
  Foundry artifact. Exit authorization now also rechecks the configured route
  and a fresh QuoterV2 minimum. The corrected source compiled and the full
  Foundry suite passed on the supplied VPS (47 tests, including the new
  DropEscrow and recurring-hook suites).
- The corrected exit paymaster is deployed at
  `0xcfd241979d578e0b43f4c3f6b9b3fab83b41974c` (transaction
  `0x35eb1f85dc8af1d9092f4ac20d506ce79e520e372302e1d13a7976d03b0186d1`,
  block `71533700`), funded with a `0.0001 OKB` EntryPoint deposit and `1 wei`
  stake, and wired into the private gateway. A real gasless exit completed
  through OKBund in bundle transaction
  `0x8bbe7a11e439e8c9d18ce698871d2220231a51f124d58e3c80605a087e9099b0`
  (UserOperation `0xd37eba9f81db81b41bc81863a3e06ecffc7285e321b363a4aecabac650816b8f`,
  block `71534842`). The corrected web bundle is live.
- Added read-only paymaster/bundler operations monitoring, a guarded
  shortfall-based top-up command, five-minute systemd timer templates, CI, and
  the public `convey/receiver` SDK export. The monitor was installed and
  exercised successfully on the supplied VPS; its latest run at
  `2026-09-25T10:15:54.816Z` returned `healthy = true` with no failures, and
  no live top-up was sent.
- A deployed-edge Chromium virtual-authenticator WebAuthn PRF capability proof
  passed at `2026-09-25T11:10:27.355Z`: enrollment reported PRF enabled, repeated
  assertions returned stable 32-byte output, and user verification succeeded.
  Persistent browser storage/recovery, physical-device behavior, owner revocation,
  and browser-to-browser mainnet proof remain open.
- Implemented the minimal `DropEscrow` contract and four invariant tests, plus
  an immutable OKX-specific recurring-gift hook policy and five invariant tests.
  Added source-matched, dry-run-by-default deployment commands for both paths;
  the current Solidity suite passed on the supplied VPS with 47 tests. The Drop
  dry-run revalidated chain `196`, the live registry, and the source-matched
  `3846`-byte artifact at `2026-09-25T12:35:52.882Z`; with no confirmations it
  returned `writeEnabled = false` and produced no deployment transaction. The
  recurring dry-run remains intentionally unconfigured until a disposable or
  multi-owner wallet is supplied. Drop and the recurring hook are not deployed
  or integrated with the UI/gateway.
- Added CI coverage for the guarded deployment scripts through dedicated strict
  typecheck and Node syntax commands.
- Fresh read-only checks at `2026-09-25T10:54:29.174Z` kept the operations
  monitor healthy with no failures; the VPS services and public web edge were
  still active at `10:55:37Z`.
- The `2026-09-25T11:00:50.787Z` owner-state read again confirmed the deployed
  receiver is sole-owner with no hook; the simulated revocation left state
  unchanged.
- The latest guarded withdrawal dry-run at `2026-09-25T11:56:19.202Z` again
  prepared the full live `6932357`-unit USDT0 balance and completed live
  authorization/estimation with `writeEnabled = false`; no UserOperation was
  submitted.
- `pnpm verify` passed again at `2026-09-25T12:39:21.894Z` against the same
  pinned X Layer block; issuer and executable quote observations were refreshed
  in `docs/verification.raw.json` and `docs/verification.md`.
- The current Solidity sources were compiled and tested in an isolated supplied
  VPS directory; the fresh Foundry run completed by `2026-09-25T11:19:27.379Z`
  with all `47` tests passing. The temporary directory was removed.
- Browser production review found and fixed the direct issuer-API CORS boundary
  and the `wNVDAx`/`wAAPLx`/`wTSLAx` wrapper-symbol mapping. The allowlisted
  same-origin valuation proxy was deployed; the final Chromium smoke at
  `2026-09-25T11:51:29.979Z` had zero console/page/request errors and correctly
  failed closed for closed Gift ID `2`.
- The redacted `pnpm verify:bundler-rpc` probe passed at
  `2026-09-25T12:20:49.878Z`; both required NodeFlare `debug_traceCall`
  capabilities remained supported.
- A fresh read-only owner check at `2026-09-25T12:20:32.805Z` again found one
  active owner, zero hook, and unchanged state after the revocation simulation.
  The VPS monitor at `11:23:00Z` was healthy with no failures, and the public
  edge check at `11:24:20.378Z` returned `200` for `/` and `404` for the
  unallowlisted relay path.
- The latest supplied-host read-only check at `12:01:01Z` found OKBund,
  relayer, web, and the monitoring timer active; the monitor oneshot exited
  successfully. The unauthenticated local health boundary returned `401`, and
  a public-edge check from the host at `12:04:48Z` returned `200` for `/` and
  `404` for the unallowlisted relay path. No service or chain state changed.
- A manually triggered read-only monitor run at `12:36:52.855Z` returned
  `healthy = true` with no failures. The canonical EntryPoint code size was
  `16035` bytes; claim paymaster deposit/stake were `197696031949403`/`1` wei,
  exit paymaster deposit/stake were `73206079000000`/`1` wei, and the bundler
  balance was `786293569236941` wei. The oneshot returned to `inactive (dead)`
  and the timer stayed active. No chain write or managed-service restart was
  performed.
- Fixed same-device receiver resume: a live claimed gift now re-derives its
  deterministic OKX account from the persisted owner and requires a fresh
  passkey unlock before gasless exit actions are enabled. The rebuilt bundle was
  deployed without chain writes; read-only edge checks at `12:16:30Z` returned
  `200` for home and valuation routes, `400` for invalid valuation network, and
  `404` for the unallowlisted relay path. A direct read-only helper check at
  `12:22:51.149Z` re-derived the deployed receiver address exactly. The
  subsequent chain-196 guard redeploy passed the same edge checks at `12:28:05Z`
  and the live helper matched again at `12:28:11.185Z`.

## Done

- Created a reproducible, pinned-block X Layer verification script.
- Confirmed chain ID, gas floor observation, canonical EntryPoint bytecode, USDT0 metadata, xStocks V2 wrapper identity, `asset()` values, decimals, multipliers, and direct/two-hop Uniswap V3 pool and quote discovery.
- Classified NVDA and AAPL as clean at $5/$20/$50 at the pinned block; TSLA liquidity is too thin for honest cash-out and must be hold-only unless a fresh runtime quote passes policy.
- Documented the EVM/Token-2022 distinction.
- Verified the deployed OKX Smart Wallet factory and implementation at the pinned block and confirmed it uses ERC-4337 EntryPoint v0.7.
- Inspected the deployed wallet's published source and found that it is modular but does not implement ERC-7579, contrary to the requested stack description.
- Re-ran `pnpm verify` successfully on 2026-09-22, 2026-09-24, and
  2026-09-25 at `2026-09-25T12:39:21.894Z`. The on-chain reads remain pinned;
  issuer API values are live and timestamped.
- Corrected quote terminology: comparison with an issuer-derived nominal amount is an executable delta, not AMM price impact.
- Selected the deployed OKX Smart Wallet as the account path, as allowed by the specification's explicit mismatch resolution. Convey describes it accurately as an OKX-specific modular ERC-4337 v0.7 account, not ERC-7579.
- Researched X Layer sponsor and account options. Particle was retired as a bootstrap dependency; the current provider assessment is in [`docs/aa-provider-research.md`](docs/aa-provider-research.md).
- Adopted Convey as the product name across package metadata, SDK names, environment variables, and operator documentation.
- Added local and example environment configuration slots for the verified EntryPoint and OKX factory plus the self-hosted bundler/paymaster and dedicated operator keys.
- Implemented `pnpm account:inspect` from the official OKX factory ABI. It derives the dedicated owner's counterfactual account without logging the private key and confirms EntryPoint/factory state on chain.
- The original operator fixture derived counterfactual account `0x6B17C1b2663f8fBecd97D038DfC81712e99a54ca`. After the operator provisioned the intended receiver key, `pnpm account:inspect` derived `0x63B2A84d47cb07fb18EE72Ec386893506Fd963db`; the live sponsored bootstrap operation has now deployed it.
- Chose a self-hosted relay path rather than a hosted AA subscription and added the Convey v0.7 UserOperation codec, private bundler client, claim-only relay gateway, live EntryPoint/paymaster health checks, escrow/function target allowlisting, a browser-safe SDK entry point, and pure serialization/security tests.
- Added the OKX v0.7 claim UserOperation builder. It reads live chain/account/nonce state, derives factory init code, encodes `executeUserOp`, and creates the exact owner signature envelope from the inspected OKX source. It requires caller-supplied gas and paymaster data; it does not fabricate sponsorship.
- Selected the operator-controlled OKX OKBund v0.7 source at pinned commit `77ac3770ba7dd4be949975b142623540e28f60e4`; its multi-module build completed locally with Java 21 and Maven.
- Added a live `pnpm verify:bundler-rpc` probe; the public X Layer RPC does not expose the tracing capabilities required for safe bundling, while the keyed NodeFlare endpoint now passes the required probes.
- Configured the capability probe to derive the keyed NodeFlare X Layer endpoint from the local `NODEFLARE_API_KEY`, while redacting credential-bearing RPC paths from logs and verification records.
- Verified the keyed NodeFlare endpoint on 2026-09-23 and again at
  `2026-09-25T12:20:49.878Z`: chain ID `196`, JavaScript-tracer
  `debug_traceCall`, and state-override `debug_traceCall` pass. `trace_call` is
  unsupported; the two required OKBund trace capabilities pass.
- Added a fail-closed OKBund launcher and an address-only operator credential check. The launcher refuses the upstream development-key fallback, wrong chain, wrong EntryPoint, disabled safe mode, or missing EIP-1559 configuration.
- Built pinned OKBund source with Java 21 and passed `mvn verify` on 2026-09-23; its upstream modules contain no tests. Packaged JAR hash and runtime evidence are recorded in [`docs/verification.md`](docs/verification.md).
- Started that package through the checked-in launcher, bound to loopback, against the verified NodeFlare RPC using a generated unfunded throwaway key. `pnpm bundler:check` returned chain `196` and the selected EntryPoint v0.7; no UserOperation was submitted.
- Installed Java 21/Maven and built the pinned OKBund revision on the supplied Lightsail VPS. The packaged jar passed `mvn verify`; it is running under `convey-okbund.service` on loopback port 3000 with its own root-only environment file. A dedicated bundler key was generated on the VPS; only its public address is recorded in `HANDOFF.md`.
- Live calls from the VPS returned chain `196`, the exact v0.7 EntryPoint, zero bundler balance, and the current gas price. No funds were transferred and no UserOperation was submitted. The initial Codespace-side tunnel attempt returned a generic connection failure; a later tunneled `pnpm bundler:check` passed, as recorded below.
- Changed the launcher to bind OKBund to `127.0.0.1` by default; a separate private interface must be selected explicitly.
- Added `pnpm bundler:check`, a read-only probe for a configured private endpoint's live chain ID and supported EntryPoint. It reports only a redacted endpoint origin and can be run before a paymaster or escrow is configured.
- Assessed OKX OnchainOS Agentic Wallet as another X Layer gas-sponsored route. Its documented email/social-login and TEE wallet path does not expose the external v0.7 paymaster operation needed for this account flow; evidence is recorded in [`docs/aa-provider-research.md`](docs/aa-provider-research.md).
- Removed unused Particle credential slots from `.env.example`.
- Recorded the proposed receiver signer shape and one-operation sponsor policy in [`docs/aa-gate-design.md`](docs/aa-gate-design.md). The paymaster is deployed, funded/staked, and proven through the successful sponsored operation below; it is not independently audited.
- Implemented [`ConveyBootstrapPaymasterV07`](contracts/bootstrap/ConveyBootstrapPaymasterV07.sol): chain 196 and EntryPoint v0.7 locked at construction; one configured counterfactual sender/init-code hash; an internally fixed zero-address, zero-value, empty-data OKX call; bounded EIP-712 sponsor authorization; hard `maxCost` cap and a guard on deposits through the paymaster; fixed paymaster gas fields; and one-use authorization state. Direct EntryPoint deposits can bypass the deposit guard.
- Added 10 Foundry invariant tests covering EntryPoint access, chain/paymaster replay, sender/factory/call policy, gas and cost binding, validity windows, malformed authorization, and replay. The expiry test checks packed bounds through a local EntryPoint stub; it is not mainnet evidence.
- Added `forge build`/`forge test` project configuration and operator commands to deploy, fund/stake, build a fully signed harmless operation, and submit it only through the private bundler. Gas and fee values are mandatory inputs; the builder checks live deposit/stake and computes v0.7 required prefund. The paymaster is deployed, funded/staked, and the sponsored operation succeeded.
- Added fail-fast checks so the receiver owner, paymaster owner, and sponsor signer cannot share an address across deployment and operation construction.
- Updated `pnpm operator:addresses` to reject a reused address among configured bundler, deployer, bootstrap paymaster signer, and smart-account owner keys.
- Corrected `pnpm account:inspect` to treat `0x` as no code, check the canonical X Layer v0.7 EntryPoint and OKX factory, and label the full init code accurately. Bootstrap tooling now has a separate `BOOTSTRAP_PAYMASTER_ADDRESS` setting from the claim paymaster.
- Fixed OKX owner-signature recovery to validate the signature against its EIP-191 digest. Added a local cryptographic regression test.
- Performed a read-only health check of the supplied Lightsail VPS at `2026-09-23T16:16:45Z`: OKBund remained active and returned chain `196` plus the canonical v0.7 EntryPoint. The scan found no Convey gateway service/container. Host capacity was 260 MiB available with 458 MiB swap in use; details are in [`docs/verification.md`](docs/verification.md).
- Hardened bootstrap deploy/build tooling to pin the verified OKX factory and implementation addresses and check the implementation's live EntryPoint. The signed-operation file writer rejects symlinks and enforces mode `0600`; submit/wait consumers validate the file before using it. The submit command now waits for an ERC-4337 receipt and reports success, transaction hash, and block. `pnpm bootstrap:wait` recovers inclusion status without resubmission. This is the project builder's in-house source review, not a third-party audit.
- Deployed the bootstrap paymaster on X Layer mainnet at `0x6647cef848fc54b0c821f91a88d83227f65e36b9`. Transaction `0x9a8cf11980eb29f67b5419ef90e4784b15bf9663ff78c7a958783b07fe6ea4d8` succeeded in block `71416764`; live getters and runtime bytecode were verified. The paymaster was funded/staked, and the final sponsored UserOperation is recorded in [`docs/verification.md`](docs/verification.md). The deployer and bundler balances are recorded there; no private values were printed.
- Completed the live gate: UserOperation `0x1361ecee72221c81ee911f1446e3531e6086ffa9b2bee87bec22cd0ecc7f413c` succeeded in bundler transaction `0xfdb3ef41083b02282a304c948194b1ec9dca42d14f5fec258b8a12c2e7b4df09` at block `71422410`. The receiver is deployed, EntryPoint nonce is `1`, and the one-use sponsor authorization is consumed.
- Added the first product contracts: `AssetRegistry` enforces certified and enabled asset entries, and `GiftEscrow` implements a hashlocked single gift with sender reclaim, optional second-channel code, expiry, exact ERC-20 accounting, and caller-bound claims. Added Foundry invariant coverage in `test-solidity/AssetRegistryGiftEscrow.t.sol`.
- Installed Foundry 1.8.3 on the supplied Lightsail host for Solidity verification. After correcting the wrapped-entry fixture, `forge build` and the full suite passed: 24 tests across the bootstrap, registry, and escrow suites.
- Added `ConveyClaimPaymasterV07` and wired `GiftEscrow` to lock a sender-funded native OKB claim reserve at creation. Validation pre-charges `maxCost`, binds the non-circular operation-fields digest, and `postOp` reconciles actual cost with duplicate and overrun protections. The expanded suite passed 32 tests on the supplied VPS.
- Added `pnpm product:deploy`, which deploys or safely resumes the registry, unbound claim paymaster, escrow, and one-time escrow binding with live cross-contract readback. It now reserves explicit sequential nonces to handle an X Layer RPC nonce race without duplicate contracts.
- Added `pnpm product:fund`, which checks the deployed paymaster's owner, EntryPoint, reserve policy, and then funds its EntryPoint deposit and stake with explicit operator amounts.
- Deployed the product contracts on X Layer mainnet: `AssetRegistry` `0x156d160e004B7fb2021CFCA8fC6cF069c3b8b029`, `ConveyClaimPaymasterV07` `0xe6913061bc2021B0dfdeECB867F7a9F5F77236B6`, and `GiftEscrow` `0xaa396c814d38cf9e707c6bbc0635f1ee7d584062`. Bound the paymaster to the escrow and verified both cross-contract links live.
- Funded and staked the product claim paymaster with a `0.0002 OKB` EntryPoint deposit, `1` wei stake, and 86,400 second unstake delay. The configured per-gift reserve and maximum claim cost are each `0.00002 OKB`. Receipts and public configuration are in [`docs/product-deployment.json`](docs/product-deployment.json).
- Added `pnpm product:register-assets` and registered all three live xStock wrappers. NVDAx and AAPLx use the verified Uniswap SwapRouter02 route; TSLAx is certified and enabled as hold-only because the live pinned quotes are too thin for cash-out.
- Added the claim-paymaster v0.7 operation-fields digest and EIP-712 signing codec to the relayer. The off-chain operation hash and authorization digest match the deployed Solidity getters on X Layer; the helper is covered by TypeScript tests.
- Funded the sender with `7` USDT0, approved exactly that amount to the verified X Layer SwapRouter02, and completed a live direct 0.3% USDT0→NVDAx swap. Approval transaction `0xade67ce967bf701f92b7574b55c7840939f4f0647c83a281770308ce57330130` succeeded in block `71459201`; swap transaction `0xbd4f39e17fb02851abe6affb4b4a6e57a5adcf0105cb9dfdcae89be39a7cadae` succeeded in block `71459663`, yielding `0.030965586663211895` NVDAx. Final private-RPC balances and zero router allowance were verified.
- Created live Gift ID `1` with the full `0.030965586663211895` NVDAx balance. The exact escrow approval succeeded in transaction `0xcc4b7c963e4ec26f36cb508e402a8bc7412a15811ad8e061fb6cc021e7dcf1ac` at block `71460696`; `createGift` succeeded in transaction `0x58921e5bc238bf36534ff6c8fd828dd1af17808e54aa3900cad5c6f9e609bf9e` at block `71460786`.
- Submitted the first product claim through the private gateway and OKBund. UserOperation `0xd3efe7e60f40e556d6f4fea79335723f0f5aab8924c0b015393a2451534346b1` was included in transaction `0xc4610b7cc244c7ec728c486d90493e94bfa976de9fcf4cfa46e04f744c1a05f6` at block `71463789`, but `UserOperationEvent.success` was false with `TokenTransferFailed()`. The likely cause is an insufficient account-level `callGasLimit`; a direct token-transfer call at the same historical state fit within that limit, but the complete account-to-escrow-to-token path did not.
- Reclaimed the exposed Gift ID `1` immediately in transaction `0x6add4c95079719111eab9b3ebd9c7b6a6cc91df9b8e58384c4d57f12fc4fff9f` at block `71463978`. The sender recovered all NVDAx, escrow and reserve accounting are zero, and the exposed secret is retired permanently.
- Disabled OKBund's incompatible node-side fallback estimator while retaining EntryPoint/EVM simulation, and made the gateway normalize OKBund's numeric receipt block number.
- Added event-aware EntryPoint preflight that traces the exact v0.7 `handleOps` call, requires the matching `UserOperationEvent.success`, and decodes `UserOperationRevertReason`. Its synthetic tests pass, and a live read-only trace captured an ERC-20 event through the configured private execution RPC.
- On 2026-09-24, resumed with read-only live checks: the deployed receiver and
  NodeFlare tracing capabilities passed; the supplied VPS OKBund service was
  active on chain 196; and the product state confirmed Gift ID 1 reclaimed,
  `nextGiftId = 2`, zero open/in-flight/pending reserves, and the full NVDAx
  balance returned to the sender. No new transaction or UserOperation was
  submitted.
- Created Gift ID `2` with a fresh secret and the recovered
  `0.030965586663211895` NVDAx. Approval transaction
  `0x1a11677c158c7486bf635d283b3dc917ce0c0bb3ade5baf24dac2ced04366468`
  succeeded at block `71480514`; creation transaction
  `0x67d63026316a0d929edd434436806f6dca4fe8d07aa0c1fd839f330274e01f68`
  succeeded at block `71480785`.
- Completed the live sender-funded product claim. UserOperation
  `0x1ed2abda8798479bd1dd74c81073007ca791a292b1c727af198da552e3a94403`
  succeeded in transaction
  `0x05179c720349f882b589562ad56df7c57385094233dabc6559947e5c8ea6945b`
  at block `71489278`. Gift ID `2` is `Claimed`; the receiver holds the full
  NVDAx amount, escrow and sender hold zero, all reserve buckets are zero, and
  the receiver EntryPoint nonce is `3`.
- Corrected OKBund's safe-mode JavaScript tracer false-positive OOG heuristic,
  retained actual OOG fault and SSTORE-floor detection, rebuilt with
  `mvn verify`, and exercised the operation through the localhost Convey
  gateway plus OKBund's supported manual bundle RPC.
- Added the persistent private gateway service definition. It is scoped to
  loopback port `8800`, authenticates requests, uses the existing NodeFlare and
  OKBund path. The public HTTPS web edge is now deployed separately; browser
  PRF and mainnet proof remain open.
- Added the connected-wallet sender module. It requires a standard EIP-1193
  provider, reads the live registry/token/paymaster state, performs exact
  approval, creates a real hashlocked gift, returns the receipt-derived Gift ID
  and claim link, and supports sender status/reclaim. It does not fabricate
  balances, prices, reserves, or QR output.
- Added the connected-wallet sender surface to the Next.js home page. It uses
  the injected existing wallet, live registry asset slots, and receipt-derived
  claim links; no sender key is created or stored by Convey.
- Added the server-side `/v1/claims/authorize` route. It signs only an unsigned
  operation targeting the configured escrow claim selector, checks the live
  open reserve and paymaster verifying signer, and allocates an unused sponsor
  nonce. The signer remains in the root-controlled VPS environment.
- Corrected claim authorization to sign the live ERC-4337 v0.7 gas pre-fund
  computed from the operation's gas fields, while retaining the deployed
  paymaster's maximum-cost cap. The gateway now exposes a live gas seed from
  the successful Gift ID `2` operation, recovering omitted paymaster fields from
  its recorded EntryPoint bundle transaction when OKBund leaves them out.
- Installed the existing claim-paymaster signer into that environment without
  printing it. The deployed route was probed against closed Gift ID `2` and
  returned the expected `409 gift_claim_reserve_unavailable`; no operation was
  submitted.
- Added the receiver flow library: PRF-backed passkey enrollment, encrypted
  vault unlock and recovery rewrap, live escrow gift preview,
  `/g/<secret>?giftId=<id>` parsing, claim calldata, live-estimate conversion,
  and the two-pass private gateway authorization needed to sign a gasless
  claim. The receiver private key remains local; persistent production browser
  enrollment/recovery and state-changing on-chain owner-revocation proof are
  still not claimed as complete.
- Added `pnpm account:owner-check`, which read the deployed receiver's live
  owner list, validator, hook, expiration, admin flag, and EntryPoint without a
  chain write. Its read-only `owner EOA -> execute -> removeOwner` simulation
  succeeded and left live state unchanged. Added deterministic passkey
  API-boundary tests; these supplement the recorded virtual-authenticator
  capability proof but do not replace persistent/physical browser integration or
  a mined disposable/multi-owner revocation test.
- Added iterative live claim preparation: the receiver gets live seed fields,
  signs the exact sponsor authorization locally, asks OKBund for a live
  estimate, and re-authorizes only if the returned limits grow. The enrollment
  ceremony keeps a short-lived signer in memory so it does not ask for a second
  passkey ceremony before the claim.
- Fixed the guarded withdrawal command's owner-EOA versus smart-account address
  validation. A live dry-run read the full USDT0 balance and completed private
  authorization/estimation without submitting; mined withdrawal inclusion still
  requires explicit destination/amount approval.
- Added replacement-device recovery to the receiver surface: enrollment offers
  an encrypted recovery bundle download, same-device unlock uses the existing
  passkey, and migration accepts the bundle plus separately saved recovery key.
  The tested production artifact was redeployed at `2026-09-24T17:02:33Z`.
- Added the Next.js receiver surface and same-origin relay proxy. The screen
  reads live escrow/registry data and issuer valuation, shows the recovery key
  once with an encrypted recovery bundle and explicit save confirmation, calls
  the live claim route, and keeps relay credentials server-side. The production
  build is deployed behind the
  public HTTPS web edge; persistent production browser enrollment/recovery and
  the browser mainnet claim remain open.

## Next

- Exercise the production receiver UI with persistent browser storage or a
  physical authenticator, complete recovery, and prove the inspected OKX
  owner-revocation path on a disposable or multi-owner account. The isolated
  virtual-authenticator capability proof is recorded in `docs/verification.md`;
  the library path and local tests are in place.
- Submit and record the direct gasless withdrawal route after explicit
  destination/amount approval; the operator cash-out proof is complete and is a
  separate path.
- Execute one complete browser-to-browser mainnet flow through the persistent
  private gateway, recording every receipt.
- Keep the installed gateway/paymaster monitoring timer healthy and review
  refill shortfalls before integrating Drop.
- Review the guarded `pnpm drop:deploy` dry-run, decide its anti-bot/access and
  gas policy, then integrate and explicitly deploy Drop; run the disposable-
  wallet recurring-hook proof with mined revocation and finish the production
  review.

## Blocked

- No transaction-gate blocker remains. The sponsored v0.7 UserOperation succeeded through the private OKBund endpoint; the builder's in-house source review is documented and is not represented as a third-party audit.
- OKBund and the Convey gateway are running on the supplied 1 GB Lightsail
  host. The gateway is loopback-only and authenticated; monitor host memory and
  the paymaster deposit before browser traffic is enabled.
- A later workspace `pnpm bundler:check` through the temporary SSH tunnel passed for chain 196 and EntryPoint v0.7. An earlier generic connection failure is superseded; the persistent gateway health check is now recorded in `docs/verification.md`.
- The relay SDK and gateway are implemented. The persistent gateway health check
  passed against live X Layer/OKBund, and the public web edge is deployed at
  `https://convey.13-62-181-128.sslip.io`; persistent production browser
  enrollment/recovery and browser mainnet proof are still required.
- The account-standard decision is settled on the deployed OKX modular ERC-4337 v0.7 account; it is not labeled ERC-7579. The encrypted receiver signer vault and read-only owner-call simulation are implemented and tested; the browser ceremony and state-changing owner revocation proof remain open.
- Product escrow and claim-reserve code are deployed and funded. The private claim route now has a successful sender-funded Gift ID `2` claim; browser receiver integration remains open.
- Implemented the minimal `DropEscrow` contract and four invariant tests. It
  pre-funds every slot, enforces one claim per account address, and returns
  only unclaimed slots after expiry. It is not deployed or integrated with the
  UI; the design boundary is in [`docs/drop-design.md`](docs/drop-design.md).
- Added the local `ConveyRecurringGiftHook` policy with exact GiftEscrow target
  and selector checks, per-gift/native-reserve/cumulative-budget/expiry bounds,
  wallet-only callbacks, and rollback coverage. It is not deployed or attached
  to the sole-owner receiver; the live proof is in
  [`docs/recurring-authorization.md`](docs/recurring-authorization.md).
- The Codespace still does not have `forge`; the current Solidity sources were
  compiled and the full 47-test suite was run in an isolated temporary
  directory on the supplied Lightsail host. Product constructor,
  cross-contract readbacks, and the successful live Gift ID `2` claim are
  recorded.

## Verification results

`pnpm test` passed after the Convey rename and signature-recovery fix. The
current 47-test Foundry suite passed with Solidity 0.8.23 and Foundry 1.8.3;
the expiry case uses a local EntryPoint stub. The four Drop tests and five
recurring-hook tests cover the new product invariants locally, but neither
feature has live deployment evidence.
The pinned OKBund source passed `mvn verify`
with Java 21 (no upstream tests are present), and its local read-only runtime
probe returned chain `196` and the selected v0.7 EntryPoint. `pnpm verify`
passed against X Layer mainnet at
`2026-09-25T12:39:21.894Z` with the same pinned block; the latest raw report is in
`docs/verification.raw.json`. `pnpm verify:bundler-rpc` passed against the
keyed NodeFlare X Layer endpoint at `2026-09-25T12:20:49.878Z`; both required
`debug_traceCall` variants succeeded. The latest raw capability report is in
`docs/verification.rpc-capabilities.json`. `pnpm bundler:check` passed against
the locally launched pinned OKBund service through its checked-in launcher.
`pnpm relayer:check` still awaits the later claim gateway and deployed product paymaster.
During the latest continuation, `pnpm test` passed, the receipt and operation
record scripts passed `node --check`, and the final `pnpm bootstrap:wait`
reported `included-success`. Foundry is not installed in the current workspace,
but the current sources were freshly compiled and all 47 Solidity tests passed
on the supplied VPS at `2026-09-25T11:19:27.379Z`. The final sponsored
operation, receipt, and post-inclusion live state are recorded in
`docs/verification.md`. A tunneled
`pnpm bundler:check` passed for chain 196 and EntryPoint v0.7.
The registry, escrow, and claim-paymaster suites passed on the supplied
Lightsail host with Foundry 1.8.3: 33 tests passed, 0 failed. The Codespace
side `pnpm contracts:test` still exits with `forge: not found`.
The product deployment and funding scripts completed against X Layer mainnet;
the public receipts and live getter readback are recorded in
`docs/product-deployment.json`. On 2026-09-24, the sender-funded NVDAx
acquisition, Gift ID `1` creation, failed on-chain claim, and protective
reclaim completed; their hashes and final private-RPC state are recorded in
`docs/verification.md` and `HANDOFF.md`.
The persistent gateway was then verified active on `127.0.0.1:8800`: an
unauthenticated request returned `401`, authenticated health returned chain
`196` with the canonical EntryPoint and funded/staked claim paymaster, and a
non-mutating authorization request for closed Gift ID `2` returned
`409 gift_claim_reserve_unavailable`. No new transaction or UserOperation was
submitted during these gateway checks.
The Next.js production build passed with Next `16.3.6`; `pnpm exec tsc --noEmit`
and the six-test TypeScript suite passed. A local HTTP smoke test returned
`200` for the landing page and `404` for an unallowlisted relay path.
The production build was deployed to the supplied VPS as `convey-web.service`
on `127.0.0.1:3001`, with Nginx TLS at
`https://convey.13-62-181-128.sslip.io`. A live public GET returned `200` and
the public unallowlisted relay path returned `404`; `convey-okbund.service`,
`convey-relayer.service`, and `convey-web.service` were all active. This is
deployment evidence, not persistent production browser enrollment/recovery or a
browser mainnet claim proof.
