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
- Selected the deployed OKX Smart Wallet as the account path. Convey will describe it accurately as an OKX-specific modular ERC-4337 v0.7 account, not ERC-7579.
- Adopted Convey as the product name across repository metadata and documentation.
- Added local and example environment configuration for the verified EntryPoint, OKX factory, bundler, paymaster, and dedicated operator keys.
- Implemented `pnpm account:inspect` from the official OKX factory ABI. It derives the dedicated owner's counterfactual account without logging the private key and confirms EntryPoint/factory state on chain.
- Derived counterfactual OKX account `0x6B17C1b2663f8fBecd97D038DfC81712e99a54ca`; mainnet bytecode is currently absent, as expected before the first sponsored UserOperation.

## Next

- Select and configure a production bundler/paymaster/account factory.
- Validate a chain-196 bundler/paymaster endpoint against EntryPoint v0.7 and the deployed OKX wallet factory.
- Submit one real sponsored smart-account deployment on X Layer mainnet and record its UserOperation and transaction hash.
- Verify session keys, private claim routing, pre-charge-max plus `postOp` refund, ERC-20 sender payment, deposit, and stake behavior against the selected provider and contracts.
- Sample gas price over time and record variance.

## Blocked

- Provider credentials and a funded mainnet sponsor/deployer are unavailable in the workspace.
- Hosted provider credentials/endpoints still need to be supplied and tested. Particle's published bundler documentation currently states EntryPoint v0.6-only support, which is incompatible with the selected OKX v0.7 account until the live endpoint proves otherwise.
- Per the verification gate, contracts and product layers are intentionally not started.

## Verification results

Run `pnpm verify`. See `docs/verification.md` and generated `docs/verification.raw.json`.
