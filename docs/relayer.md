# Convey self-hosted relay path

Convey does not depend on ZeroDev, Pimlico, Particle, or a subscription relay.
The application owns the claim gateway and the SDK that submits claims through
it. The gateway forwards only to an operator-controlled ERC-4337 v0.7 bundler
over `BUNDLER_RPC_URL`.

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

1. Build and sign a v0.7 UserOperation for the receiver smart account.
2. Send it to Convey's `/v1/claims` endpoint over HTTPS.
3. Poll `/v1/claims/:userOperationHash` for the bundler receipt.

`src/relayer/okx.ts` contains the account-specific builder. It reads the live
X Layer chain ID, EntryPoint bytecode, factory-derived counterfactual address,
deployment state, and EntryPoint nonce. It encodes the factory `createAccount`
init code and the single `executeUserOp` claim call, then signs the EntryPoint
hash with the OKX owner envelope. Gas limits, fee caps, and paymaster data are
required inputs; the SDK never invents them. The builder is ready for the live
paymaster/bundler gate, but it has not been used to submit a claim because those
operator resources are not configured yet.

The gateway uses `SelfHostedBundlerClient` for the private JSON-RPC methods
`eth_supportedEntryPoints`, `eth_estimateUserOperationGas`,
`eth_sendUserOperation`, and `eth_getUserOperationReceipt`. It has no method
for `eth_sendRawTransaction` and has no public-bundler fallback.

## Claim security

The gateway is claim-only. It accepts a sponsored, signed v0.7 UserOperation,
requires the configured Convey paymaster, and requires a single zero-value
`executeUserOp` call to the configured escrow and claim selector. It never
stores or logs the request body. Idempotency stores only a short-lived request
key and UserOperation hash; the claim secret remains inside the signed calldata
and is not persisted by the gateway.

The private bundler endpoint is intentionally separate from the public X Layer
execution RPC. A relay URL must use HTTPS, except for loopback development
addresses. If the private relay is unavailable, the SDK reports an error; it
does not expose the claim to a public mempool.

## Health gate

`pnpm relayer:check` verifies, against live RPC endpoints:

- execution RPC and bundler are both on chain `196`;
- the configured EntryPoint has bytecode;
- the bundler advertises that exact EntryPoint;
- the configured paymaster has the required EntryPoint deposit; and
- the paymaster is staked with the required stake floor.

The check does not claim the paymaster's pre-charge-max and `postOp` refund
semantics. Those require a deployed Convey paymaster and a real sponsored
UserOperation; they remain part of the verification gate.

## Running it

Copy the self-hosted relay variables from `.env.example`, deploy or run the
chosen v0.7 bundler privately, deploy the Convey paymaster, and fund its
EntryPoint deposit and stake. Then run:

```sh
pnpm relayer:check
pnpm relayer:serve
```

The current workspace intentionally fails the check because no real bundler
endpoint, paymaster address, or funded paymaster has been supplied. No fake
endpoint is committed to make the check appear green.
