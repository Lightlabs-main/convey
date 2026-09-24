# Convey architecture

Status: selected architecture; OKBund build and NodeFlare runtime checks pass.
The account-abstraction transaction proof and one sender-funded product claim
passed on X Layer mainnet. The registry, single-gift escrow, and claim
paymaster are deployed and funded; the durable gateway, receiver application,
multi-claim drops, and recurring authorization remain ahead.

## Accounts and claim routing

- **Sender:** connect an existing wallet with standard wallet-connect. The
  sender signs gift creation and funds the gift and its claim allowance.
- **Receiver:** arrive with no prior wallet, gas, or account. The claim is
  gasless: a device-local
  credential authorizes the receiver owner key; the claim UserOperation uses
  the counterfactual ERC-4337 account path when deployment is needed, binds the
  claim to that account, and reaches the escrow through Convey's private relay
  and bundler.
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

- **Sponsorship bootstrap:** use an operator-funded, narrowly scoped Convey
  infrastructure paymaster for the first sponsored operation through the
  private OKBund endpoint. Its signer,
  operation limits, and open invariants are recorded in
  [`aa-gate-design.md`](aa-gate-design.md). This one-operation proof is separate
  from the sender-funded claim-gas reserve required by the product, so the
  receiver never supplies native gas.

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
- **Claim gas reserve/paymaster:** `ConveyClaimPaymasterV07` now implements the
  sender-funded OKB reserve for product claims. It reserves the maximum cost
  before execution, reconciles actual cost in `postOp`, rejects duplicate
  in-flight claims, and keeps owner withdrawals above all open reserves. It is
  deployed and staked on X Layer with a funded EntryPoint deposit. Claim
  execution never swaps a token to OKB.

## Valuation and cash-out

The registry selects the valuation method. For wrapped xStocks, wrapper
conversion supplies underlying units only; an independent underlying price
supplies display value. Cash-out quotes come from a live executable route.
The verified TSLA route is too thin at the recorded sizes, so TSLA must be
hold-only unless a fresh live quote passes policy.

The account path and a real sender-funded claim have passed on mainnet. The
registry, `GiftEscrow`, and claim-paymaster tests are checked in. The Codespace
does not have Foundry installed; the supplied Lightsail host compiled and ran
the suite. The receiver browser flow, durable gateway, cash-out, withdrawal,
and recovery integration remain product work.
