# Convey MCP server

Lets AI agents gift tokenized xStocks on X Layer to people by link. The
recipient needs no wallet and pays no gas: they open the link, confirm with a
passkey, and own the asset in their own OKX Smart Wallet.

Typical uses: an agent rewarding a contributor, paying a bounty, or sending a
birthday share of NVIDIA on a user's behalf.

## Tools

| Tool | Kind | What it does |
|---|---|---|
| `list_xstocks` | read | Giftable xStocks (NVDAx, AAPLx, TSLAx), registry status, live issuer price |
| `get_gift` | read | Live state, amount and USD value of a gift by ID or claim link |
| `agent_wallet` | read | Agent address, OKB balance, xStock balances, per-gift cap |
| `send_gift` | spends | Creates a gift from the agent wallet and returns its claim link |
| `reclaim_gift` | spends | Returns an unclaimed gift to the agent wallet |

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
