# Convey self-hosted relay path

Convey does not depend on ZeroDev, Pimlico, Particle, or a subscription relay.
The application owns the claim gateway and the SDK that submits claims through
it. The gateway forwards only to an operator-controlled ERC-4337 v0.7 bundler
over `BUNDLER_RPC_URL`; the receiver's claim is gasless because the sender-funded
reserve and Convey paymaster cover the UserOperation.

## Boundary

The browser/server application imports `ConveyRelayerClient` from the browser-safe
SDK entry point. The Node gateway is a separate server-only entry point:

```ts
import { ConveyRelayerClient } from "convey/relayer";
import { createRelayerServer } from "convey/relayer/server";
```

The low-level `SelfHostedBundlerClient` is server-only and is not exported from
the browser entry point. Browser code cannot bypass the gateway to reach the
private bundler.

The browser path then:

1. Read a live gas seed from `/v1/claims/gas-seed`. The seed comes from a
   successful recorded claim UserOperation; the gateway returns no claim
   calldata.
2. Build an unsigned v0.7 UserOperation for the receiver smart account.
3. Ask `/v1/claims/authorize` for a claim-scoped paymaster authorization. The
   gateway signs it with the configured claim-paymaster signer only after
   checking the live open reserve, exact escrow/claim target, and the computed
   EntryPoint v0.7 gas pre-fund against the live paymaster cap.
4. Put the returned paymaster data into the operation and sign the final
   operation locally with the receiver owner key.
5. Ask `/v1/claims/estimate` for the exact signed operation's live gas
   estimate. If any limit rises, rebuild and authorize again.
6. Send it to Convey's `/v1/claims` endpoint over HTTPS.
7. Poll `/v1/claims/:userOperationHash` for the bundler receipt.

`src/relayer/okx.ts` contains the account-specific builder. It reads the live
X Layer chain ID, EntryPoint bytecode, factory-derived counterfactual address,
deployment state, and EntryPoint nonce. It encodes the factory `createAccount`
init code and the single `executeUserOp` claim call, then signs the EntryPoint
hash with the OKX owner envelope. Gas limits, fee caps, and paymaster data are
required inputs; the SDK never invents them. The builder was used in the
successful live Gift ID `2` claim. An earlier operation reported
`TokenTransferFailed()` and was reclaimed; that failure is recorded separately
and its exposed secret is retired.

The gateway uses `SelfHostedBundlerClient` for the private JSON-RPC methods
`eth_supportedEntryPoints`, `eth_estimateUserOperationGas`,
`eth_sendUserOperation`, `eth_getUserOperationByHash`, and
`eth_getUserOperationReceipt`. It has no method for `eth_sendRawTransaction`
and has no public-bundler fallback.

Before a live claim is submitted, the operator can run
`preflightEntryPointUserOperation` from `src/relayer/preflight.ts` against the
private execution RPC. It traces the exact v0.7 `handleOps` call and requires
the matching `UserOperationEvent` to report `success = true`; a successful
outer `handleOps` call alone is not sufficient. `UserOperationRevertReason` is
decoded when present. The trace is read-only, but it must use a fresh open gift,
reserve, sponsor authorization, and operation nonce because those values are
checked during simulation.

The gateway runs this same preflight on `/v1/claims` immediately before
`eth_sendUserOperation`. A failed simulation is rejected and is never placed in
the private bundler; an unavailable tracing RPC also fails closed.

## Claim security

The gateway is claim-only. It accepts a sponsored, signed v0.7 UserOperation,
requires the configured Convey paymaster, and requires a single zero-value
`executeUserOp` call to the configured escrow and claim selector. It never
stores or logs the request body. Idempotency stores only a short-lived request
key and UserOperation hash; the claim secret remains inside the signed calldata
and is not persisted by the gateway.

The bundler's execution RPC is intentionally separate from the public claim
gateway. The current operator path uses the keyed NodeFlare X Layer endpoint,
whose JavaScript-tracer and state-override `debug_traceCall` probes passed on
chain `196`; operators can instead set `BUNDLER_EXECUTION_RPC_URL` to another
endpoint that passes the same checks. `pnpm verify:bundler-rpc` derives the
NodeFlare URL from `NODEFLARE_API_KEY` and redacts its credential-bearing path
from output. A relay URL must use HTTPS, except for loopback development
addresses. If the private relay is unavailable, the SDK reports an error; it
does not expose the claim to a public mempool.

## Health gate

`pnpm relayer:check` verifies, against live RPC endpoints:

- execution RPC and bundler are both on chain `196`;
- the configured EntryPoint has bytecode;
- the bundler advertises that exact EntryPoint;
- the configured paymaster has the required EntryPoint deposit; and
- the paymaster is staked with the required stake floor.

The check does not claim the claim paymaster's pre-charge-max and `postOp`
refund semantics by itself. Those semantics were exercised by the successful
Gift ID `2` claim and recorded in the verification evidence.

## Running it

For a fresh environment, copy the self-hosted relay variables from
`.env.example`, deploy or run the chosen v0.7 bundler privately, deploy the
Convey paymaster, and fund its EntryPoint deposit and stake. Then run:

```sh
pnpm relayer:check
pnpm relayer:serve
```

The current workspace still requires a private `BUNDLER_RPC_URL` at runtime;
it is intentionally not saved in the local `.env`. The deployed bootstrap and
claim paymasters have passed their recorded live checks, and Gift ID `2` was
claimed successfully through the private route. The durable gateway is now
active on the supplied VPS at loopback `127.0.0.1:8800`; the browser-facing
HTTPS edge is the remaining deployment step. No fake endpoint is committed to
make a health check appear green.

## Operator bundler gate

The selected operator bundler is the pinned OKX OKBund v0.7 build. Its runbook,
fail-closed launcher, and the required RPC/key/funding order are in
[infra/okbund/README.md](../infra/okbund/README.md). The public X Layer RPC does
not expose the tracing methods required for safe bundling, so a private tracing
RPC is required before a bundler key is funded.

## Persistent private deployment

The supplied Lightsail host is also the intended private gateway host. The
checked-in service unit in
[`infra/relayer/convey-relayer.service`](../infra/relayer/convey-relayer.service)
runs the gateway on loopback port `8800`, forwards to loopback OKBund, and
loads its NodeFlare URL and bearer token from root-controlled service
configuration. Existing unrelated VPS services occupy ports `8787`, `8797`,
and `8798`, so Convey uses `8800`. The gateway has no public listener. The
separate HTTPS web edge is deployed at
`https://convey.13-62-181-128.sslip.io` and proxies the browser's same-origin
relay requests to this loopback service.
