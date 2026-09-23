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
- Selected the deployed OKX Smart Wallet as the account path. Ticker will describe it accurately as an OKX-specific modular ERC-4337 v0.7 account, not ERC-7579.
- Adopted Ticker as the product name across package metadata, SDK names, environment variables, and operator documentation.
- Added local and example environment configuration slots for the verified EntryPoint and OKX factory plus the self-hosted bundler/paymaster and dedicated operator keys.
- Implemented `pnpm account:inspect` from the official OKX factory ABI. It derives the dedicated owner's counterfactual account without logging the private key and confirms EntryPoint/factory state on chain.
- Derived counterfactual OKX account `0x6B17C1b2663f8fBecd97D038DfC81712e99a54ca`; mainnet bytecode is currently absent, as expected before the first sponsored UserOperation.
- Chose a self-hosted relay path rather than a hosted AA subscription and added the Ticker v0.7 UserOperation codec, private bundler client, claim-only relay gateway, live EntryPoint/paymaster health checks, escrow/function target allowlisting, a browser-safe SDK entry point, and pure serialization/security tests.
- Added the OKX v0.7 claim UserOperation builder. It reads live chain/account/nonce state, derives factory init code, encodes `executeUserOp`, and creates the exact owner signature envelope from the inspected OKX source. It requires caller-supplied gas and paymaster data; it does not fabricate sponsorship.
- Selected the operator-controlled OKX OKBund v0.7 source at pinned commit `77ac3770ba7dd4be949975b142623540e28f60e4`; its multi-module build completed locally with Java 21 and Maven.
- Added a live `pnpm verify:bundler-rpc` probe; the public X Layer RPC does not expose the tracing capabilities required for safe bundling, while the keyed NodeFlare endpoint now passes the required probes.
- Configured the capability probe to derive the keyed NodeFlare X Layer endpoint from the local `NODEFLARE_API_KEY`, while redacting credential-bearing RPC paths from logs and verification records.
- Verified the keyed NodeFlare endpoint on 2026-09-23: chain ID `196`, JavaScript-tracer `debug_traceCall`, and state-override `debug_traceCall` pass. `trace_call` is unsupported; the two required OKBund trace capabilities pass.
- Added a fail-closed OKBund launcher and an address-only operator credential check. The launcher refuses the upstream development-key fallback, wrong chain, wrong EntryPoint, disabled safe mode, or missing EIP-1559 configuration.

## Next

- Provision an existing sponsored UserOperation path for the verification gate and an operator-controlled v0.7 bundler; no bundler endpoint or paymaster path is configured. The proposed contract/account shape is in [`docs/architecture.md`](docs/architecture.md).
- Resolve the ERC-7579 account mismatch: the deployed OKX Smart Wallet candidate is EntryPoint v0.7 but does not implement ERC-7579.
- Install a dedicated `BUNDLER_PRIVATE_KEY` through a secret manager, derive its address with `pnpm operator:addresses`, and fund it with OKB for bundle transactions.
- Confirm whether the existing Lightsail host can run only the OKBund and relay processes (2 vCPUs, about 909 MiB RAM, 38 GB disk); NodeFlare removes the need to host an X Layer node.
- Submit one real gasless smart-account deployment and sponsored transaction on X Layer mainnet, then record the factory, UserOperation, and transaction hash.
- Connect the builder to the live Ticker paymaster sponsorship/estimation path and submit the first real claim UserOperation through the private gateway.
- Verify session keys, private claim routing, pre-charge-max plus `postOp` refund, ERC-20 sender payment, deposit, and stake behavior against the self-hosted deployment and contracts.
- Sample gas price over time and record variance.

## Blocked

- A private bundler endpoint, sponsoring paymaster path, funded paymaster deposit/stake, and bundler/deployer/paymaster operator credentials are unavailable in the workspace. The NodeFlare tracing gate is verified, but no bundler or paymaster operation has been deployed.
- The verified OKX account candidate does not meet the spec's ERC-7579 requirement. No alternative ERC-7579 account factory has been verified on X Layer.
- The supplied Lightsail instance is under-sized for an X Layer mainnet RPC node. NodeFlare removes the need to host a tracing node, but the available host has not been confirmed for production OKBund and relay workloads.
- The relay SDK and gateway are implemented, but a live endpoint is still required; the SDK does not substitute for a deployed bundler or paymaster.
- Per the verification gate, contracts and product layers are intentionally not started.

## Verification results

`pnpm test` passes after the Ticker rename, including RPC endpoint selection
and credential-redaction checks. `pnpm verify` passed against X Layer mainnet at
`2026-09-22T19:24:57Z` with the same pinned block; the baseline is in
`docs/verification.raw.json`. `pnpm verify:bundler-rpc` passed against the
keyed NodeFlare X Layer endpoint at `2026-09-23T04:32:18Z`; both required
`debug_traceCall` variants succeeded. The latest raw capability report is in
`docs/verification.rpc-capabilities.json`. `pnpm relayer:check` remains blocked
by the missing self-hosted bundler/paymaster configuration.
