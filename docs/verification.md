# X Layer mainnet verification

Status: **account-abstraction and private gasless product-claim gates passed on X Layer mainnet.** One sponsored UserOperation deployed the selected receiver account. Gift ID `2` was then claimed successfully through Convey's private gateway, OKBund, and the funded claim paymaster; the receiver supplied no native gas. The receiver vault core, persistent private gateway, and public HTTPS web edge are now deployed; browser ceremony/recovery proof and browser mainnet proof remain open.

## Live exit-paymaster deployment — 2026-09-25

The corrected four-field X Layer SwapRouter02 `exactInput` policy was compiled
with Foundry 1.8.3 and passed the complete Solidity regression suite (38 tests).
The deployment script also verified that its Foundry artifact matched the
current source before sending the transaction. Exit authorization rechecks the
configured route and a fresh QuoterV2 minimum before signing.

- Exit paymaster: `0xcfd241979d578e0b43f4c3f6b9b3fab83b41974c`
- Deployment transaction: `0x35eb1f85dc8af1d9092f4ac20d506ce79e520e372302e1d13a7976d03b0186d1`
- Deployment block: `71533700`; status `0x1`; gas used `2300846`; effective gas price `20000001 wei`
- EntryPoint deposit transaction: `0xbf11746f8d6797e6375dba84c647b511e61cef7ef5284231e89e2a09374988bc`
- Deposit block: `71533753`; status `0x1`; deposit `100000000000000 wei` (`0.0001 OKB`)
- Stake transaction: `0x5df7855385e4d202f62ae70f5f203a5d7bf63c197e81d32222371eb3b3b03e23`
- Stake block: `71533755`; status `0x1`; stake `1 wei`; unstake delay `86400 seconds`

At NodeFlare block `71533860`, live readback found 10,275 bytes of runtime
code, chain `196`, the canonical EntryPoint v0.7, the configured registry,
SwapRouter02, USDT0, sponsor signer, `maxExitCost = 50000000000000 wei`,
`UNISWAP_EXACT_INPUT_SELECTOR = 0xb858183f`, and a 300-second authorization
window. The operator then completed one real gasless exit through the private
gateway and OKBund:

- UserOperation hash: `0xd37eba9f81db81b41bc81863a3e06ecffc7285e321b363a4aecabac650816b8f`
- Manual OKBund bundle transaction: `0x8bbe7a11e439e8c9d18ce698871d2220231a51f124d58e3c80605a087e9099b0`
- X Layer block: `71534842` (`0x44388fa`); transaction status `0x1`; gas used `415010`
- EntryPoint `UserOperationEvent`: `success = true`, `actualGasUsed = 487219`, `actualGasCost = 10231599000000 wei`
- `ExitSettled`: actual gas cost `9261966000000 wei`, precharged
  `25824288000000 wei`, refunded `16562322000000 wei`
- The receiver swapped its full `30965586663211895` NVDAx
  (`0.030965586663211895`) and received `6932357` USDT0 (`6.932357`)

The public gateway status endpoint now resolves the mined EntryPoint event and
returns `confirmed` with the bundle transaction and block above, even though
this OKBund build did not index the receipt through
`eth_getUserOperationReceipt`. At NodeFlare block `71535386`, the receiver's
NVDAx balance was `0`, its USDT0 balance was `6932357`, its EntryPoint nonce was
`4`, and the exit paymaster remained staked with a `73206079000000 wei`
deposit. This is operator-script proof of the gasless exit; browser PRF and
browser-to-browser mainnet proof remain open.

The supplied VPS gateway was updated to the corrected exit policy and new
paymaster address, restarted, and returned authenticated `healthy = true` on
chain `196`. The production web bundle was rebuilt with the new address and
deployed atomically; `convey-web.service` remained active, public `/` and a
claim route returned HTTP `200`, and the public relay health proxy returned
HTTP `200`. This remains deployment evidence, not browser PRF or
browser-to-browser mainnet proof.

## Live continuation checks — 2026-09-24

The workspace resumed with read-only checks before any new gift or claim action:

- `pnpm account:inspect` confirmed chain `196`, the deployed receiver
  `0x63B2A84d47cb07fb18EE72Ec386893506Fd963db`, and the canonical v0.7
  EntryPoint/factory configuration.
- The keyed NodeFlare probe at `2026-09-24T11:15:45Z` again passed both required
  `debug_traceCall` capabilities. `trace_call` remains unsupported and is not
  required by the selected OKBund safe-mode path.
- The supplied Lightsail host reported `convey-okbund.service` active and its
  loopback RPC returned chain `196`. The host had about `350 MiB` available RAM
  and `1.384 GiB` free swap at the check; the persistent gateway was installed
  only after this read-only capacity check.
- A live product-state read reported `nextGiftId = 2`, Gift ID `1` as
  `Reclaimed`, `openReserveTotal = 0`, `inFlightTotal = 0`, and
  `pendingRefundTotal = 0`. The claim paymaster remained staked with an
  EntryPoint deposit of `198988059949403` wei; the sender held all
  `0.030965586663211895` NVDAx and the escrow and receiver held zero.

These checks submitted no transaction or UserOperation. Gift ID `1`'s secret
remains permanently retired. Gift ID `2` creation and claim still require
explicit operator authorization immediately before those state-changing calls.

