# Convey architecture

Status: selected architecture; OKBund build and NodeFlare runtime checks pass.
The account-abstraction transaction proof and one sender-funded product claim
passed on X Layer mainnet. The registry, single-gift escrow, claim paymaster,
persistent private gateway, and browser-facing edge are deployed. The minimal
multi-claim Drop escrow is implemented and locally tested but is not deployed.
A browser claim by a new recipient and the on-chain recurring authorization are
proven on mainnet, and the receiver flow is completed on a physical device. A
direct withdrawal proof and Drop integration remain ahead.

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
- **Returning receiver:** on a same-device revisit to a live claimed gift, the
  browser re-derives the deterministic account from the persisted owner address
  through the factory, then requires a fresh passkey unlock before enabling
  gasless exit actions. The live escrow state, not a local flag, gates the
  resume path.
- **Recurring gift authorization:** use a narrowly scoped, expiring OKX wallet
  owner/hook only after the exact permissions and revocation behavior pass
  live integration tests. The local [`ConveyRecurringGiftHook`](../contracts/recurring/ConveyRecurringGiftHook.sol)
  records the bounded policy and is proven on mainnet with a disposable
  wallet. Do not imply ERC-7579 module portability.
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
- **DropEscrow:** the local minimal implementation pre-funds every slot. A
  permissionless claim releases exactly one share, records the account address
  as used, and rejects a second claim from that address. After expiry, the
  sender can recover only unclaimed shares. It has no deployed address or
  anti-bot/allowlist policy yet; see [`drop-design.md`](drop-design.md).
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

The browser receiver obtains issuer price and multiplier observations through an
allowlisted same-origin server proxy. The proxy maps live wrapper symbols to
issuer API symbols and does not expose operator credentials; this avoids
depending on issuer CORS behavior in the browser.

The account path, a real sender-funded claim, and an operator gasless cash-out
have passed on mainnet. The registry, `GiftEscrow`, local `DropEscrow`, local
recurring hook, claim-paymaster, and exit-paymaster tests are checked in. The
Codespace does not have Foundry installed; the supplied Lightsail host compiled
and ran the current 47-test Solidity suite. The deployed-edge
virtual-authenticator capability proof is recorded in `docs/verification.md`;
persistent receiver browser enrollment/recovery, direct withdrawal proof, Drop
deployment/integration, and recurring-wallet live proof remain product work.
