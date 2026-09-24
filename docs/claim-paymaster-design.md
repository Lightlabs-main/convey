# Product claim paymaster design

Status: deployed and funded on X Layer mainnet. The bootstrap paymaster that
passed the X Layer account gate is not reused for claims. Gift ID `2` completed
a live private claim with reserve settlement; the deployment, funding, and
claim evidence are recorded in [`docs/verification.md`](verification.md).

## Boundary

The claim paymaster sponsors one receiver UserOperation at a time through
Convey's private gateway and OKBund. It accepts only the selected OKX account's
single zero-value call to the configured `GiftEscrow.claim` selector. The
escrow still verifies the secret and code, and releases the asset only to the
account that supplied the operation.

The sender funds the receiver's claim allowance in native OKB while creating a
gift. That allowance is deposited into the paymaster's EntryPoint deposit and
assigned to the gift ID. The claim path never swaps a gift token for gas.

## Reserve state

Each gift has one reserve record in the claim paymaster:

```text
Open:      remaining = sender-funded allowance, inFlight = false, closed = false
Reserved:  validation has checked maxCost and subtracted it, inFlight = true
Settled:   postOp has charged actualGasCost and cleared inFlight
Closed:    escrow marked the gift Claimed or Reclaimed; all remaining reserve
           is refundable after the current operation settles
```

`reserveGift` is callable only by the escrow, accepts the sender's native
value, deposits it into EntryPoint, and records the sender as the refund
recipient. A second reservation for the same gift ID is rejected. The reserve
must meet the paymaster's configured maximum claim cost; the sender cannot
create a gift whose claim allowance is known to be too small.

`releaseForReclaim` is callable only by the escrow after an open gift is
reclaimed. It requires `inFlight == false`, deletes the reserve, and returns the
remaining allowance to the sender through the EntryPoint withdrawal path.

## UserOperation validation

The paymaster data binds the gift ID, sponsor nonce, validity window, and an
operator signature. The signature binds the EntryPoint v0.7 address, chain
196, paymaster address, the operation fields that exclude the signature, and
the EntryPoint-provided `maxCost`. The full ERC-4337 UserOperation hash cannot
be signed here because it contains the signature being created. The
operation-fields hash still binds the sender, nonce, init code, claim calldata,
account gas fields, and fee fields.

Validation checks all of the following before returning:

1. The caller is the canonical X Layer EntryPoint.
2. The encoded paymaster address matches this contract, and its gas limits are
   covered by the sponsor signature.
3. The operation's call data is exactly one OKX `executeUserOp` call.
4. The call has zero value, targets this escrow, and invokes `claim`.
5. The encoded gift ID has an open reserve with enough remaining allowance.
6. The sponsor signature and validity window are valid.
7. The gift has no operation already in flight.

Validation marks that gift's reserve in flight and subtracts the full
`maxCost`. This is the pre-execution charge required by the drain-safety rule;
the paymaster does not depend on a post-execution token pull succeeding to stay
solvent. A second UserOperation for the same gift in one bundle sees the
in-flight marker and is rejected.

## `postOp` reconciliation

`postOp` is EntryPoint-only and receives the gift ID, pre-charged `maxCost`, and
the actual gas cost. It clears `inFlight`. If actual cost is lower than the
pre-charge, the difference is returned to the sender. If actual cost is higher,
the paymaster absorbs the overrun from its operational buffer; the claim does
not fail because of a token price move or a small gas variance.

When the escrow has marked the gift closed, the remaining reserve is returned
as well. When execution failed and the gift is still open, the remaining
allowance stays attached to the gift so the sender can reclaim it or retry.
Settlement is idempotent: a missing reserve, a cleared in-flight marker, or a
second close is rejected without moving funds.

Refund delivery must not make `postOp` fail. The implementation will attempt an
EntryPoint withdrawal and, if the withdrawal path is temporarily unavailable,
record a bounded pending refund that the sender can withdraw later. The
paymaster owner may withdraw only EntryPoint balance above the sum of all open
reserves and may never withdraw a gift's locked allowance.

## Escrow calls and ordering

The escrow will call `reserveGift` during `createGift`, before the create
transaction completes, so a successful gift always has a locked claim
allowance. On a successful claim it marks the reserve closed after the asset
transfer. On sender reclaim it calls `releaseForReclaim`. Any failure in those
callbacks reverts the enclosing escrow operation and leaves the gift and
reserve unchanged.

The escrow does not trust a recipient supplied by the relayer. The claim
recipient remains `msg.sender`, and the relayer policy separately rejects any
UserOperation whose target or call envelope is outside this scope.

## Required tests before funding

- reserve creation is escrow-only and cannot be duplicated;
- validation rejects another EntryPoint, another paymaster, wrong target,
  wrong selector, nonzero call value, wrong gift, insufficient reserve, expired
  authorization, and a bad sponsor signature;
- full `maxCost` is reserved before execution;
- a successful claim refunds `maxCost - actualGasCost` and the unused remainder;
- an execution failure charges actual gas but leaves the gift reclaimable;
- a sender reclaim releases the remaining reserve exactly once;
- a duplicate UserOperation cannot reserve or settle the same gift twice;
- an overrun is absorbed without making the claim revert;
- owner withdrawal cannot consume any open gift reserve;
- EntryPoint deposit and stake remain above the configured operational floor.

The local tests, deployment, paymaster funding, and one private gasless claim
are complete. Product release remains gated on the durable gateway, browser
receiver flow, cash-out/withdrawal paths, and operational monitoring.
