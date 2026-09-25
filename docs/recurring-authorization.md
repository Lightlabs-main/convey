# OKX-specific recurring authorization

Status: the local policy hook and five invariant tests are implemented, but no
hook is deployed and no recurring owner has been attached to the live receiver.
The deployed receiver currently has one owner, so it must not be modified for
this proof.

## Wallet-specific model

The pinned OKX Smart Wallet uses owner settings rather than an ERC-7579 module
interface. `OwnerManager.packSettings` packs an admin flag, a `uint40`
expiration, and a hook address. The wallet looks up those settings for the
owner key used by the signed operation, calls that hook's `preCheck` before the
batched calls, then calls `postCheck` afterward. A non-admin owner cannot make
a self-call; the primary admin must perform owner management through a wallet
self-call.

Sources inspected at the pinned OKX revision:

- [`OwnerManager.sol`](https://github.com/okxlabs/okx-smart-wallet-evm/blob/95aa59bbc22acd4573a9932e959384fe56c7b543/src/OwnerManager.sol)
  defines owner settings, expiry, `addOwner`, `updateOwner`, and
  `removeOwner`.
- [`SmartWallet.sol`](https://github.com/okxlabs/okx-smart-wallet-evm/blob/95aa59bbc22acd4573a9932e959384fe56c7b543/src/SmartWallet.sol)
  invokes the hook around `_batchCall` and rejects self-calls for non-admin
  owners.
- The ABI-compatible [`IHook`](https://github.com/okxlabs/okx-smart-wallet-evm/blob/95aa59bbc22acd4573a9932e959384fe56c7b543/src/interfaces/IHook.sol)
  callback receives the full `Call[]` and the executor address.

## Convey policy

[`ConveyRecurringGiftHook.sol`](../contracts/recurring/ConveyRecurringGiftHook.sol)
is immutable and bound to one wallet, one registered asset, and one deployed
`GiftEscrow`. It permits exactly one call per execution:

1. the target must be the configured `GiftEscrow`;
2. the selector must be `createGift(address,uint256,address,bytes32,uint64,bytes32)`;
3. the native claim reserve must be nonzero and no larger than
   `maxReserveWei`;
4. the asset must match policy and the claim key must be nonzero;
5. the gift amount must be no larger than `maxGiftAmount` and the cumulative
   amount must remain within `totalBudget`; and
6. the gift expiry must be in the future and strictly before the recurring
   owner's `expiresAt`.

The hook increments its token budget in `preCheck`. If the wallet execution or
the target gift creation reverts, the enclosing transaction reverts and the
budget reservation rolls back. The hook has no pause or administrative escape
hatch; revocation is deliberately the primary admin's wallet self-call.

The intended disposable-wallet setup is:

1. deploy the hook with the disposable wallet, GiftEscrow, allowlisted asset,
   per-gift cap, native reserve cap, total token budget, and short expiration;
2. have the current admin add a secondary ECDSA owner with
   `packSettings(false, expiresAt, hook)` and separately approve the bounded
   asset allowance to GiftEscrow;
3. submit recurring operations signed by that secondary key through the normal
   Convey/OKBund path; and
4. have the primary admin revoke the secondary key with a wallet self-call,
   then verify that further operations fail. Expiration is an independent
   automatic boundary and should be tested at the exact timestamp.

`pnpm recurring:deploy` is the guarded hook deployment path. It requires the
live GiftEscrow, registry, and certified/enabled asset, checks the expiration
against the current chain timestamp, and validates a source-matched Foundry
artifact. It is dry-run by default and sends only with both `--confirm` and
`CONVEY_RECURRING_HOOK_CONFIRM=I_UNDERSTAND_MAINNET_WRITE`. The configured
wallet is intentionally explicit and must be disposable or already multi-owner;
the script does not attach a hook or change owner state. No live hook has been
deployed.

This policy does not claim that an owner key represents a person, device, or
human-level recurrence guarantee. It also does not make Drop claims gasless;
the operation's native reserve still has to satisfy the deployed claim
paymaster policy.

## Local evidence and live gate

The five local tests cover allowed execution, wrong target/asset/selector and
batch shape, reserve/cap/budget/expiry bounds, rollback after an execution
revert, and wallet-only callbacks. They compile against Solidity `0.8.23` as
part of the current 47-test Foundry suite.

Live proof remains open. It requires a disposable or already multi-owner OKX
wallet, a deployed hook, an explicit secondary-owner authorization, a live
bounded gift operation, an out-of-bounds rejection, expiry behavior, and a
mined primary-admin revocation followed by a failed replay. No such state
change was attempted on Convey's sole-owner receiver.
