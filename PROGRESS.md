# Progress

## Done

- Created a reproducible, pinned-block X Layer verification script.
- Confirmed chain ID, gas floor observation, canonical EntryPoint bytecode, USDT0 metadata, xStocks V2 wrapper identity, `asset()` values, decimals, multipliers, and direct/two-hop Uniswap V3 pool and quote discovery.
- Classified NVDA and AAPL as clean at $5/$20/$50 at the pinned block; TSLA liquidity is too thin for honest cash-out and must be hold-only unless a fresh runtime quote passes policy.
- Documented the EVM/Token-2022 distinction.

## Next

- Select and configure a production bundler/paymaster/account factory.
- Submit one real sponsored smart-account deployment on X Layer mainnet and record its UserOperation and transaction hash.
- Verify session keys, private claim routing, pre-charge-max plus `postOp` refund, ERC-20 sender payment, deposit, and stake behavior against the selected provider and contracts.
- Sample gas price over time and record variance.

## Blocked

- Provider credentials and a funded mainnet sponsor/deployer are unavailable in the workspace.
- Per the verification gate, contracts and product layers are intentionally not started.

## Verification results

Run `pnpm verify`. See `docs/verification.md` and generated `docs/verification.raw.json`.
