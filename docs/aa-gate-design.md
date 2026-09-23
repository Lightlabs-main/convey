# Account and sponsorship gate design

Status: the bootstrap paymaster and local build/deploy/sponsor tooling are
implemented, received an in-house source review, and were exercised through a
successful sponsored mainnet UserOperation. The paymaster is deployed and
funded on X Layer; the implementation has not received a third-party audit.
This design covers only the first account deployment. Product escrow work may
now proceed under its separate claim-paymaster and reserve design.

## Receiver account and signer

- Use the deployed OKX Smart Wallet at ERC-4337 EntryPoint v0.7. Its ECDSA
  validator is the account owner path; the owner is a secp256k1 EOA whose
  `keyHash` is `keccak256(ownerAddress)`. The wallet is modular but is not an
  ERC-7579 account.
- Give each receiver a dedicated owner key generated on the receiver's device.
  The client signs the OKX owner envelope locally; the Convey gateway, gift
  sender, and sponsor service never receive the private key.
- Proposed storage: encrypt the owner key with AES-GCM under a key derived
  from a WebAuthn PRF credential, and keep the ciphertext in the receiver's
  local vault. Require a PRF-capable passkey before creating or unlocking this
  account. The browser support, enrollment, device migration, recovery, and
  account-owner revocation paths still need implementation-specific proof.
- The operator has provisioned the intended receiver owner's
  `SMART_ACCOUNT_OWNER_PRIVATE_KEY` for the bootstrap account. Keep it separate
  from the bundler, deployer, and paymaster signer keys. This does not prove
  passkey PRF storage, device migration, or recovery.
- Until a supported recovery path is proven, losing the receiver key means
  losing control of the deployed account. Do not imply that email recovery or
  a passkey by itself can recover an OKX ECDSA owner.

## One-operation bootstrap sponsor

Deploy a dedicated, minimal ERC-4337 v0.7 verifying paymaster for the gate
operation. Do not reuse it for product claims. Fund its EntryPoint deposit from
the operator's OKB; it does not take ERC-20 payment or debit a gift reserve.

The gate operation is bound to the counterfactual account reported by
`pnpm account:inspect`, its exact OKX factory init code, and one account call:
`target = address(0)`, `value = 0`, `data = 0x`. The contract computes the
call-data hash internally from that exact OKX `executeUserOp` envelope; callers
cannot deploy it with an arbitrary call hash. The call has no gift secret and
no useful external effect. Submit it only to the configured private OKBund
endpoint. The existing claim gateway remains claim-only.

The signed sponsor authorization must bind all of these values:

- EIP-712 domain: chain ID 196 and this paymaster address; the nested operation
  hash binds the canonical v0.7 EntryPoint.
- The exact sender, EntryPoint nonce, init-code hash, and call-data hash.
- All packed account gas limits, pre-verification gas, fee fields, paymaster
  verification gas, and `postOp` gas limit.
- The EntryPoint-provided `maxCost`, a contract-bounded validity window, and a unique
  sponsor authorization nonce.

The bootstrap paymaster must enforce the operation policy on chain. A backend
signer alone is not an operation allowlist. Set a hard `maxCost` ceiling in the
contract and allow the bootstrap authorization only once. Fund only the
operator-approved exposure for that single operation. The paymaster signer
cannot rotate configuration or withdraw the EntryPoint deposit; keep those
administrative powers under a separate operator-controlled owner.

The bootstrap path uses native OKB sponsorship only. The contract uses a
one-use storage flag and returns an empty context, so it must be staked under
the selected bundler's safe-mode policy; `postOp` has no accounting and will
not be needed. EntryPoint charges actual gas against the paymaster's deposit.
This does not demonstrate an ERC-20 charge, a gift reserve, or a sender refund
in `postOp`.

## Local implementation and operator commands

- [`contracts/bootstrap/ConveyBootstrapPaymasterV07.sol`](../contracts/bootstrap/ConveyBootstrapPaymasterV07.sol)
  fixes chain 196, canonical EntryPoint v0.7, receiver, init-code hash, harmless
  call hash, sponsor nonce, paymaster verification gas, and a `maxCost` cap at
  deployment. Authorization binds account nonce and gas fields, paymaster gas
  fields, `maxCost`, validity bounds, chain, EntryPoint, and paymaster address.
- [`script/deploy-bootstrap-paymaster.ts`](../script/deploy-bootstrap-paymaster.ts)
  derives the receiver and factory init code from the local owner key, checks
  live chain/factory/EntryPoint state, pins the verified X Layer OKX factory
  and implementation, confirms the implementation reports the v0.7
  EntryPoint, derives the sponsor address from its dedicated signer key, and
  deploys with a separate deployer key.
- [`script/fund-bootstrap-paymaster.ts`](../script/fund-bootstrap-paymaster.ts)
  accepts explicit deposit and stake amounts and enforces the contract's
  deposit guard for funding through the paymaster. Anyone can deposit directly
  through EntryPoint, so this is not an absolute balance cap. Bootstrap tooling uses `BOOTSTRAP_PAYMASTER_ADDRESS`;
  `PAYMASTER_ADDRESS` remains reserved for the later claim relay paymaster.
