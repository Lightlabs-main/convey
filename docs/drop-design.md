# Drop escrow design

Status: the minimal one-claim-per-wallet escrow is implemented in
[`contracts/core/DropEscrow.sol`](../contracts/core/DropEscrow.sol) and covered
by four Solidity invariant tests. It has not been deployed to X Layer, wired
into the sender/receiver UI, or exercised through the private gateway.

## Contract boundary

`DropEscrow` is a separate token custody contract for public multi-claim
distributions:

- `createDrop` accepts only a certified and enabled registry asset, requires a
  positive `slotAmount` and `slotCount`, requires a future expiry, and pulls
  exactly `slotAmount * slotCount` tokens before recording the drop;
- `claim` releases exactly one slot to `msg.sender` and records that address in
  `claimedBy[dropId][account]`; a second claim from the same account is
  rejected, and the contract never uses `tx.origin`;
- claims are permissionless until expiry, so a product UI must not describe a
  drop link as a private bearer secret or rely on it for anti-bot protection;
  any access, rate, or allowlist policy must be specified separately before
  deployment; and
- after expiry, only the sender can reclaim the unclaimed slots. Claimed slots
  cannot be reclaimed, and the exact-transfer checks reject fee-on-transfer or
  otherwise mismatched token behavior.

The account address is the invariant's identity. An EOA and an ERC-4337 smart
account are distinct addresses, while repeated calls from the same smart
account are rejected. This is the intended one-claim-per-wallet interpretation
and is not a proof of one claim per human or device.

The contract deliberately does not add a claim secret, native gas reserve, or
paymaster binding yet. Those choices need to be integrated with the product's
private relay and sender-funded gas policy before a live deployment. The sender
can reclaim only the remaining pre-funded amount, and only after the recorded
expiry.

## Verification

The supplied Lightsail host compiled the current Solidity sources with
Solidity `0.8.23` and ran the complete Foundry suite: `47` tests passed, `0`
failed. The four Drop-specific tests cover full pre-funding and exact slot
delivery, duplicate-account rejection, expiry and partial reclaim, early
reclaim rejection, and invalid creation inputs. This is local contract
evidence only; no Drop deployment or mainnet transaction was made.

`pnpm drop:deploy` is now the guarded deployment path. It validates chain 196,
the live registry and its owner, and a source-matched Foundry artifact before
printing a dry-run plan. It sends only when both `--confirm` and
`CONVEY_DROP_CONFIRM=I_UNDERSTAND_MAINNET_WRITE` are present, and it reads the
registry back from the deployed address. No Drop deployment has been made.

Before using that path, integrate the sender/receiver flow, decide whether
claims need an allowlist or other anti-bot control, review the native gas
policy, and add a live verification record for the deployed address and one
complete claim/reclaim lifecycle.
