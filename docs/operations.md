# Convey operations

The operator checks the live claim and exit paymaster paths before enabling
traffic. The check is read-only: it verifies X Layer chain `196`, EntryPoint
bytecode, OKBund support, both paymaster deposit/stake floors, and optionally
the public bundler-wallet balance. It never reads or prints a private key.

## Read-only check

Set these optional public monitoring values in the server environment:

```text
CONVEY_EXIT_MIN_DEPOSIT_WEI=<exit EntryPoint deposit floor>
CONVEY_EXIT_MIN_STAKE_WEI=<exit EntryPoint stake floor>
CONVEY_BUNDLER_PUBLIC_ADDRESS=<OKBund wallet address>
CONVEY_BUNDLER_MIN_BALANCE_WEI=<minimum OKB balance>
```

The command needs the same server-only `XLAYER_RPC_URL` and `BUNDLER_RPC_URL`
used by the gateway:

```sh
pnpm ops:check
```

It prints JSON suitable for journald or an external log collector. A failed
floor or unavailable endpoint exits non-zero. The optional `convey-ops-check`
systemd service and timer run the same command every five minutes when
installed on the supplied VPS; they are intentionally separate from the
gateway and do not restart it.

Install the checked-in units only on the supplied operator host:

```sh
sudo install -o root -g root -m 0644 infra/relayer/convey-ops-check.service /etc/systemd/system/
sudo install -o root -g root -m 0644 infra/relayer/convey-ops-check.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now convey-ops-check.timer
sudo systemctl start convey-ops-check.service
```

The live supplied-host installation passed its first check on 2026-09-25;
the evidence and observed balances are in [`docs/verification.md`](verification.md).

## Guarded top-up

`script/topup-paymasters.ts` computes the shortfall from live EntryPoint state
and is a dry-run by default:

```sh
CONVEY_TOPUP_TARGET=both pnpm ops:topup
```

For an intentional X Layer write, review the printed plan and then provide
both confirmations:

```sh
CONVEY_TOPUP_TARGET=claim \
CONVEY_TOPUP_CONFIRM=I_UNDERSTAND_MAINNET_WRITE \
pnpm ops:topup -- --confirm
```

The script checks chain, paymaster owner, canonical EntryPoint, and live
deposit/stake state before sending only the required shortfall. It waits for
successful receipts and prints only public addresses, amounts, and hashes.
It uses `DEPLOYER_PRIVATE_KEY`; never put a signer or RPC credential in a
browser environment, service log, or documentation.

The existing `pnpm product:fund` and `pnpm exit:fund` commands remain available
for their component-specific deployment runbooks. The guarded command is the
recommended repeatable top-up path after monitoring detects a floor breach.

## Direct gasless withdrawal

The receiver UI and SDK support a single ERC-20 transfer from the smart account
through the separate exit paymaster. The operator proof is deliberately
guarded because it moves live assets to an operator-supplied destination. A
dry-run requires a live base-unit amount and destination but does not submit:

```sh
WITHDRAWAL_TOKEN=0x779ded0c9e1022225f8e0630b35a9b54be713736 \
WITHDRAWAL_RECIPIENT=<destination address> \
WITHDRAWAL_AMOUNT=<base-unit amount> \
pnpm withdraw:submit
```

Submitting requires both `--confirm` and
`CONVEY_WITHDRAW_CONFIRM=I_UNDERSTAND_MAINNET_WRITE`. The script refuses the
receiver account as destination, checks the live balance, estimates through the
private route, and reports the mined UserOperation status.

The latest live dry-run completed at `2026-09-25T11:56:19.202Z` against the
receiver's full USDT0 balance. It completed authorization and estimation with
writes disabled; see [`docs/verification.md`](verification.md). This is
preparation evidence, not proof of a mined withdrawal.

---

# Operator reference (moved from README)

## Local setup

Install dependencies and create a private local environment file:

```sh
pnpm install
cp .env.example .env
chmod 600 .env
```

Populate only the values required for the command being run. The environment
file contains placeholders for chain configuration, private execution and
bundler endpoints, deployed contract addresses, paymaster policy, and operator
keys. Do not commit `.env`.

The minimum public network invariants are:

```text
XLAYER_CHAIN_ID=196
ENTRYPOINT_ADDRESS=0x0000000071727de22e5e9d8baf0edac6f37da032
OKX_SMART_WALLET_FACTORY=0xdd3fea01cd550c9effc893f346690b9a649f35ef
OKX_SMART_WALLET_IMPLEMENTATION=0xe40ccb2d94975c51bff0c004efdfd9b3a5796fa4
```

Use a keyed NodeFlare endpoint through `NODEFLARE_API_KEY`, or set
`BUNDLER_EXECUTION_RPC_URL` to another private X Layer execution RPC that
passes both tracer and state-override capability checks. `BUNDLER_RPC_URL` is
the private OKBund endpoint and must never be exposed to browser code.

## Commands

### Read-only checks