Machine-readable raw results are generated by `pnpm verify` into `docs/verification.raw.json`. On-chain reads are pinned to block `71,272,554` (`0x43f886a`) until this document is deliberately refreshed. Issuer prices and multipliers are live, timestamped observations because the issuer API exposes no historical snapshots; therefore a rerun can change quote input amounts while reading the same pinned chain state.

The product deployment receipts and public configuration are preserved in
[`docs/product-deployment.json`](product-deployment.json).

## Verified

- X Layer mainnet reports chain ID `196` through the official public RPC.
- At the pinned block, the base fee was `20,000,000 wei` (`0.02 gwei`). The observed RPC gas price was `20,000,001 wei`.
- Bytecode exists at the canonical ERC-4337 EntryPoint v0.6, v0.7, and v0.8 addresses. This proves deployment, not bundler support; Convey is pinned to v0.7 for the selected OKX wallet path.
- The current OKX Smart Wallet factory (`0xDd3F…35EF`) and implementation (`0xe40c…6fA4`) both have bytecode at the pinned block. The implementation's `entryPoint()` returns canonical ERC-4337 v0.7 (`0x000000007172…a032`).
- The issuer API identifies all three supplied wrapper addresses as X Layer `wrapperAddressV2` deployments. Their on-chain `asset()` values match the issuer's native underlying addresses and each wrapper reports 18 decimals.
- X Layer uses EVM contracts. Solana Token-2022 does not apply to these deployments; xStocks implements multiplier/rebasing behavior through its EVM wrapper design.
- USDT0 is `0x779ded0c9e1022225f8e0630b35a9b54be713736` and reports 6 decimals.
- Uniswap V3 factory and QuoterV2 addresses are sourced from Uniswap's X Layer deployment registry. Executable, pinned-block quotes are recorded in the raw result.

### Executable cash-out quotes at block 71,272,554

The input quantity for each row is derived from the issuer's underlying quote and wrapper multiplier observed at `2026-09-22T18:57:56Z`. The pool execution is pinned to the block above because the issuer API does not expose historical snapshots. `convertToAssets()` is not used as a price. Outputs below are executable QuoterV2 results in USDT0; percentages are deltas from the nominal input size, **not AMM price-impact measurements**. A true price-impact figure requires a same-block pool spot/TWAP baseline.

| Asset | Route | $5 | $20 | $50 | Assessment |
|---|---|---:|---:|---:|---|
| wNVDAx | wNVDAx → USDG (0.05%) → USDT0 (0.01%) | $4.955350 (0.89%) | $19.821356 (0.89%) | $49.553157 (0.89%) | Clean at tested sizes |
| wTSLAx | wTSLAx → USDG (0.05%) → USDT0 (0.01%) | $4.407037 (11.86%) | $5.338550 (73.31%) | $5.338550 (89.32%) | Thin; not suitable for cash-out |
| wAAPLx | wAAPLx → USDG (0.05%) → USDT0 (0.01%) | $4.977145 (0.46%) | $19.908393 (0.46%) | $49.770028 (0.46%) | Clean at tested sizes |

Direct TSLA and AAPL USDT0 pools were present but returned no executable quote. NVDA also has a direct 0.3% route, but the USDG route produced the best output. The TSLA result shows severe exhaustion around $5.34 and must be exposed as hold-only unless liquidity improves at runtime.

## Relay and sponsorship decision

Convey will operate its own claim relay gateway and SDK. The gateway forwards
claims only to an operator-controlled ERC-4337 v0.7 bundler over a private
`BUNDLER_RPC_URL` and fails closed if that path is unavailable. See
[docs/relayer.md](relayer.md). NodeFlare is the execution RPC behind OKBund;
it is not itself the bundler.

The first sponsored-operation route is an operator-controlled Convey v0.7
paymaster, funded separately from any product gas reserve. Particle's earlier
bootstrap proposal has been retired; no Particle acceptance probe was run.
The account signer shape, paymaster restrictions, and remaining invariant
checks are in [docs/aa-gate-design.md](aa-gate-design.md) and
[docs/aa-provider-research.md](aa-provider-research.md).

### OKBund runtime probe

On 2026-09-23, the pinned OKBund source at
`77ac3770ba7dd4be949975b142623540e28f60e4` passed `mvn verify` with Java 21.
The packaged jar SHA-256 was
`4d8575eabe783e0ae604fa1bb7ce91b22afab0c0df9070236f5f847183d8db97`.
Upstream contains no test sources; Maven reported no tests to run.

The packaged service was started with `infra/okbund/run.sh` on `127.0.0.1`,
using the verified NodeFlare X Layer execution RPC and a newly generated,
unfunded throwaway bundler key. `pnpm bundler:check` returned healthy with
`eth_chainId = 0xc4` (`196`) and
`eth_supportedEntryPoints = [0x0000000071727de22e5e9d8baf0edac6f37da032]`.
No UserOperation was submitted. This confirms the pinned service starts and
advertises the selected v0.7 EntryPoint against NodeFlare; it does not
constitute the sponsored account deployment gate.

### Supplied Lightsail VPS deployment

