# X Layer account-abstraction provider review

Research date: 2026-09-23. This records provider fit, not a claim that an
integration has passed live operation.

## Selected route

Keep the verified NodeFlare endpoint as the private execution RPC for
simulation. Run OKX's open-source OKBund v0.7 as Convey's private bundler and
claim relay. Use an operator-controlled, narrowly scoped Convey paymaster for
the first sponsored operation. Submit the harmless account-deployment probe
through the operator's private OKBund endpoint; it carries no gift secret.
Keep the bootstrap sponsor separate from the later sender-funded claim-gas
reserve. The claim route remains behind Convey's gateway and private OKBund.

The signer/account and paymaster invariants are recorded in
[`aa-gate-design.md`](aa-gate-design.md). They are a proposed design; no
paymaster contract, sponsor endpoint, or live sponsored operation exists yet.

The OKX account is recorded accurately as OKX's custom modular ERC-4337 v0.7
wallet. The specification explicitly permits using the deployed OKX wallet
when its implementation is described accurately; ERC-7579 interoperability is
not claimed. See the [account decision](verification.md#account-standard-decision).

## Provider evidence

| Provider / component | Primary-source evidence | Decision |
|---|---|---|
| NodeFlare | The keyed X Layer endpoint passed chain ID 196, JavaScript-tracer `debug_traceCall`, and state-override tracing in the recorded probe. | Use as OKBund's private execution RPC. It is an execution RPC, not a UserOperation bundler. |
| OKBund | [OKX's OKBund repository](https://github.com/okx/OKBund) publishes an ERC-4337 bundler; the pinned local build includes the v0.7 path. | Use as Convey's private bundler and claim relay. |
| Coinbase VerifyingPaymaster v0.7 | [Coinbase's source](https://github.com/coinbase/verifying-paymaster) identifies the implementation as v0.7 and uses a signature over sender, nonce, init code, call data, gas fields, chain ID, paymaster address, and paymaster data. It also includes optional ERC-20 payment logic and a bundler allowlist. Its published deployments are Base and Base Sepolia. [Cantina lists a 2024 review of `verifying-paymaster-v2`](https://cantina.xyz/portfolio/88b09402-6430-411e-80b0-857854fbe9f3), but the reviewed source revision has not been matched to the current repository revision. | Reference only; do not deploy unchanged. Its generic signer policy does not enforce Convey's exact call target and selector, and X Layer deployment suitability has not been established. |
| Particle | Particle's published X Layer sponsorship example was investigated; it uses the v0.6 EntryPoint format. | Retired as a Convey dependency. No live acceptance probe was run and no Particle credential slots remain in `.env.example`. |
| OKX OnchainOS Agentic Wallet | The [wallet product docs](https://web3.okx.com/onchainos/dev-docs/wallet/product-and-service) list X Layer and zero gas on X Layer. Wallet creation is through email, Google, or Apple sign-in, with keys held in a TEE; the [supported-network list](https://web3.okx.com/onchainos/dev-docs/home/supported-chain) includes chain 196. | A credible OKX gas-sponsored wallet product, but the published docs describe the Agentic Wallet's own login/signing flow, not a generic v0.7 sponsor API for an external counterfactual OKX Smart Wallet. It also changes Convey's no-account receiver path, so it is not a direct fit for this gate. |
| BlockPI | Its [ERC-4337 bundler documentation](https://docs.blockpi.io/basic-tutorials/api-key/customize-endpoint-advanced-features) lists OP Mainnet, Base Mainnet, Polygon Mainnet, and Taiko Hekla for its bundler service. | Do not select for X Layer bundling based on current published coverage. Its X Layer RPC product is a separate service. |
| thirdweb | Its [bundler reference](https://portal.thirdweb.com/bundler) documents v0.6/v0.7 operation formats and authenticated bundler/paymaster methods, but does not publish an X Layer service entry in the reviewed reference. | Not selected without a live chain-196 support check. |
| Safe7579 | Safe's [ERC-7579 adapter documentation](https://docs.safe.global/advanced/erc-7579/7579-safe) describes ERC-7579 compatibility; its [tutorial](https://docs.safe.global/advanced/erc-7579/tutorials/7579-tutorial) uses Sepolia launchpad addresses identified as not production deployments. | Not selected for the receiver account until a production X Layer factory/launchpad is independently verified. |

## First sponsored-operation gate

Use the exact counterfactual sender derived by `pnpm account:inspect` and
construct an operation that deploys the account and performs one zero-value,
empty-calldata call to the zero address. The probe must establish all of the
following before this route is treated as working:

1. The Convey paymaster is deployed on chain 196 with the canonical EntryPoint
   v0.7 and a dedicated verifying signer.
2. Its policy accepts only the inspected counterfactual sender, expected OKX
   factory init code, the harmless call above, and a short-lived authorization
   whose maximum cost is within the configured cap.
3. OKBund's `eth_supportedEntryPoints` returns the verified v0.7 EntryPoint.
4. The signed operation is sent only to the operator's private OKBund endpoint.
5. A mainnet receipt proves the account deployment and sponsored call; record
   the UserOperation hash and transaction hash without publishing secret keys.
6. Contract invariant tests prove that malformed, expired, replayed, over-cap,
   wrong-sender, wrong-factory, and non-probe operations cannot be sponsored.
   The bootstrap paymaster uses operator-funded OKB only; it does not charge a
   receiver or gift reserve.

This probe did not prove the later sender-funded claim reserve or its
pre-charge and `postOp` settlement. The separate claim-paymaster implementation
and invariant suite now exist locally and have passed on the supplied VPS; do
not submit real claims until that paymaster is deployed, funded, privately
simulated, and exercised end to end on X Layer.

The OKX OnchainOS Agentic Wallet remains a product-level alternative only if
the receiver identity/account flow is deliberately reconsidered. Its current
published material does not establish that it can sponsor the selected
counterfactual v0.7 account through OKBund.