```sh
pnpm test
pnpm verify
pnpm verify:bundler-rpc
pnpm account:inspect
pnpm account:owner-check
pnpm operator:addresses
pnpm scripts:typecheck
pnpm scripts:syntax
pnpm bundler:check
pnpm relayer:check
pnpm ops:check
CONVEY_TOPUP_TARGET=claim pnpm ops:topup
```

`pnpm verify` uses the documented pinned X Layer block and writes raw evidence
under `docs/`. `pnpm verify:bundler-rpc` redacts credential-bearing RPC paths.
The account and operator commands derive public addresses without printing
private keys.

`pnpm account:owner-check` is read-only and verifies the live OKX owner list and
validator settings for the configured receiver.

`pnpm ops:check` is the recommended recurring health check. `pnpm ops:topup`
prints a live shortfall plan without writing by default; see
[`docs/operations.md`](docs/operations.md) for the explicit confirmation
required to fund a paymaster.

### Build and contract tests

```sh
pnpm contracts:build
pnpm contracts:test
```

Foundry is not installed in the Codespace used for this handoff. The supplied
Lightsail host has Foundry 1.8.3 and has run the expanded Solidity suite
successfully. Local Solidity tests use a controlled EntryPoint stub for some
cases; they are not a third-party audit or a substitute for live mainnet
verification.

### Bootstrap account gate

These commands can send mainnet transactions when run with a funded operator
environment:

```sh
pnpm bootstrap:deploy
pnpm bootstrap:fund
pnpm bootstrap:build
pnpm bootstrap:submit
pnpm bootstrap:wait
```

The bootstrap path is one-use and separate from product claim sponsorship.
Operation files are written under `/tmp` with mode `0600`, reject symlinks, and
must never be committed.

### Product deployment and registry

```sh
pnpm product:deploy
pnpm product:fund
pnpm product:register-assets
```

These commands can deploy, fund, bind, or register contracts on X Layer. Use
only after reviewing the live configuration and intended transaction scope.

### Drop and recurring-hook deployment preparation

```sh
pnpm drop:deploy
pnpm recurring:deploy
```

Both commands validate the live X Layer chain, deployed dependencies, and
source-matched Foundry artifacts, then print a dry-run plan. They send a
transaction only when invoked with `--confirm` and the matching exact
confirmation environment variable. The recurring-hook path is restricted to a
disposable or already multi-owner OKX wallet; neither command has been used to
deploy a new contract yet.

### Gateway

```sh
pnpm relayer:serve
```

The default bind address is loopback. The persistent private service is deployed
on the supplied VPS with authentication, a capacity check, and the private
OKBund endpoint. The web app is available at
[https://conveyapp.site](https://conveyapp.site);
it uses a same-origin server proxy to reach the private gateway. No public
gateway endpoint is exposed.


## Live verification record

### Account-abstraction gate

The successful bootstrap operation deployed the selected receiver account:

- UserOperation:
  `0x1361ecee72221c81ee911f1446e3531e6086ffa9b2bee87bec22cd0ecc7f413c`
- bundle transaction:
  `0xfdb3ef41083b02282a304c948194b1ec9dca42d14f5fec258b8a12c2e7b4df09`
- block: `71422410`
- receipt: `success = true`

This proves the selected account path and bootstrap sponsor gate. It does not
prove product claim reserve accounting or receiver recovery.

### Sender-funded asset setup

The sender acquired `0.030965586663211895` NVDAx from `7` USDT0 through the
verified X Layer route. The live approval, swap, escrow approval, and gift
creation receipts are recorded in [`docs/verification.md`](docs/verification.md)
and [`HANDOFF.md`](HANDOFF.md). Gift creation included the configured native
claim reserve, and escrow held the exact asset amount under its accounting.

The private relay and event-aware preflight are now proven by the successful
Gift ID `2` claim. The receiver application is now connected to this path and
deployed at the public HTTPS web edge. The virtual-authenticator PRF capability
proof is recorded in [`docs/verification.md`](docs/verification.md), but a
browser-to-browser mainnet claim is not yet recorded.


## Security and operating rules

- Never use mock prices, balances, sponsorship, claims, or transaction hashes
  in verification records.
- Generate a fresh claim key for every gift; never reuse claim keys. The
  link secret signs a claimer-bound digest and is never sent on chain.
- Never print or commit private keys, RPC credentials, SSH keys, or secret
  claim files.
- Keep receiver owner, deployer, paymaster signer, bundler, and SSH roles
  separate.
- Keep `BUNDLER_RPC_URL` and execution RPC credentials server-side.
- Do not call the OKX account ERC-7579; the inspected implementation is
  modular ERC-4337 v0.7 without ERC-7579 support.
- Do not reuse the bootstrap paymaster for product claims.
- Treat all deployment, funding, registration, gift creation, reclaim, and
  claim commands as potentially state-changing; verify target, amount, nonce,
  and live receipt before proceeding.
- A successful outer EntryPoint transaction is not proof of a successful inner
  UserOperation. Inspect `UserOperationEvent.success` and the revert event.

