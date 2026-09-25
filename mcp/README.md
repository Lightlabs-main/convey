# Convey MCP server

Lets AI agents gift tokenized xStocks on X Layer to people by link. The
recipient needs no wallet and pays no gas: they open the link, confirm with a
passkey, and own the asset in their own OKX Smart Wallet.

Typical uses: an agent rewarding a contributor, paying a bounty, sending a
birthday share of a stock, or gifting a stock every month on a user's behalf.

## Tools

| Tool | Kind | What it does |
|---|---|---|
| `list_xstocks` | read | Giftable xStocks (NVDAx, AAPLx, TSLAx), registry status, live issuer price |
| `get_gift` | read | Live state, amount and USD value of a gift by ID or claim link |
| `agent_wallet` | read | Agent address, OKB balance, xStock balances, per-gift cap |
| `send_gift` | spends | Creates a gift from the agent wallet and returns its claim link |
| `reclaim_gift` | spends | Returns an unclaimed gift to the agent wallet |
| `create_recurring_plan` | spends | Sets up a recurring gift, e.g. 0.01 AAPLx every 30 days, with a total budget |
| `list_recurring_plans` | read | Plans with budget used, gifts remaining, next run and links sent |
| `cancel_recurring_plan` | safe | Stops a plan |
| `run_due_gifts` | spends | Sends every gift that is due now and returns the new links |

## Recurring gifts

The user approves a whole plan once: which xStock, how much per gift, how
often, for whom, and the total budget. The agent host then calls
`run_due_gifts` on a schedule, for example a daily Claude Code routine, cron
or an OKX AI agent task. Each run:

- sends at most one gift per plan, and only when it is due;
- never exceeds the plan's total budget or the per-gift cap, and completes the
  plan when the budget is spent;
- skips missed periods instead of sending a burst after downtime;
- never overlaps another run (lock file) and never double-sends. The link
  secret is saved before each transaction, so a crash is reconciled against
  the chain and the full link is recovered.

Plans live in `~/.convey-agent/plans.json` (mode 600; override with
`CONVEY_AGENT_STATE_DIR`). That file holds bearer links, so keep it private.

Here the budget is enforced by this server. For a budget the agent cannot
exceed even with a leaked key, use the on-chain mode proven on X Layer
mainnet: the sender's OKX Smart Wallet adds the agent as a restricted owner
bound to `ConveyRecurringGiftHook`, which enforces the asset, caps, budget and
expiry inside the wallet. See
[`docs/recurring-authorization.md`](../docs/recurring-authorization.md).

## Safety

- The read tools need no configuration and no key.
- The spending tools need all three of:
  - `CONVEY_AGENT_PRIVATE_KEY`;
  - `CONVEY_AGENT_MAX_GIFT_AMOUNT`, a per-gift cap in xStock units;
  - `confirm: true` on each call, so the agent must ask the user first.
- The key never leaves the server process. Transactions are signed locally and
  sent to X Layer.
- A claim link is a bearer link. The tool tells the agent to deliver it only to
  the intended recipient. Unclaimed gifts can be reclaimed at any time.
- Use a dedicated agent wallet holding only what you are willing to gift.

## Setup

```sh
pnpm install
```

Add it to an MCP client (Claude Desktop, Claude Code, Cursor and others):

```json
{
  "mcpServers": {
    "convey": {
      "command": "node",
      "args": ["/path/to/convey/mcp/server.ts"],
      "env": {
        "CONVEY_AGENT_PRIVATE_KEY": "0x…",
        "CONVEY_AGENT_MAX_GIFT_AMOUNT": "0.05"
      }
    }
  }
}
```

With Claude Code: `claude mcp add convey -- node /path/to/convey/mcp/server.ts`.

Leave out `env` for read-only use. The server defaults to the live X Layer
mainnet deployment. Override with `XLAYER_RPC_URL`, `CONVEY_APP_URL`,
`CONVEY_CLAIM_ESCROW_ADDRESS`, `CONVEY_CLAIM_PAYMASTER_ADDRESS`,
`CONVEY_ASSET_REGISTRY_ADDRESS` and the `CONVEY_W*_TOKEN_ADDRESS` variables.

Needs Node.js 22.18 or later, which runs TypeScript directly.

## Example

> **User:** Send Maya 0.01 NVDAx for her birthday.
>
> **Agent:** *calls `list_xstocks`, then `send_gift` without confirming:* That's about $2.25 of NVDAx from the agent wallet, plus a 0.00002 OKB claim reserve. Send it?
>
> **User:** Yes.
>
> **Agent:** *calls `send_gift` with `confirm: true`:* Done. Here's Maya's link: https://conveyapp.site/g/…?giftId=3
