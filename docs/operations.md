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