- [`script/build-bootstrap-operation.ts`](../script/build-bootstrap-operation.ts)
  requires explicit gas and fee inputs, reads the live EntryPoint nonce,
  deployment, stake, and deposit, signs the one-operation authorization and
  OKX owner envelope, and writes the operation under `/tmp` with mode `0600`
  while refusing a symlink at the output path. It pins the verified factory
  and implementation and checks the implementation's live EntryPoint. It
  computes v0.7 `maxCost` as the EntryPoint does: the sum of account
  verification, account call, pre-verification, paymaster verification, and
  post-operation gas limits multiplied by `maxFeePerGas`. Those gas inputs must
  come from a live bundler estimate and operator-approved fee exposure; the
  script has no fallback values.
- [`script/submit-bootstrap-operation.ts`](../script/submit-bootstrap-operation.ts)
  checks chain 196 and the advertised v0.7 EntryPoint, then submits only to the
  distinct `BUNDLER_RPC_URL`, waits for its receipt, and reports the inclusion
  result and transaction hash. It has no public-bundler fallback.
- [`script/wait-bootstrap-operation.ts`](../script/wait-bootstrap-operation.ts)
  checks the saved operation's inclusion without resubmitting it.

`pnpm contracts:build`, `pnpm contracts:test`, `pnpm bootstrap:deploy`,
`pnpm bootstrap:fund`, `pnpm bootstrap:build`, `pnpm bootstrap:submit`, and
`pnpm bootstrap:wait` are the commands. The deploy, funding, and submit
commands send transactions when run. The mainnet deployment, funding/staking,
and sponsored UserOperation were run and are recorded in
[`docs/verification.md`](verification.md).
Never put operator private keys in chat; provision them through the operator's
secret manager.

## Product claim gas is a separate design

After the bootstrap operation succeeds, design a separate claim paymaster and
sender-funded OKB reserve. The claim policy must accept only one zero-value
call from the receiver account to the configured escrow and claim selector.
The secret stays in the signed claim calldata and the operation travels only
through Convey's gateway and private OKBund path.

Before implementation, specify how each gift's reserve covers the maximum
authorized cost, how a failed claim is charged, how actual cost is reconciled
after execution, and how unused reserve is released exactly once. Neither a
successful bootstrap operation nor a successful contract build proves those
rules.

## Local invariant tests before deployment

`pnpm contracts:test` runs 10 Foundry tests. The local EntryPoint stub models
the packed validity-window check so the expiry test covers the contract's
returned range; it is not a substitute for the deployed EntryPoint or a live
bundler simulation. The tests cover these properties:

1. Only the configured EntryPoint can call validation or post-operation hooks.
2. The signature is invalid on another chain, EntryPoint, or paymaster.
3. Expired, malformed, replayed, or wrong-nonce sponsor authorizations fail.
4. Wrong sender, factory init code, account call, nonzero value, or nonempty
   call data fail validation.
5. Gas fields and EntryPoint `maxCost` above the hard cap fail validation.
6. A valid authorization succeeds once and cannot sponsor a second operation.
7. An account operation that does not match the bootstrap policy cannot spend
   the paymaster deposit, even if it is signed by the receiver.

The later claim paymaster needs separate tests for reserve accounting, failed
execution, `postOp` accounting, duplicate settlement, concurrent reservations,
withdrawals, and the private gateway's target and selector checks. A build
alone is not evidence for these properties. The bootstrap paymaster and tests
remain unaudited. The successful sponsored operation is recorded separately as
live mainnet evidence; it does not prove claim reserve accounting or recovery.

## Source review

[Coinbase VerifyingPaymaster](https://github.com/coinbase/verifying-paymaster)
is a v0.7 reference, not the selected implementation. Its generic policy and
optional ERC-20 payment paths exceed the one-operation bootstrap needs. The
repository lists Base and Base Sepolia deployments; no X Layer deployment was
identified. A 2024 [Cantina review](https://cantina.xyz/portfolio/88b09402-6430-411e-80b0-857854fbe9f3)
is listed for `verifying-paymaster-v2`, but the reviewed revision has not been
matched to the repository revision inspected. The local Convey implementation
is in place and has passed the bootstrap gate, but it has not received an
independent security audit before any broader production reuse. Coinbase
remains a reference only.

## Local bootstrap review follow-up

A source review of the operator scripts found that the deployment and
operation-building paths trusted configured OKX factory and implementation
addresses as long as they had bytecode. They now require Convey's verified
X Layer addresses, and both paths check that the implementation reports the
canonical v0.7 EntryPoint. The operation file writer now refuses a symlink and
sets mode `0600` even when the destination already exists. These are local
fail-closed changes; they do not constitute a third-party audit. The subsequent
mainnet deployment and successful sponsored operation are recorded in
[`docs/verification.md`](verification.md).