On 2026-09-23, the same pinned OKBund commit was built on the user's existing
Ubuntu 24.04.4 Lightsail VPS with Java 21 and Maven. `mvn -B -s settings.xml
clean verify` passed. The built jar SHA-256 is
`7aa098ee3629a83c7d08a8672deb2747205c418fbef59d104158b61b4ace7c60`.

The enabled `convey-okbund.service` runs the checked-in launcher with safe mode
and EIP-1559 enabled, and listens only on VPS loopback `127.0.0.1:3000`. Live
calls from the VPS returned `eth_chainId = 0xc4` and the canonical v0.7
EntryPoint from `eth_supportedEntryPoints`. The service used about 199 MiB
against its 650 MiB memory cap; the 1 GB host reported about 288 MiB available
after startup. Existing website services were left running.

A dedicated bundler key was generated and stored with the NodeFlare RPC
credential in root-only `/etc/convey/okbund.env`; neither secret was printed.
The public bundler address is
`0xa537812DdaD4AcaA3617E316c8f9b4Add6C9D67e`. Its balance was later funded
and measured at `0.000781673979083699 OKB` after the bootstrap bundle. The
observed `eth_gasPrice` was `0x1406f40` wei at the time of the initial check;
it is a point-in-time reading, not an approved funding amount.

A later workspace `pnpm bundler:check` through a temporary SSH local port
forward passed: the tunneled endpoint reported chain `196` and advertised the
canonical v0.7 EntryPoint. This supersedes the earlier generic tunnel failure.
Gateway connectivity from the deployed Convey process is recorded in the
persistent deployment section below. The VPS endpoint is loopback-only and is
not exposed publicly.

### Persistent Convey gateway deployment — 2026-09-24

The checked-in `convey-relayer.service` was installed and enabled on the
supplied Lightsail VPS after the capacity check above. It runs as the dedicated
`convey-relayer` user, reads its root-controlled environment file, forwards to
OKBund at `127.0.0.1:3000/rpc`, and binds only to `127.0.0.1:8800`. Existing
services occupying ports `8787`, `8797`, and `8798` were left untouched.

At `2026-09-24T15:07:13Z`, the service was active and enabled. An unauthenticated
`/healthz` request returned HTTP `401`. The authenticated health check returned
`healthy = true`, chain `196`, OKBund support for the canonical v0.7 EntryPoint
`0x0000000071727de22e5e9d8baf0edac6f37da032`, EntryPoint code size `16035`
bytes, and a staked claim paymaster with deposit `197696031949403` wei against
the configured minimum `20000000000000` wei. No secret token or RPC credential
was printed or committed. At that check this was still a private loopback
deployment; the public web edge was installed later and is recorded below.

The live gas-seed route was then enabled with the successful Gift ID `2`
UserOperation hash
`0x1ed2abda8798479bd1dd74c81073007ca791a292b1c727af198da552e3a94403`. Because
the installed OKBund response omits optional v0.7 paymaster fields from
`eth_getUserOperationByHash`, the gateway recovered the packed operation from
the recorded EntryPoint bundle transaction and returned only gas/fee fields.
The authenticated route returned `callGasLimit = 0x61a80`,
`verificationGasLimit = 0x30d40`, `preVerificationGas = 0xea60`,
`paymasterVerificationGasLimit = 0x30d40`, and
`paymasterPostOpGasLimit = 0x13880`; current execution-RPC fee fields were
`maxFeePerGas = 0x1406f40` and `maxPriorityFeePerGas = 0xf4240`. No claim
calldata, secret, key, or UserOperation was submitted by this check.

The server-only claim-paymaster signer is installed in the same root-controlled
environment. A non-mutating `/v1/claims/authorize` request for already-closed
Gift ID `2` returned HTTP `409` with `gift_claim_reserve_unavailable`, after the
gateway reached the live paymaster policy. It did not submit a UserOperation or
change chain state. This confirms the signer route is configured without
claiming that a fresh open gift has been authorized.

On 2026-09-24, the new Convey EntryPoint event tracer was accepted by the
configured private execution RPC. A read-only ERC-20 transfer trace captured a
`Transfer` log with event data; no transaction or UserOperation was submitted.
This validates the tracer's live stack-word and memory handling used by the
claim preflight.

- The local private bundler runtime probe and later tunneled VPS check passed. OKBund is persistent on the supplied VPS, and the live sponsored-operation evidence is recorded below. The product escrow and claim selector are deployed; browser claim proof remains open.
- The receiver account is deployed, its EntryPoint nonce is `3` after the recorded product claim, and the Gift ID `2` paymaster authorization is consumed. The paymaster remains staked and funded; refresh the deposit before a new live gift.
- Session-key support, paymaster pre-charge/refund behavior, ERC-20 payment mode, EntryPoint deposit/stake funding, and private relay routing remain unverified on the self-hosted deployment.
- Gas-price variance needs repeated observations over time; one block only confirms the floor at that instant.
- The issuer API and RPC evidence must be refreshed at deploy time because wrapper certification, trading halts, multipliers, and liquidity can change.

### Historical pre-gateway Lightsail health check — 2026-09-23

At `2026-09-23T16:16:45Z`, a read-only check through the supplied SSH key found
`convey-okbund.service` active. Calls to `127.0.0.1:3000/rpc` returned chain
`0xc4` (`196`) and the canonical v0.7 EntryPoint. The host reported 648 MiB
used, 260 MiB available, 458 MiB of 2.0 GiB swap used, and 22 GiB of disk
available (44% used). This is a point-in-time resource reading.

