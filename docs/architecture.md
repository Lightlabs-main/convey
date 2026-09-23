# Ticker architecture

Status: selected architecture; OKBund build and read-only NodeFlare runtime
checks pass. The account-abstraction transaction proof remains the gate. No
product contracts are implemented.

## Accounts and claim routing

- **Sender:** connect an existing wallet with standard wallet-connect. The
  sender signs gift creation and funds the gift and its claim allowance.
- **Receiver:** use a counterfactual ERC-4337 account. The claim UserOperation
  deploys it, binds the claim to that account, and reaches the escrow through
  Ticker's private relay and bundler.
- **Receiver account:** use the deployed OKX Smart Wallet factory and
  implementation with EntryPoint v0.7. Describe it as OKX's custom modular
  ERC-4337 account; do not call it ERC-7579. This is the account choice
  explicitly allowed by the specification's account-standard resolution.
- **Recurring gift authorization:** use a narrowly scoped, expiring OKX wallet
  owner/hook only after the exact permissions and revocation behavior pass
  live integration tests. Do not imply ERC-7579 module portability.
- The escrow receives the claim from the account itself (`msg.sender`) and
  transfers only to that account. It has no arbitrary recipient parameter.
  The relay accepts only the configured escrow's claim selector and never
  falls back to public transaction submission.

- **Sponsorship bootstrap:** test Particle's published X Layer paymaster against
  this exact OKX v0.7 account, while retaining Ticker's private OKBund for
  submission. This separates sponsor authorization from claim routing. The
  provider is accepted only after it returns v0.7 paymaster data and one real
  operation is included by the private bundler; see
  [`aa-provider-research.md`](aa-provider-research.md).
- If the provider cannot sponsor this account/version, the next design review
  is an infrastructure-only Ticker verifying paymaster before GiftEscrow work.
  That would require an explicit exception to the specification's
  no-contract-before-gate order; no product escrow should be started to hide
  that dependency.

## Contracts

- **AssetRegistry:** one entry per token, with kind, decimals, wrapper and
  underlying identity, valuation source, cash-out route, certification,
  enablement, and disclosure tag. Governance can register or disable entries;
  gift creation reads and requires both `certified` and `enabled`.
- **GiftEscrow:** token-agnostic custody with immutable sender, token amount,
  secret hash, optional code hash, expiry, and one-way `Open → Claimed` or
  `Open → Reclaimed` state. Only the sender can reclaim an open gift. The
  contract stores no claim secret and has no administrative withdrawal path.
- **DropEscrow:** pre-funds every slot. A claim releases exactly one share,
  records the account address as used, and rejects a second claim from that
  address. After expiry, the sender can recover only unclaimed shares.
- **Claim gas reserve/paymaster:** hold claim gas in OKB before a gift can be
  claimed. Validation reserves the maximum cost before execution; `postOp`
  returns unused value. Claim execution never swaps a token to OKB. Exact
  storage, failure handling, and EntryPoint accounting remain subject to
  implementation review and tests.

## Valuation and cash-out

The registry selects the valuation method. For wrapped xStocks, wrapper
conversion supplies underlying units only; an independent underlying price
supplies display value. Cash-out quotes come from a live executable route.
The verified TSLA route is too thin at the recorded sizes, so TSLA must be
hold-only unless a fresh live quote passes policy.

The product contracts and account path remain unimplemented until the
account-abstraction transaction gate passes. Contract invariants and tests must
be written before the escrow implementation begins.
