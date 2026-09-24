# Connected-wallet sender flow

The sender path uses an existing EIP-1193 wallet provider. OKX Wallet is the
first-class deployment target, but the module accepts any standard provider.
The receiver never connects to this path.

`ConnectedWalletSender` is deliberately chain-backed:

1. `connect()` requests the sender's existing account and rejects any chain
   other than X Layer `196`.
2. `readAsset(token)` reads the registry entry, token metadata, sender balance,
   and escrow allowance from live contracts. The registry must report the asset
   as certified and enabled.
3. `createGift()` generates the bearer secret in the browser, hashes only the
   secret/code/note for the contract, reads the claim paymaster's live minimum
   reserve, and performs exact approval before calling `GiftEscrow.createGift`.
4. The successful receipt is required to contain exactly one `GiftCreated`
   event. The returned `claimLink` is the only place the secret is exposed.
5. `readGift()` provides sender status and `reclaimGift()` uses the escrow's
   sender-only refund path.

The module does not fetch a headline stock price, infer a balance, or fabricate
a reserve. A QR renderer belongs in the browser application and should encode
the returned `claimLink` verbatim; no QR payload is stored on chain.

Example wiring from a browser connector:

```ts
import { createConnectedWalletSender } from "convey/sender";

const sender = createConnectedWalletSender({
  rpcUrl: process.env.NEXT_PUBLIC_XLAYER_RPC_URL!,
  provider: okxWalletProvider,
  deployment: {
    registry: runtimeDeployment.registry,
    escrow: runtimeDeployment.escrow,
    claimPaymaster: runtimeDeployment.claimPaymaster,
    claimBaseUrl: window.location.origin,
  },
});

await sender.connect();
const gift = await sender.createGift({
  asset: selectedAsset,
  amount: amountInput,
  note: optionalNote,
  expiry: optionalExpiry,
});

// Share gift.claimLink through the sender's existing chat channel.
```

The runtime deployment addresses are configuration, not constants in the
sender module. They must come from the verified deployment record or a live
deployment endpoint. The browser must never receive the gateway bearer token,
NodeFlare URL, bundler URL, or any operator private key.