The only running Convey-named systemd service was then OKBund. The VPS scan did
not identify a Convey gateway service or container at that time; the existing
`page47-web` and `xcover` site services remained active. No services were
changed or restarted. The check submitted no transaction or UserOperation, so
it produced no transaction hash. The later gateway installation followed a
fresh capacity check and left those existing services untouched.

### Operator funding and bootstrap paymaster deployment — 2026-09-23

The operator provisioned distinct receiver-owner, paymaster-deployer, and
paymaster-signer keys in the ignored local `.env`. The operator-address check
derived distinct role addresses without printing private values. The receiver
owner now derives counterfactual OKX account
`0x63B2A84d47cb07fb18EE72Ec386893506Fd963db`; a live X Layer check reported
chain `196`, the canonical v0.7 EntryPoint and verified OKX factory, and no
account bytecode at that address.

The deployer account `0x5fA8199ad34373A063c96D24a1BF5b4a105D3399` was funded
with `0.0011 OKB`. At that initial deployment checkpoint, the VPS bundler
wallet `0xa537812DdaD4AcaA3617E316c8f9b4Add6C9D67e` was still at `0 OKB`; it
was funded before the sponsored operation (latest balance is recorded above).
At the observed gas price of `20000001` wei, the deployment estimate was
`1400537` gas (`0.000028010741400537 OKB`).

The Convey bootstrap paymaster was deployed on X Layer mainnet. Transaction
`0x9a8cf11980eb29f67b5419ef90e4784b15bf9663ff78c7a958783b07fe6ea4d8` has a
successful receipt at block `71416764`; it created
`0x6647cef848fc54b0c821f91a88d83227f65e36b9`. The transaction used `1388351`
gas at `20000001` wei/gas (`0.000027767021388351 OKB`). The deployed runtime
bytecode is 6,110 bytes. Live getters confirmed the owner, dedicated sponsor
signer, selected receiver account, canonical v0.7 EntryPoint, sponsor nonce
`0`, verification gas limit `200000`, and max-cost cap `0.01 OKB`. The deployer
balance after deployment was `0.001072232978611649 OKB`. The paymaster address
is saved as `BOOTSTRAP_PAYMASTER_ADDRESS` in the owner-only local `.env`.

