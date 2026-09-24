"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatUnits, isAddress, type Address, type EIP1193Provider } from "viem";
import { ConnectedWalletSender, type SenderAsset } from "@/src/sender";
import { useRouter } from "next/navigation";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

function publicAddress(value: string | undefined, name: string): Address {
  if (!value || !isAddress(value)) throw new Error(`${name} is not configured with a live address`);
  return value as Address;
}

function configuredAssets(): Address[] {
  return [
    process.env.NEXT_PUBLIC_CONVEY_WNVDA_TOKEN_ADDRESS,
    process.env.NEXT_PUBLIC_CONVEY_WAAPL_TOKEN_ADDRESS,
    process.env.NEXT_PUBLIC_CONVEY_WTSLA_TOKEN_ADDRESS,
  ].filter((value): value is string => typeof value === "string" && isAddress(value)) as Address[];
}

function shortAddress(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export default function HomePage() {
  const router = useRouter();
  const senderFlow = useRef<ConnectedWalletSender | undefined>(undefined);
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [sender, setSender] = useState<Address>();
  const [assetAddress, setAssetAddress] = useState<Address>();
  const [asset, setAsset] = useState<SenderAsset>();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");
  const [createdLink, setCreatedLink] = useState("");
  const [sending, setSending] = useState(false);
  const assets = useMemo(configuredAssets, []);

  function openGift(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      const url = new URL(link.trim());
      if (!/^\/g\/[0-9a-fA-F]{64}\/?$/u.test(url.pathname) || !/^\d+$/.test(url.searchParams.get("giftId") ?? "")) {
        throw new Error("Paste a complete Convey gift link.");
      }
      router.push(`${url.pathname}${url.search}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Paste a complete Convey gift link.");
    }
  }

  async function connectSender() {
    setError("");
    setStatus("Opening your connected wallet…");
    try {
      if (!window.ethereum) throw new Error("Install or unlock an existing EVM wallet to send a gift.");
      const flow = new ConnectedWalletSender({
        rpcUrl: process.env.NEXT_PUBLIC_XLAYER_RPC_URL ?? (() => { throw new Error("NEXT_PUBLIC_XLAYER_RPC_URL is not configured"); })(),
        provider: window.ethereum,
        deployment: {
          registry: publicAddress(process.env.NEXT_PUBLIC_CONVEY_ASSET_REGISTRY_ADDRESS, "NEXT_PUBLIC_CONVEY_ASSET_REGISTRY_ADDRESS"),
          escrow: publicAddress(process.env.NEXT_PUBLIC_CONVEY_CLAIM_ESCROW_ADDRESS, "NEXT_PUBLIC_CONVEY_CLAIM_ESCROW_ADDRESS"),
          claimPaymaster: publicAddress(process.env.NEXT_PUBLIC_CONVEY_CLAIM_PAYMASTER_ADDRESS, "NEXT_PUBLIC_CONVEY_CLAIM_PAYMASTER_ADDRESS"),
          claimBaseUrl: window.location.origin,
        },
      });
      const address = await flow.connect();
      senderFlow.current = flow;
      setSender(address);
      setAssetAddress(assets[0]);
      setStatus("Connected. Reading certified assets from the live registry…");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The wallet could not connect.");
      setStatus("");
    }
  }

  useEffect(() => {
    if (!senderFlow.current || !assetAddress) return;
    let cancelled = false;
    void senderFlow.current.readAsset(assetAddress).then((value) => {
      if (!cancelled) {
        setAsset(value);
        setStatus("Live asset data is ready.");
      }
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "The live asset could not be read.");
    });
    return () => { cancelled = true; };
  }, [assetAddress]);

  async function createGift(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!senderFlow.current || !asset) return;
    setError("");
    setCreatedLink("");
    setSending(true);
    setStatus("Preparing the live escrow transaction…");
    try {
      const gift = await senderFlow.current.createGift({ asset: asset.token, amount, note: note.trim() || undefined });
      setCreatedLink(gift.claimLink);
      setStatus(`Gift ${gift.giftId.toString()} is live on X Layer. Share this link.`);
      setAmount("");
      setNote("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The gift transaction did not complete.");
      setStatus("");
    } finally {
      setSending(false);
    }
  }

  return (
    <main>
      <div className="network-bar">X Layer mainnet · chain 196 · gasless receiver claim</div>
      <div className="shell">
        <nav className="nav"><span className="wordmark">convey.</span><span className="nav-note">a stock gift, in one link</span></nav>
        <section className="hero">
          <div>
            <div className="eyebrow">Real assets, warmly delivered</div>
            <h1>Send a stock like you send a photo.</h1>
            <p className="lede">A sender pays. A receiver opens a link. The asset arrives in a smart account they never had to set up.</p>
            <form className="link-form" onSubmit={openGift}>
              <input aria-label="Gift link" value={link} onChange={(event) => setLink(event.target.value)} placeholder="Paste a Convey gift link" inputMode="url" />
              <button className="button" type="submit">Open gift</button>
            </form>
            {error ? <p className="error" role="alert">{error}</p> : <p className="fine-print">No wallet. No OKB. No gas. The link is the gift.</p>}
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="art-card back"><div className="art-kicker">X Layer / 196</div></div>
            <div className="art-card main"><div className="art-kicker">A gift for you</div><div className="art-name">Nvidia</div><div className="art-value">$ —</div><div className="art-footer"><span>tokenized exposure</span><span>gasless claim</span></div></div>
          </div>
        </section>

        <section className="sender-panel" aria-labelledby="send-heading">
          <div className="eyebrow">For the sender</div>
          <h2 id="send-heading">Gift from the wallet you already use.</h2>
          <p className="panel-copy">Connect an existing wallet, choose a certified asset, and fund a real claim. Convey never creates or holds the sender&apos;s key.</p>
          {!sender ? <button className="button" type="button" onClick={connectSender}>Connect wallet</button> : (
            <>
              <div className="sender-meta"><span>Connected {shortAddress(sender)}</span><span>{status}</span></div>
              <div className="sender-asset-row">
                <label>Asset<select value={assetAddress ?? ""} onChange={(event) => setAssetAddress(event.target.value as Address)}>{assets.map((value) => <option key={value} value={value}>{shortAddress(value)}</option>)}</select></label>
                {asset ? <span className="live-balance">Live balance: {formatUnits(asset.balance, asset.decimals)} {asset.symbol}</span> : null}
              </div>
              {asset ? <form className="gift-form" onSubmit={createGift}>
                <label>Amount<input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder={`e.g. 0.01 ${asset.symbol}`} inputMode="decimal" required /></label>
                <label>Note <span className="optional">optional</span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Happy birthday" /></label>
                <button className="button" type="submit" disabled={sending}>{sending ? "Sending…" : "Create real gift"}</button>
              </form> : null}
              {createdLink ? <div className="created-link"><span>Gift link</span><a href={createdLink}>{createdLink}</a></div> : null}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
