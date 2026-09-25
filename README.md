# Convey

**Gift real stocks in one link, from you or your AI agent.** Convey gifts
tokenized xStocks (NVDAx, AAPLx, TSLAx) on X Layer. People send from OKX
Wallet. AI agents gift through Convey's MCP server, one-off or on a recurring
schedule, after the user approves.
The recipient opens the link, confirms with a passkey, and owns the stock in
their own OKX Smart Wallet. They don't need a wallet first, don't buy OKB, and
don't pay gas.

Gifts can also be **recurring**, for example a stock every month. The sender
approves a budget once, the **Convey Agent** delivers each gift on schedule,
and the sender's own OKX Smart Wallet enforces the budget on-chain.
This is proven on X Layer mainnet.

**Live:** [conveyapp.site](https://conveyapp.site) · **App:** [conveyapp.site/app](https://conveyapp.site/app) · **Chain:** X Layer mainnet (196)

**▶ Demo video (3 min):** [watch on X](https://x.com/convey_site/status/2103559739745398950). It covers the problem, the solution, and a real end-to-end gasless claim on X Layer mainnet.

---

## Why it matters

Tokenized stocks are programmable, but receiving one still means installing a
wallet, writing down a seed phrase, switching networks, and buying gas. That
barrier is highest for exactly the people you'd most want to give a first
share to.

Convey handles all of that at delivery time without taking custody. The asset
settles to the recipient's own ERC-4337 account, not to a Convey balance.

## Built for the OKX stack

| Layer | What Convey uses | How |
|---|---|---|
| **Chain** | X Layer mainnet | All contracts, gifts and claims settle on chain 196 |
| **Assets** | xStocks: NVDAx, AAPLx, TSLAx | Certified in Convey's on-chain `AssetRegistry`; live issuer prices |
| **Sender wallet** | OKX Wallet | EIP-6963 discovery (`com.okex.wallet`), with `window.okxwallet` as fallback; adds or switches to X Layer automatically; on phones, opens in the OKX Wallet app via deep link |
| **Receiver account** | OKX Smart Wallet (ERC-4337 v0.7) | Created from a device passkey; deployed on first claim |
| **Recurring budget** | OKX Smart Wallet owner hooks | The agent is a restricted owner; `ConveyRecurringGiftHook` enforces asset, caps, total budget and expiry inside the sender's wallet |
| **Bundler** | OKX OKBund (pinned) | Self-hosted, private; sponsored UserOperations only |
| **AI agents** | Convey MCP server | Agents list xStocks, check gifts, and send or reclaim gifts under a per-gift cap with user confirmation |

## How it works

```text
 Sender (OKX Wallet)                                  Recipient (any phone)
        │ createGift(xStock, amount, claimKey)                 │ opens link, passkey
        ▼                                                      ▼
 ┌──────────────┐   reserve OKB   ┌──────────────────┐   ┌─────────────────────┐
 │  GiftEscrow  │ ──────────────▶ │ Claim paymaster  │◀──│ Convey gateway      │
 │  holds xStock│                 │ sponsors gas     │   │ policy + preflight  │
 └──────┬───────┘                 └──────────────────┘   └──────────┬──────────┘
        │ claim(giftId, signature)                                  │ private
        ▼                                                           ▼
 OKX Smart Wallet  ◀────────── EntryPoint v0.7 ◀─────────────── OKBund
 (recipient owns the xStock)
```

1. **Send.** The sender picks an xStock in the app and confirms one escrow
   transaction in OKX Wallet. It includes a 0.00002 OKB claim reserve.
2. **Share.** The link carries a one-time claim key. Only that key's address
   goes on chain.
3. **Claim.** The recipient's passkey creates their OKX Smart Wallet. The
   claim is a sponsored UserOperation, and the sender's reserve pays the gas.
4. **Own.** The recipient can hold the xStock, cash out to USDT0 with a live
   quote, or move it anywhere. The exits are gasless too.

### Recurring gifts

```text
 Sender's OKX Smart Wallet
   ├─ admin owner (the sender): full control, can revoke the Convey Agent at any time
   └─ Convey Agent owner (restricted) ──▶ ConveyRecurringGiftHook checks every call:
                                     • target is GiftEscrow.createGift only
                                     • one xStock, ≤ cap per gift, ≤ total budget
                                     • native reserve ≤ cap, before expiry
```

1. **Approve once.** The sender sets the xStock, amount, schedule, recipient
   and total budget. The wallet adds the agent as a restricted owner bound to
   the hook, with a matching token allowance.
2. **Gifted on schedule.** The Convey Agent (through Convey's MCP server) gifts
   each one when it's due. It never sends early, never twice, never over budget,
   and it recovers from crashes. Each gift arrives as a normal link.
3. **Enforced on-chain.** Even with a leaked agent key, the wallet refuses
   anything outside the policy. The sender can revoke the agent at any time.

On X Layer mainnet, the Convey Agent gave two gifts within budget. A third gift, an
oversized gift and a token withdrawal were rejected. The agent was then
revoked, and its next call failed. See [Onchain proof](#onchain-proof).

## For AI agents: Convey MCP server

Convey also runs as an [MCP](https://modelcontextprotocol.io) server, so any
agent (Claude, Cursor, or an OKX AI agent) can gift xStocks to a person. For
example, it can reward a contributor, pay a bounty, or send a birthday share
on a user's behalf. The recipient still needs no wallet and pays no gas.

| Tool | |
|---|---|
| `list_xstocks` | Giftable xStocks with live issuer prices |
| `get_gift` | Live state and USD value of any gift |
| `agent_wallet` | Agent balances and per-gift cap |
| `send_gift` | Creates a gift and returns its claim link |
| `reclaim_gift` | Returns an unclaimed gift |
| `create_recurring_plan` · `run_due_gifts` | Recurring gifts, e.g. 0.01 AAPLx every month, under an approved total budget |
| `list_recurring_plans` · `cancel_recurring_plan` | Review or stop plans |

```sh
claude mcp add convey -- node /path/to/convey/mcp/server.ts
```

The read tools need no key. The spending tools need an agent key, a per-gift
cap, and `confirm: true`. For recurring gifts, one approval covers the whole
plan, bounded by its total budget.

For a budget the agent cannot exceed even if its key leaks, Convey also has an
**on-chain recurring mode**, proven on mainnet. The sender's OKX Smart Wallet
adds the agent as a restricted owner, bound to `ConveyRecurringGiftHook`. The
wallet then enforces the asset, the per-gift cap, the total budget and the
expiry itself, and the admin can revoke the agent at any time. The full send, cap, confirm and reclaim
flow and recurring plans (schedule, budget, and crash recovery) were exercised
against the live v2 contracts on a mainnet fork. See
[`mcp/README.md`](mcp/README.md).

## Security design

- **Claims can't be front-run.** The link secret never goes on chain. It signs
  `(chainId, escrow, giftId, claimer)` and `GiftEscrow` checks that signature
  against the stored claim-key address. A claim observed in a bundler, a
  mempool or a failed attempt can't be replayed to redirect the gift. It is
  covered by replay, wrong-key, malformed-signature, high-s and fuzz tests.
- **Non-custodial.** The recipient's owner key is created and encrypted on
  their device. Convey never receives it.
- **Scoped sponsorship.** The paymaster signs only single-call claims to
  `GiftEscrow` and draws on that gift's own reserve. The exit paymaster checks
  the route and a fresh on-chain quote before signing.
- **Fails closed.**
  - The gateway won't start without a bearer token.
  - Each UserOperation must pass event-aware EntryPoint preflight before it is
    forwarded.
  - Sponsor signing is limited per account and per IP, and exit sponsorship has
    a daily spend cap.
- **Recurring budgets are enforced by the wallet.** A recurring agent is a
  non-admin owner of the sender's OKX Smart Wallet. Every call it makes passes
  `ConveyRecurringGiftHook`, and it can never change owners or move funds
  elsewhere.
- **No mock data.** Prices, balances, quotes and claim state are read live.
  Anything that can't be read is shown as unavailable, never estimated.

The contracts have an in-house review and 51 Foundry tests. There has been no
third-party audit.

## Onchain proof

| Component | Address |
|---|---|
| `GiftEscrow` (v2, signature-bound) | [`0xffd2DACE75dbC3bC3f2e10C6c7b011Aa4EC043cD`](https://www.oklink.com/xlayer/address/0xffd2DACE75dbC3bC3f2e10C6c7b011Aa4EC043cD) |
| `ConveyClaimPaymasterV07` (v2) | [`0x655025c861C1848BA5324863D85BFA32cCF69e5B`](https://www.oklink.com/xlayer/address/0x655025c861C1848BA5324863D85BFA32cCF69e5B) |
| `ConveyExitPaymasterV07` | [`0xcfd241979d578e0b43f4c3f6b9b3fab83b41974c`](https://www.oklink.com/xlayer/address/0xcfd241979d578e0b43f4c3f6b9b3fab83b41974c) |
| `AssetRegistry` | [`0x156d160e004B7fb2021CFCA8fC6cF069c3b8b029`](https://www.oklink.com/xlayer/address/0x156d160e004B7fb2021CFCA8fC6cF069c3b8b029) |
| EntryPoint v0.7 | `0x0000000071727de22e5e9d8baf0edac6f37da032` |
| OKX Smart Wallet factory | `0xdd3fea01cd550c9effc893f346690b9a649f35ef` |

| Milestone | Evidence |
|---|---|
| Sponsored ERC-4337 v0.7 operation through private OKBund | [`0xfdb3ef41…df09`](https://www.oklink.com/xlayer/tx/0xfdb3ef41083b02282a304c948194b1ec9dca42d14f5fec258b8a12c2e7b4df09) |
| **End-to-end browser claim through the v2 escrow**: a new recipient, a passkey, zero gas, 23 s to confirmation | [`0x47236b16…0283`](https://www.oklink.com/xlayer/tx/0x47236b167d21a6acf9f20f7c932baeb132904c6106c740eb021df63129a00283) |
| Gasless gift claim (Gift 2, 0.0309 NVDAx, v1 escrow) | [`docs/verification.md`](docs/verification.md) |
| Gasless NVDAx → USDT0 cash-out through the exit paymaster | [`docs/verification.md`](docs/verification.md) |
| v2 escrow deployment and migration | [`0x24175d02…0e69`](https://www.oklink.com/xlayer/tx/0x24175d022c6f34a01956d4c163c604366f4e9eb3b469c94b30dc8bbef9780e69) |
| On-chain recurring gifts: an agent key bound by `ConveyRecurringGiftHook` sends 2 gifts in budget, the 3rd is rejected, then it is revoked | [gift 1](https://www.oklink.com/xlayer/tx/0x2a461908e16ea31be3f0bf64e9a7f4acfbea88198763e54afd6cdffc88fb8cc7) · [gift 2](https://www.oklink.com/xlayer/tx/0x2a1ec61d2860dd2ec9ad6317274f8882f7c250b538e4e6265154e9b3289d8516) · [revoke](https://www.oklink.com/xlayer/tx/0xdcb09023ed92d8894a7d3e78421092e408635d6779d5778b062dd9b2e951dfe5) |

Every hash, receipt and readback is recorded in
[`docs/verification.md`](docs/verification.md) and
[`docs/product-deployment.json`](docs/product-deployment.json).

**Not yet proven on mainnet:** passkey enrollment and recovery on a physical
device. The end-to-end claim above used Chromium's WebAuthn virtual
authenticator. Removing an owner on-chain is proven: the recurring-gift proof's
admin revoked the agent owner with `removeOwner`.

Drop (multi-claim gifts) is implemented and tested, but deliberately not
deployed.

## Repository

```text
app/                 Next.js app
  page.tsx           landing page
  app/page.tsx       send studio (OKX Wallet)
  g/[secret]/        recipient claim screen
  lib/okx-wallet.ts  OKX Wallet discovery, X Layer switching, mobile deep link
  api/               same-origin relay proxy (rate-limited) and issuer price proxy
mcp/                 MCP server for AI agents (send, check, reclaim gifts)
contracts/
  core/              AssetRegistry, GiftEscrow, DropEscrow
  paymaster/         claim and exit paymasters (ERC-4337 v0.7)
  bootstrap/         one-operation account bootstrap paymaster
  recurring/         on-chain recurring-gift hook for agent owners
src/
  sender/            OKX Wallet sender SDK
  receiver/          passkey vault, claim and exit builders
  relayer/           gateway, OKX account builder, preflight, limits
test/, test-solidity/  Node and Foundry suites
infra/               OKBund, gateway and web service units
docs/                design notes, verification record, operations
```

## Run it

```sh
pnpm install
cp .env.example .env && chmod 600 .env   # fill in the addresses above
pnpm dev                                  # http://localhost:3000
pnpm test && forge test                   # 52 Node + 51 Foundry tests
pnpm mcp                                  # MCP server on stdio
```

Operator commands for deployment, funding, the gateway and monitoring are in
[`docs/operations.md`](docs/operations.md). Live evidence is in
[`docs/verification.md`](docs/verification.md).

## Further documentation

- [`docs/architecture.md`](docs/architecture.md): contract and account model
- [`docs/claim-paymaster-design.md`](docs/claim-paymaster-design.md): reserve, validation and `postOp` accounting
- [`docs/relayer.md`](docs/relayer.md): gateway, SDK and preflight
- [`docs/sender-flow.md`](docs/sender-flow.md): sender module and gift creation
- [`docs/receiver-flow.md`](docs/receiver-flow.md): passkey vault and claim flow
- [`docs/recurring-authorization.md`](docs/recurring-authorization.md): on-chain recurring gifts (proven on mainnet)
- [`docs/drop-design.md`](docs/drop-design.md): multi-claim Drop (not deployed)
- [`mcp/README.md`](mcp/README.md): MCP server for agents

## License

[MIT](LICENSE)
