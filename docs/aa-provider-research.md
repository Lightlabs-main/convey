# X Layer account-abstraction provider review

Research date: 2026-09-23. This records provider fit, not a claim that an
integration has passed live operation.

## Selected route

Keep the verified NodeFlare endpoint as the private execution RPC for
simulation. Run OKX's open-source OKBund v0.7 as Ticker's private bundler and
claim relay. Test Particle's X Layer paymaster service as the bootstrap sponsor
for an OKX Smart Wallet v0.7 UserOperation. If Particle returns valid v0.7
paymaster data for the inspected account and OKBund includes the operation,
this satisfies the first sponsored-operation proof without exposing the claim
through a public bundler. For product claims, retain the same private OKBund
route and replace bootstrap sponsorship with Ticker's own funded paymaster only
after the account and relay path are proven. The bootstrap operation must carry
no gift secret; the external sponsor must never receive a claim UserOperation.

The OKX account is recorded accurately as OKX's custom modular ERC-4337 v0.7
wallet. The specification explicitly permits using the deployed OKX wallet
when its implementation is described accurately; ERC-7579 interoperability is
not claimed. See the [account decision](verification.md#account-standard-decision).

## Provider evidence

| Provider / component | Primary-source evidence | Decision |
|---|---|---|
| NodeFlare | The keyed X Layer endpoint passed chain ID 196, JavaScript-tracer `debug_traceCall`, and state-override tracing in the recorded probe. | Use as OKBund's private execution RPC. It is an execution RPC, not a UserOperation bundler. |
| OKBund | [OKX's OKBund repository](https://github.com/okx/OKBund) publishes an ERC-4337 bundler; the pinned local build includes the v0.7 path. | Use as Ticker's private bundler and claim relay. |
| Particle | [Particle announced X Layer support](https://blog.particle.network/x-layer-is-integrating-particle-networks-solutions-for-chain-abstraction-2/) with ERC-4337 smart accounts and gasless paymaster sponsorship. Its [sponsor API](https://developers.particle.network/aa/paymaster/sponsoruseroperation) accepts a UserOperation and EntryPoint, and requires project credentials. The published example uses the v0.6 EntryPoint and legacy UserOperation fields. | Best documented X Layer sponsorship candidate for the bootstrap operation, but require a real v0.7 compatibility check before selecting it. The Ticker bundler remains the submission path. |
| BlockPI | Its [ERC-4337 bundler documentation](https://docs.blockpi.io/basic-tutorials/api-key/customize-endpoint-advanced-features) lists OP Mainnet, Base Mainnet, Polygon Mainnet, and Taiko Hekla for its bundler service. | Do not select for X Layer bundling based on current published coverage. Its X Layer RPC product is a separate service. |
| thirdweb | Its [bundler reference](https://portal.thirdweb.com/bundler) documents v0.6/v0.7 operation formats and authenticated bundler/paymaster methods, but does not publish an X Layer service entry in the reviewed reference. | Not selected without a live chain-196 support check. |
| Safe7579 | Safe's [ERC-7579 adapter documentation](https://docs.safe.global/advanced/erc-7579/7579-safe) describes ERC-7579 compatibility; its [tutorial](https://docs.safe.global/advanced/erc-7579/tutorials/7579-tutorial) uses Sepolia launchpad addresses identified as not production deployments. | Not selected for the receiver account until a production X Layer factory/launchpad is independently verified. |

## Acceptance probe

Use the exact counterfactual sender derived by `pnpm account:inspect` and
construct an operation that deploys the account and performs a harmless,
zero-value call. The probe must establish all of the following before this
route is treated as working:

1. Particle's sponsor API accepts chain 196 and EntryPoint v0.7 and returns
   non-empty, valid v0.7 paymaster fields for the OKX account operation.
2. OKBund's `eth_supportedEntryPoints` returns the verified v0.7 EntryPoint.
3. The signed operation is sent only to Ticker's private relay/OKBund endpoint.
4. A mainnet receipt proves the account deployment and sponsored call; record
   the UserOperation hash and transaction hash without publishing secret keys.
5. The actual paymaster's `validatePaymasterUserOp` and `postOp` behavior is
   source-verified for max-cost precharge and excess reconciliation. A live
   successful operation alone is not evidence of this security property.

If Particle does not meet these checks, do not submit claim operations through
a public bundler or public-mempool route. Revisit the infrastructure-only
paymaster exception recorded in [architecture.md](architecture.md) before
writing GiftEscrow.
