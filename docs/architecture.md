# Ticker architecture proposal

Status: proposal only. The verification gate in
[`verification.md`](verification.md) is still open, so no product contracts are
implemented.

## Accounts and claim routing

- **Sender:** connect an existing wallet with standard wallet-connect. The
  sender signs gift creation and funds the gift and its claim allowance.
- **Receiver:** use a counterfactual ERC-4337 account. The claim UserOperation
  deploys it, binds the claim to that account, and reaches the escrow through
  Ticker's private relay and bundler.
- **Current account candidate:** the deployed OKX Smart Wallet factory and
  implementation use EntryPoint v0.7, but the inspected implementation does
  not implement ERC-7579. It cannot be described as OKX-native ERC-7579. A
  verified ERC-7579-compatible factory/account must be selected to meet that
  requirement, or the requirement must be changed before implementation.
- The escrow receives the claim from the account itself (`msg.sender`) and
  transfers only to that account. It has no arbitrary recipient parameter.
  The relay accepts only the configured escrow's claim selector and never
  falls back to public transaction submission.

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

The contracts, paymaster, and account path remain unimplemented until the
account-abstraction transaction gate passes. Contract invariants and tests must
be written before the escrow implementation begins.
