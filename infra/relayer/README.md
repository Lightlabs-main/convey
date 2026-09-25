# Convey private gateway

The gateway is the server-side boundary between the receiver application and
the private OKBund endpoint. It accepts only signed, sponsored claim
UserOperations, preflights them through the private X Layer tracing RPC, and
forwards them to loopback OKBund. It never receives or stores a receiver's
private key or claim secret outside the signed calldata.

The supplied Lightsail host runs it as `convey-relayer.service` on
`127.0.0.1:8800`. OKBund remains on `127.0.0.1:3000/rpc`; neither endpoint is
public. Nginx and the separate `convey-web.service` expose only the browser
surface over HTTPS; the gateway remains loopback-only.

The service environment contains the live NodeFlare RPC URL, deployed claim
addresses, the claim selector, the server-only claim-paymaster signing key,
and a gateway bearer token. Keep
`/etc/convey/relayer.env` root-owned or readable only by the gateway service
account. Do not put the token or RPC URL in browser variables.

## Deployment shape

```text
browser receiver
      │ authenticated HTTPS edge
      ▼
Convey gateway :8800 (loopback)
      ▼
OKBund :3000/rpc (loopback)
      ▼
NodeFlare X Layer RPC (credentialed, server-side)
```

The gateway's health endpoint is authenticated and checks chain 196, EntryPoint
bytecode, OKBund EntryPoint support, and claim-paymaster deposit/stake floors.
The service was verified active on 2026-09-24. `/v1/claims/authorize`
additionally requires the live verifying-signer address to match the
server-only signing key before it signs an authorization.

The read-only `convey-ops-check.service` and `.timer` are the operational
monitoring unit. They check both claim and exit paymasters plus the optional
bundler-wallet balance and write JSON only to the system journal. Install them
only after creating the root-controlled `/etc/convey/operations.env` with the
public monitoring addresses and floors described in
[`docs/operations.md`](../../docs/operations.md).
