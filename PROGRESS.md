 # Progress

## Done

- Created a reproducible, pinned-block X Layer verification script.
- Confirmed chain ID, gas floor observation, canonical EntryPoint bytecode, USDT0 metadata, xStocks V2 wrapper identity, `asset()` values, decimals, multipliers, and direct/two-hop Uniswap V3 pool and quote discovery.
- Classified NVDA and AAPL as clean at $5/$20/$50 at the pinned block; TSLA liquidity is too thin for honest cash-out and must be hold-only unless a fresh runtime quote passes policy.
- Documented the EVM/Token-2022 distinction.
- Verified the deployed OKX Smart Wallet factory and implementation at the pinned block and confirmed it uses ERC-4337 EntryPoint v0.7.
- Inspected the deployed wallet's published source and found that it is modular but does not implement ERC-7579, contrary to the requested stack description.
- Re-ran `pnpm verify` successfully on 2026-09-22 and made the mixed evidence model explicit: on-chain reads are pinned; issuer API values are live and timestamped.
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
- Verified the keyed NodeFlare endpoint on 2026-09-23: chain ID `196`, JavaScript-tracer `debug_traceCall`, and state-override `debug_traceCall` pass. `trace_call` is unsupported; the two required OKBund trace capabilities pass.
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
  OKBund path, and keeps the public HTTPS edge separate from the browser work.

## Next

- Finish receiver key enrollment and recovery integration: exercise the real
  browser WebAuthn PRF ceremony and persistent storage, then prove the inspected
  OKX owner revocation path. The encrypted vault core and local tests are in
  place; see `docs/receiver-key-management.md`.
- Build the connected-wallet sender flow around the deployed registry and
  `GiftEscrow`: OKX Wallet first, live asset reads, exact approval, gift
  creation, and link/QR output. No sender-side mock balances or quotes.
- Build the receiver claim screen against the private gateway, then implement
  live-quoted gasless cash-out and gasless withdrawal.
- Execute one complete browser-to-browser mainnet flow through the persistent
  private gateway and record every receipt.
- Add gateway/paymaster monitoring and a documented top-up operation before
  starting Drop.
- Then build Drop, prove an OKX-specific recurring authorization design, and
  finish the SDK, CI, README, and production review.

## Blocked

- No transaction-gate blocker remains. The sponsored v0.7 UserOperation succeeded through the private OKBund endpoint; the builder's in-house source review is documented and is not represented as a third-party audit.
- OKBund and the Convey gateway are running on the supplied 1 GB Lightsail
  host. The gateway is loopback-only and authenticated; monitor host memory and
  the paymaster deposit before browser traffic is enabled.
- A later workspace `pnpm bundler:check` through the temporary SSH tunnel passed for chain 196 and EntryPoint v0.7. An earlier generic connection failure is superseded; the persistent gateway health check is now recorded in `docs/verification.md`.
- The relay SDK and gateway are implemented. The persistent gateway health check passed against live X Layer/OKBund, but an authenticated HTTPS edge for the browser is still required; the SDK does not substitute for that edge.
- The account-standard decision is settled on the deployed OKX modular ERC-4337 v0.7 account; it is not labeled ERC-7579. The encrypted receiver signer vault is implemented and locally tested; the browser ceremony and on-chain owner revocation proof remain open.
- Product escrow and claim-reserve code are deployed and funded. The private claim route now has a successful sender-funded Gift ID `2` claim; browser receiver integration remains open.
- The Codespace still does not have `forge`; the Solidity suite was compiled and run on the supplied Lightsail host. Product constructor, cross-contract readbacks, and the successful live Gift ID `2` claim are recorded.

## Verification results

`pnpm test` passed after the Convey rename and signature-recovery fix. The
10-test Foundry suite passed with Solidity 0.8.23 and Foundry 1.8.3; the expiry
case uses a local EntryPoint stub. The pinned OKBund source passed `mvn verify`
with Java 21 (no upstream tests are present), and its local read-only runtime
probe returned chain `196` and the selected v0.7 EntryPoint. `pnpm verify`
passed against X Layer mainnet at
`2026-09-22T19:24:57Z` with the same pinned block; the baseline is in
`docs/verification.raw.json`. `pnpm verify:bundler-rpc` passed against the
keyed NodeFlare X Layer endpoint at `2026-09-23T04:32:18Z`; both required
`debug_traceCall` variants succeeded. The latest raw capability report is in
`docs/verification.rpc-capabilities.json`. `pnpm bundler:check` passed against
the locally launched pinned OKBund service through its checked-in launcher.
`pnpm relayer:check` still awaits the later claim gateway and deployed product paymaster.
During the latest continuation, `pnpm test` passed, the receipt and operation
record scripts passed `node --check`, and the final `pnpm bootstrap:wait`
reported `included-success`. Foundry is not installed in the current workspace,
so Solidity tests could not be rerun; the earlier handoff records 12 passing
Solidity tests with Foundry 1.8.3. The final sponsored operation, receipt, and
post-inclusion live state are recorded in `docs/verification.md`. A tunneled
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