The first `pnpm bootstrap:deploy` process exited during its post-receipt
`expectedCallDataHash()` readback even though the deployment receipt had
succeeded. Subsequent live reads returned the expected state. The deploy script
now preserves and prints the mined receipt details even if that optional
readback is temporarily unavailable, and it refuses to deploy again when the
configured paymaster address already has bytecode. The paymaster was then
funded with a `0.0002 OKB` EntryPoint deposit and a `1` wei stake (both
successful receipts are recorded here: deposit transaction
`0xdfd03036947e8b3939035b3e8a1bd0d2c1d726393bcd56675c915e1e42e3546d` and
stake transaction
`0x60f513d3605cd2c51687f0dd971cce8823908267ef80301e1716d548fe4151da`.
The remaining deposit after the sponsored operation is recorded above.

### Live sponsored bootstrap operation — 2026-09-23

The final one-time operation was accepted by the private OKBund endpoint and
included on X Layer mainnet:

- UserOperation hash:
  `0x1361ecee72221c81ee911f1446e3531e6086ffa9b2bee87bec22cd0ecc7f413c`
- Bundler transaction:
  `0xfdb3ef41083b02282a304c948194b1ec9dca42d14f5fec258b8a12c2e7b4df09`
- Block: `71422410` (`0x441d1ca`); transaction status `0x1`
- Sender: `0x63B2A84d47cb07fb18EE72Ec386893506Fd963db`
- EntryPoint: `0x0000000071727de22e5e9d8baF0edAc6f37da032`
- Paymaster: `0x6647cef848fc54b0c821f91a88d83227f65e36b9`
- OKBund receipt: `success = true`, `actualGasUsed = 0x55602`,
  `actualGasCost = 0x65c6885b002` wei

The successful transaction emitted the EntryPoint `UserOperationEvent` for
the recorded hash and deployed the counterfactual receiver. A read-only live
check found receiver bytecode (93 bytes), EntryPoint nonce `1`, and the
paymaster authorization marked consumed. Earlier expired attempts were not
treated as success and are excluded from this evidence.

### Bundler RPC capability probe

On 2026-09-23, the keyed NodeFlare X Layer endpoint was probed using the local
`NODEFLARE_API_KEY`. `debug_traceCall` with a JavaScript tracer and
`debug_traceCall` with state overrides both succeeded on chain `196`, satisfying
the two trace capabilities required by OKBund safe mode. `trace_call` returned
JSON-RPC `-32601`; the current OKBund validation path requires the two successful
`debug_traceCall` capabilities. The endpoint path is redacted from the recorded
result so the API key cannot be committed. The raw capability report is in
[`docs/verification.rpc-capabilities.json`](verification.rpc-capabilities.json).
The operator runbook now uses this verified keyed endpoint; a private full node
is an alternative, not a prerequisite.

The probe derives `https://rpc.nodeflare.app/xlayer/v1/<key>` from
`NODEFLARE_API_KEY` when `BUNDLER_EXECUTION_RPC_URL` is not set. The X Layer
endpoint and keyed-path format are documented by
[NodeFlare](https://nodeflare.app/chains/xlayer).

### Bootstrap paymaster implementation and local verification

On 2026-09-23, Convey added a chain-196-only v0.7 bootstrap paymaster with a
fixed counterfactual sender/init-code hash, an internally fixed one-call
address-zero probe, a contract-bounded 300-second sponsor authorization window, a hard `maxCost` cap,
a cap on deposits made through the paymaster, and a one-use authorization flag.
EntryPoint permits direct third-party deposits to the paymaster address, so its
total deposit balance can exceed that deposit guard. Its sponsor signature
binds all operation gas fields, account nonce, EntryPoint, chain, paymaster,
validity bounds, and sponsor nonce. It returns an empty `postOp` context.

The local code compiled with Solidity 0.8.23 using Foundry 1.8.3. `forge test`
passed all 12 local tests, including owner-only deposit withdrawal and a direct
EntryPoint deposit that bypasses the paymaster deposit guard. The expiration case uses a local EntryPoint stub
to check the contract's packed validity window; it is not a test against the
deployed EntryPoint. `pnpm test` passed all 14 TypeScript test cases, including
recovery of the OKX owner signature against the EIP-191 digest and a fixed
cross-language no-op calldata hash. `git diff --check`
passed. The account-operation builder had checked an EIP-191 signature against
the unwrapped digest; that check is corrected and covered by a local
cryptographic test.

Deployment, funding, operation construction, and submission commands exist as
`pnpm bootstrap:deploy`, `pnpm bootstrap:fund`, `pnpm bootstrap:build`,
`pnpm bootstrap:submit`, and `pnpm bootstrap:wait`. The mainnet deployment,
paymaster funding/staking, and successful sponsored operation are recorded
above. The VPS OKBund endpoint is loopback-only and was accessed through a
temporary SSH tunnel. The build command requires explicit gas and fee values
from live observations and refuses to use defaults. The operation builder uses
the contract's maximum 300-second authorization window, including a five-second
clock-skew allowance.
The operator scripts also reject address reuse between the receiver owner,
paymaster owner, and sponsor signer. `pnpm operator:addresses` rejects duplicate
addresses across the configured bundler, deployer, bootstrap paymaster signer,
and smart-account owner keys. Bootstrap commands use
`BOOTSTRAP_PAYMASTER_ADDRESS`, separate from the claim relay's
`PAYMASTER_ADDRESS`.
Local compilation and tests do not establish gas adequacy, security audit
status, bundler acceptance, or mainnet success.

### Bootstrap review follow-up (2026-09-23)

The project builder reviewed the bootstrap contract, tests, deploy/fund/build/submit scripts, and
the pinned OKX wallet plus official EntryPoint v0.7 source. The pinned OKX
wallet decodes `Call[]` from `userOp.callData[4:]`, and EntryPoint routes the
`executeUserOp` selector to that wallet method. The local probe encoding
therefore matches the source shape. EntryPoint's prefund formula and packed
validity fields also match the implementation. This is an in-house source
review, not a live OKBund integration test or a third-party audit.

The review corrected the deposit-cap description: anyone can deposit to the
paymaster directly through EntryPoint, while the contract guards deposits
through its own `deposit()` method. The per-operation `maxCost` cap remains
enforced on chain. The submit script now re-reads the operation hash from the
live EntryPoint before sending to OKBund, and the fund script checks both
transaction receipts for success. Follow-up changes validate the signed
operation file without following symlinks, wait for an inclusion receipt, and
report the UserOperation result plus transaction hash and block number. A
separate wait command checks inclusion without resending. The receipt parser
normalizes OKBund's numeric gas fields to the standard hex-quantity form. The
paymaster deployment and successful sponsored operation are recorded above.

### Account-standard decision

The specification asks for an “OKX-native ERC-7579” account. The deployed [OKX Smart Wallet source](https://github.com/okxlabs/okx-smart-wallet-evm) inspected at revision `95aa59bbc22acd4573a9932e959384fe56c7b543` is ERC-4337 v0.7 and has modular owner, validator, hook, allowance, execution, and nonce managers, but it does **not** implement the ERC-7579 account interface (`accountId`, `supportsModule`, `installModule`, `uninstallModule`, or `executeFromExecutor`). Its expiring owners, hooks, and token allowances may support a tightly scoped recurring-gift key, but that path is an OKX-specific integration rather than ERC-7579 interoperability.

Decision: use the deployed OKX wallet and describe it accurately as an
OKX-specific modular ERC-4337 v0.7 account. The specification expressly permits
this resolution. Calling the current OKX wallet ERC-7579 would be incorrect.
Recurring gifts remain contingent on tests proving that the wallet's expiring
owner/hook controls can enforce the required scope and revocation behavior.

The self-hosted bundler/paymaster deployment is live and the sponsored
mainnet UserOperation succeeded. Product contract implementation may now begin,
with the separate claim-paymaster reserve and receiver recovery work still
requiring its own design and verification.

### Product escrow and claim paymaster deployment — 2026-09-23

The product contracts were deployed to X Layer mainnet with the deployer
`0x5fA8199ad34373A063c96D24a1BF5b4a105D3399`. The deployment script resumed
after an RPC nonce race without submitting duplicate registry or paymaster
transactions. Each receipt was read back from the live chain.

| Component | Address | Transaction | Block |
|---|---|---|---:|
| `AssetRegistry` | `0x156d160e004B7fb2021CFCA8fC6cF069c3b8b029` | [`0x4e4f6741aac80360768bc41b02c932b785436798383a67b70f51cee20cccb4fb`](https://www.oklink.com/xlayer/tx/0x4e4f6741aac80360768bc41b02c932b785436798383a67b70f51cee20cccb4fb) | 71,427,675 |
| `ConveyClaimPaymasterV07` | `0xe6913061bc2021B0dfdeECB867F7a9F5F77236B6` | [`0x48b181e0c76adf143d821e003f6032b38fdd022369d5ca01a755a4e2ff575a77`](https://www.oklink.com/xlayer/tx/0x48b181e0c76adf143d821e003f6032b38fdd022369d5ca01a755a4e2ff575a77) | 71,427,678 |
| `GiftEscrow` | `0xaa396c814d38cf9e707c6bbc0635f1ee7d584062` | [`0x82e383ebff2bd146e07c38efdaafba475c328b00575a046794c56f9b333c24f3`](https://www.oklink.com/xlayer/tx/0x82e383ebff2bd146e07c38efdaafba475c328b00575a046794c56f9b333c24f3) | 71,427,817 |

The one-time paymaster-to-escrow binding succeeded in transaction
[`0x2d2184575eacb6787e446a5eff915e4ae708289f26ef3dd036fc220cae0e24e3`](https://www.oklink.com/xlayer/tx/0x2d2184575eacb6787e446a5eff915e4ae708289f26ef3dd036fc220cae0e24e3)
at block `71,427,819`. Live getters confirmed the registry and paymaster
owners, the dedicated verifying signer, and both escrow cross-references.

The product paymaster was funded separately from sender gift reserves. Its
configured `minimumReserve` and `maxClaimCost` are each `20,000,000,000,000`
wei (`0.00002 OKB`), based on the observed X Layer floor and the successful
bootstrap operation's live gas cost. The EntryPoint deposit is
`200,000,000,000,000` wei (`0.0002 OKB`), and the paymaster is staked with
`1` wei for an `86,400` second unstake delay. The deposit transaction is
[`0x87d2c599accfa72116cdae203b226f09795778f71ef8d57ba4e43128d9231663`](https://www.oklink.com/xlayer/tx/0x87d2c599accfa72116cdae203b226f09795778f71ef8d57ba4e43128d9231663)
at block `71,427,845`; the stake transaction is
[`0x3979673a21872848f9fe570bf7b4a3880f662d61a75d8a978cead8a1a824bd4a`](https://www.oklink.com/xlayer/tx/0x3979673a21872848f9fe570bf7b4a3880f662d61a75d8a978cead8a1a824bd4a)
at block `71,427,847`. The live EntryPoint readback reports a `0.0002 OKB`
deposit, `staked = true`, and the configured delay. The deployer balance after
these writes was `0.000573725693686283 OKB`.

This evidence proves deployment, cross-contract binding, and EntryPoint
funding. The later Gift ID `2` evidence below proves the private claim gateway,
real token gift, UserOperation, and reserve settlement on mainnet.

The three live xStock wrapper entries were then registered and enabled by the
registry owner. NVDAx and AAPLx point at the verified X Layer Uniswap
`SwapRouter02` (`0x4f0c28f5926afda16bf2506d5d9e57ea190f9bca`) for cash-out
routing. TSLAx is certified and giftable but has a zero cash-out route because
the pinned executable quotes show severe liquidity exhaustion; the receiver
must be shown a hold-only path until a fresh quote passes policy.

| Asset | Registration transaction | Block | Gas used |
|---|---|---:|---:|
| NVDAx | [`0x00b54d5f264d67331b5d0b1a186e6c1af5e65e9fd923d29d51ec5a63df390e42`](https://www.oklink.com/xlayer/tx/0x00b54d5f264d67331b5d0b1a186e6c1af5e65e9fd923d29d51ec5a63df390e42) | 71,428,791 | 197,726 |
| TSLAx | [`0x57aae224e03f09784af565181d4bde1b4fbd35638b6e6243f3c93a7a976d94dc`](https://www.oklink.com/xlayer/tx/0x57aae224e03f09784af565181d4bde1b4fbd35638b6e6243f3c93a7a976d94dc) | 71,428,792 | 197,498 |
| AAPLx | [`0xadcf09069dbf7ac5105d91bd4b1ca73e51b44537559d50c2af488ca8ed4ba12c`](https://www.oklink.com/xlayer/tx/0xadcf09069dbf7ac5105d91bd4b1ca73e51b44537559d50c2af488ca8ed4ba12c) | 71,428,795 | 197,714 |

Live registry reads after each receipt confirmed `certified = true`,
`enabled = true`, the issuer `asset()` underlying, 18 decimals, and the route
policy above. The registration records are also in
[`docs/product-deployment.json`](product-deployment.json).

The off-chain claim authorization codec was compared with the deployed
paymaster's `accountOperationHash` and `authorizationDigest` view functions.
Both hashes matched for a packed v0.7 operation. The first live claim
UserOperation failed and was reclaimed; the later Gift ID `2` operation
succeeded and its evidence is recorded below.

### Sender asset acquisition — 2026-09-24

The first sender-funded asset acquisition was completed on X Layer mainnet.
At block `71458391`, the sender wallet held exactly `7` USDT0. The exact-token
approval to the verified SwapRouter02 succeeded in transaction
`0xade67ce967bf701f92b7574b55c7840939f4f0647c83a281770308ce57330130` at block
`71459201`, using `53365` gas.

A fresh live quote selected the direct USDT0→NVDAx pool at the 0.3% fee tier:
`7` USDT0 quoted to `0.030965586663211895` NVDAx. The single-hop
`exactInputSingle` swap succeeded in transaction
`0xbd4f39e17fb02851abe6affb4b4a6e57a5adcf0105cb9dfdcae89be39a7cadae` at block
`71459663`, using `175721` gas. Receipt logs show `7` USDT0 transferred from
the sender to the pool and `0.030965586663211895` NVDAx transferred from the
pool to the sender.

A final private-RPC read at block `71459762` reported `0` USDT0,
`0.030965586663211895` NVDAx, `0.000557285212864259` OKB, and zero remaining
USDT0 allowance to the router. This proves the live asset acquisition, not a
gift creation, private claim, reclaim, or product UserOperation.

### Live NVDAx gift creation — 2026-09-24

The sender then approved exactly `0.030965586663211895` NVDAx to the deployed
`GiftEscrow` in transaction
[`0xcc4b7c963e4ec26f36cb508e402a8bc7412a15811ad8e061fb6cc021e7dcf1ac`](https://www.oklink.com/xlayer/tx/0xcc4b7c963e4ec26f36cb508e402a8bc7412a15811ad8e061fb6cc021e7dcf1ac)
at block `71460696`, using `53693` gas. The approval was confirmed on the
private execution RPC before the gift call.

`GiftEscrow.createGift` then succeeded in transaction
[`0x58921e5bc238bf36534ff6c8fd828dd1af17808e54aa3900cad5c6f9e609bf9e`](https://www.oklink.com/xlayer/tx/0x58921e5bc238bf36534ff6c8fd828dd1af17808e54aa3900cad5c6f9e609bf9e)
at block `71460786`, using `338499` gas. The immediate post-creation record
before the claim attempt was:

- Gift ID: `1`; immediate post-creation state: `Open`; `nextGiftId`: `2`
- Asset: NVDAx `0xa8ddb5cd96b5222afe198316e9a57caa642850d5`
- Amount: `0.030965586663211895` NVDAx
- Reserve: `0.00002 OKB`; paymaster reserve remaining: `0.00002 OKB`
- Expiry: Unix `1790834618` (`2026-10-01T06:03:38Z`); no code hash
- Sender NVDAx balance: `0`; escrow NVDAx balance:
  `0.030965586663211895`
- Paymaster `openReserveTotal`: `0.00002 OKB`; EntryPoint deposit:
  `0.00022 OKB`

This was the verified state immediately after creation. The first accepted
operation expired before inclusion and was removed from OKBund's transient
mempool; it made no chain-state change. A fresh operation was then submitted
through Convey's private gateway and OKBund:

- UserOperation: `0xd3efe7e60f40e556d6f4fea79335723f0f5aab8924c0b015393a2451534346b1`
- Bundle transaction: [`0xc4610b7cc244c7ec728c486d90493e94bfa976de9fcf4cfa46e04f744c1a05f6`](https://www.oklink.com/xlayer/tx/0xc4610b7cc244c7ec728c486d90493e94bfa976de9fcf4cfa46e04f744c1a05f6)
- Block: `71463789`; bundle gas used: `311956`
- `UserOperationEvent.success`: `false`; actual gas used: `365198`; actual
  cost: `7303960365198` wei
- Revert selector: `0x045c4b02`, decoded as `TokenTransferFailed()`

The transaction exposed the claim secret but transferred no NVDAx. A direct
historical token-transfer call to the receiver succeeded within `120000` gas,
so recipient restrictions were ruled out. The evidence instead points to the
full account-to-escrow-to-token execution exhausting the account-level call
gas. A top-level `handleOps` simulation is insufficient because EntryPoint can
complete while emitting a failed `UserOperationEvent`; preflight must inspect
that event explicitly.

The sender immediately removed the exposed claim surface by reclaiming Gift ID
`1` in transaction
[`0x6add4c95079719111eab9b3ebd9c7b6a6cc91df9b8e58384c4d57f12fc4fff9f`](https://www.oklink.com/xlayer/tx/0x6add4c95079719111eab9b3ebd9c7b6a6cc91df9b8e58384c4d57f12fc4fff9f)
at block `71463978`, using `153703` gas. At final verification block
`71464037`, Gift ID `1` was `Reclaimed`, the sender held all
`0.030965586663211895` NVDAx, escrow held zero, and `openReserveTotal`,
`inFlightTotal`, and `pendingRefundTotal` were zero. The receiver EntryPoint
nonce was `2`; sponsor nonce `0` was consumed; the paymaster deposit was
`0.000198988059949403 OKB`. The exposed secret is permanently retired and its
value remains omitted from the repository.

### Successful Gift ID 2 claim — 2026-09-24

Gift ID `2` used a fresh secret and the same exact
`0.030965586663211895` NVDAx amount recovered from Gift ID `1`. The sender's
exact approval succeeded in transaction
[`0x1a11677c158c7486bf635d283b3dc917ce0c0bb3ade5baf24dac2ced04366468`](https://www.oklink.com/xlayer/tx/0x1a11677c158c7486bf635d283b3dc917ce0c0bb3ade5baf24dac2ced04366468)
at block `71480514`. `createGift` succeeded in transaction
[`0x67d63026316a0d929edd434436806f6dca4fe8d07aa0c1fd839f330274e01f68`](https://www.oklink.com/xlayer/tx/0x67d63026316a0d929edd434436806f6dca4fe8d07aa0c1fd839f330274e01f68)
at block `71480785`, with the configured `0.00002 OKB` reserve.

The final gasless sponsored claim was accepted by Convey's ephemeral localhost
gateway and private OKBund, then forced from OKBund's manual queue using its
supported `debug_bundler_sendBundleNow` RPC:

- UserOperation:
  `0x1ed2abda8798479bd1dd74c81073007ca791a292b1c727af198da552e3a94403`
- Bundle transaction:
  [`0x05179c720349f882b589562ad56df7c57385094233dabc6559947e5c8ea6945b`](https://www.oklink.com/xlayer/tx/0x05179c720349f882b589562ad56df7c57385094233dabc6559947e5c8ea6945b)
- Block: `71489278` (`0x442d6fe`); transaction status: `0x1`
- `UserOperationEvent.success`: `true`
- Actual gas used: `389113`; actual cost: `7821171300000` wei

Receipt logs contain the exact NVDAx transfer from escrow to receiver, the
Gift ID `2` claim event, paymaster reserve settlement, and the successful
EntryPoint event. Final live reads found Gift ID `2` `Claimed`, receiver NVDAx
balance `30965586663211895`, escrow and sender NVDAx balances `0`, all three
reserve totals `0`, and receiver EntryPoint nonce `3`.

Before submission, NodeFlare's exact `handleOps` trace exposed an OKBund tracer
false positive: dynamic CALL cost reporting triggered the upstream
`gas < cost` OOG heuristic even though no EVM fault occurred. The deployed
safe-mode source now marks OOG from an actual tracer fault and retains the
SSTORE gas-floor rule. The two-file change passed the pinned OKBund Maven
reactor build. This is an operational compatibility patch, not an upstream or
third-party audit. The claim proof used a temporary localhost gateway before
the persistent service was installed. The persistent private gateway is now
deployed on the supplied VPS and the public web edge is recorded below; no
public gateway endpoint or browser mainnet claim is claimed.

### Web surface deployment — 2026-09-24

The production Next.js build was deployed to the supplied Lightsail VPS as
`convey-web.service`, running as the dedicated `convey-web` user on loopback
`127.0.0.1:3001`. Its server environment contains only the loopback relay URL
and the existing gateway bearer token; no operator or NodeFlare credential is
passed to the web process.

Nginx was configured as a separate site and Let's Encrypt issued a certificate
for [`https://convey.13-62-181-128.sslip.io`](https://convey.13-62-181-128.sslip.io)
at approximately `2026-09-24T16:48:25Z`. The certificate expires on
`2026-12-23` and automatic renewal is enabled. Live checks returned:

- public HTTPS GET `/`: HTTP `200`;
- public GET `/api/relay/not-allowed`: HTTP `404`;
- `convey-web.service`: active;
- `convey-relayer.service`: active;
- `convey-okbund.service`: active.

This proves the web deployment and the server-side relay boundary. It does not
prove a real browser PRF ceremony or a browser-to-browser mainnet claim; no such
claim is recorded yet.

The receiver recovery update was redeployed and returned a public HTTPS `200`
at `2026-09-24T17:02:33Z`. This update adds only encrypted-bundle handling and
same-device unlock/recovery UI; it does not change the deployed contracts or
claim paymaster.

## Sources

- [X Layer official RPC configuration](https://web3.okx.com/onchainos/dev-docs/xlayer/developer/setup-rpc/setup-rpc)
- [X Layer account-abstraction overview](https://web3.okx.com/xlayer/docs/developer/tools/account-abstraction-overview)
- [Uniswap V3 X Layer deployments](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-xlayer-deployments)
- [OKX X Layer token list](https://github.com/okx/xlayer-tokenlist)
- [xStocks public asset API: NVDAx](https://api.backed.fi/api/v2/public/assets/NVDAx)
- [OKX Smart Wallet source and deployments](https://github.com/okxlabs/okx-smart-wallet-evm)
- [OKX OKBund source](https://github.com/okx/OKBund)
- [ERC-4337 v0.7 EntryPoint prefund and time-range checks](https://github.com/eth-infinitism/account-abstraction/blob/v0.7.0/contracts/core/EntryPoint.sol)
- [ERC-4337 v0.7 validation-data packing](https://github.com/eth-infinitism/account-abstraction/blob/v0.7.0/contracts/core/Helpers.sol)
- [X Layer self-hosted RPC toolkit](https://github.com/okx/xlayer-toolkit/tree/main/rpc-setup)
- [ERC-7579 specification](https://eips.ethereum.org/EIPS/eip-7579)
