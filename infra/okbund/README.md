# Convey operator bundler

Convey uses an operator-controlled ERC-4337 v0.7 bundler for all UserOperation
submission. It does not use a hosted bundler or relay. The initial
account-abstraction gate uses an operator-controlled Convey paymaster; claim
operations use Convey's private gateway and OKBund. See
[the gate design](../../docs/aa-gate-design.md).

The selected implementation is [OKX OKBund](https://github.com/okx/OKBund),
pinned to commit `77ac3770ba7dd4be949975b142623540e28f60e4` on the `develop`
branch. The repository contains the v0.7 EntryPoint simulation path under
`contracts07`; the v0.7 runtime configuration is selected explicitly below.
The pinned source passed `mvn verify` with Java 21 and Maven on 2026-09-23.
The upstream checkout contains no test sources, so this confirms compilation
and packaging rather than behavioral coverage. Java 25 did not compile this
revision correctly; use Java 21.

OKBund is upstream software, not a Convey contract. Review the pinned source,
license, dependency output, and operational logs before exposing it to claims.
The wrapper in this directory is part of Convey's security boundary: upstream
configuration has a development private-key fallback, so the wrapper refuses to
start unless the operator supplies a real secret through the environment.

## Where the RPC comes from

The endpoint is produced by an X Layer execution node; it is not an OKX Wallet
API key. OKX publishes the [X Layer RPC node toolkit](https://github.com/okx/xlayer-toolkit/tree/main/rpc-setup)
and documents a one-click mainnet setup. Use a Linux host with at least 8 GB
RAM and 100 GB SSD; 16 GB RAM and 500 GB SSD is the safer production shape for
an archive-style node. Docker 20.10+ and Docker Compose 2.0+ are required by
the toolkit.

The selected RPC path is the keyed NodeFlare X Layer endpoint. A private full
node remains an option if the hosted RPC path is unavailable or its limits stop
meeting bundler needs. If operating a full node for this OKBund integration,
use the toolkit's `op-geth` preset. The current one-click script defaults its
`RPC_TYPE` variable to `reth`; change that local default to `geth` before
running it, or use an already generated `mainnet-geth` setup. The toolkit's
mainnet op-geth config enables the `debug` HTTP module and the geth snapshot is
supported by the same setup.

On the node host, the setup looks like this:

```sh
git clone https://github.com/okx/xlayer-toolkit.git /opt/xlayer-toolkit
cd /opt/xlayer-toolkit/rpc-setup
cp one-click-setup.sh one-click-setup.geth.sh
sed -i 's/^RPC_TYPE="reth"/RPC_TYPE="geth"/' one-click-setup.geth.sh
chmod +x one-click-setup.geth.sh
./one-click-setup.geth.sh
```

Choose X Layer `mainnet` and snapshot sync when prompted. The generated node
normally exposes HTTP RPC on port `8545`; confirm the actual port with
`make status`. Keep that port behind the host firewall/private network. The
bundler and Convey gateway should preferably run on the same host and use
`http://127.0.0.1:8545`, so the debug API is never internet-facing.

## Verified prerequisite: a tracing RPC

The public X Layer RPC at `https://rpc.xlayer.tech` reports chain `196`, but it
does not expose the tracing methods required by safe bundling. The keyed
NodeFlare X Layer endpoint passed the `debug_traceCall` JavaScript-tracer and
state-override checks at chain `196` on 2026-09-23. `trace_call` is not
available there, but it is not one of the capabilities this OKBund setup
requires. Do not run with safe mode disabled.

The capability probe loads `.env` when present. It builds the keyed NodeFlare URL
from `NODEFLARE_API_KEY`; set `BUNDLER_EXECUTION_RPC_URL` to override it. The
probe writes a redacted result to
`docs/verification.rpc-capabilities.json`:

```sh
pnpm verify:bundler-rpc
```

The endpoint must be chain `196` and both required `debug_traceCall` probes must
pass. Keep its key and URL private; the browser and public claim URL must never
receive them.

## Build the pinned OKBund source

On the operator host, use Java 21 and keep the checkout outside the Convey
application deployment if possible:

```sh
git clone https://github.com/okx/OKBund.git /srv/convey/okbund
git -C /srv/convey/okbund checkout 77ac3770ba7dd4be949975b142623540e28f60e4
cd /srv/convey/okbund
JAVA_HOME=/path/to/java-21 mvn -s settings.xml clean verify
```

The resulting jar is
`aa-starter/target/aa-starter-0.0.1.jar`. The upstream Docker compose file is
for a local development Geth network and must not be used for X Layer
production.

## Production environment

Set these values in the operator's secret manager or service environment. Do
not commit them and do not paste private keys into chat:

```sh
BUNDLER_ENV=prod
CHAIN_ID=196
EIP1559=true
SAFE_MODE=true
ETH_RPC_URL=https://private-xlayer-rpc.example
ENTRYPOINT=0x0000000071727de22e5e9d8baf0edac6f37da032
BUNDLER_PRIVATE_KEY=<dedicated-bundler-hot-key>
OKBUND_DIR=/srv/convey/okbund
```

Start it through the checked-in launcher:

```sh
./infra/okbund/run.sh
```

OKBund serves its JSON-RPC endpoint at `/rpc` on port `3000` by default. The
Convey launcher binds it to `127.0.0.1` by default. Set
`BUNDLER_BIND_ADDRESS` to a private interface only when the gateway is on a
separate host and network rules restrict access. Put that endpoint behind
private HTTPS before crossing hosts. Set Convey's
`BUNDLER_RPC_URL` to that private endpoint, for example
`http://127.0.0.1:3000/rpc` when the gateway is on the same host. Never expose
the endpoint directly to browsers or the public internet.

The bundler hot wallet needs OKB for the native bundle transactions. After the
secret is installed, derive its address without printing the secret:

```sh
pnpm operator:addresses
```

Fund only the printed `BUNDLER_PRIVATE_KEY` address, using a live balance and
gas estimate to choose the amount. Record the funding transaction hash in the
operator log. Do not fund an address derived from a key pasted into source or
chat.

## Convey-side gate

Once the private endpoint is running, check its chain and EntryPoint:

```sh
pnpm bundler:check
```

`pnpm bundler:check` verifies chain `196` and the exact v0.7 EntryPoint from a
live `eth_supportedEntryPoints` response. After the claim paymaster and product
escrow are deployed and configured, run the full relay check:

```sh
pnpm relayer:check
```

It additionally checks the paymaster's EntryPoint deposit and stake.

The bootstrap paymaster is an infrastructure prerequisite to the first
sponsored operation. Its source and invariants must be reviewed before
deployment. The later product escrow and claim selector are post-gate work; the
selector will come from the deployed ABI and be allowlisted by the private claim
gateway. Keep the bootstrap signer, bundler key, account owner, and deployer
keys separate. The production sender-funded claim reserve requires its own
accounting and `postOp` proof.

## Required operator inputs, in order

1. Keyed NodeFlare X Layer RPC configuration through `NODEFLARE_API_KEY`, or
   another `BUNDLER_EXECUTION_RPC_URL` that passes both `debug_traceCall`
   JavaScript-tracer and state-override probes.
2. A dedicated `BUNDLER_PRIVATE_KEY`, installed through a secret manager, plus
   OKB funding for its derived bundle-sender address.
3. Before the account gate: reviewed bootstrap paymaster source, a deployer key
   and OKB for its deployment, a separate paymaster signer key, and the
   paymaster's EntryPoint deposit and stake.
4. A private HTTPS route from the Convey gateway to OKBund and TLS/auth
   configuration for the gateway.
5. After the account gate: product escrow deployment and its configured claim
   selector, followed by the separate sender-funded reserve implementation.

The tracing RPC gate now passes. Bundler key funding is still gated on bringing
up the operator-controlled bundler endpoint and checking its configured
chain, EntryPoint, paymaster deposit, and stake with `pnpm relayer:check`.
