"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatUnits, isAddress, type Address, type Hex } from "viem";
import { ConnectedWalletSender, type SenderAsset } from "@/src/sender";
import { LiveTicker } from "../components/LiveTicker";
import { SiteHeader } from "../components/SiteHeader";
import { XStockArt } from "../components/XStockArt";
import { connectOkxWallet, OkxWalletError, type OkxWalletUnavailable } from "../lib/okx-wallet";
import { EXPLORER, XSTOCKS, formatUsd, useLiveQuotes, type XStock } from "../lib/xstocks";

function publicAddress(value: string | undefined, name: string): Address {
  if (!value || !isAddress(value)) throw new Error(`${name} is not configured`);
  return value as Address;
}

const DEPLOYMENT = {
  registry: process.env.NEXT_PUBLIC_CONVEY_ASSET_REGISTRY_ADDRESS,
  escrow: process.env.NEXT_PUBLIC_CONVEY_CLAIM_ESCROW_ADDRESS,
  claimPaymaster: process.env.NEXT_PUBLIC_CONVEY_CLAIM_PAYMASTER_ADDRESS,
};

function shortAddress(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

interface CreatedGift {
  id: string;
  link: string;
  transaction: Hex;
}

export default function AppPage() {
  const router = useRouter();
  const quotes = useLiveQuotes();
  const sender = useRef<ConnectedWalletSender | undefined>(undefined);

  const [account, setAccount] = useState<Address>();
  const [walletIcon, setWalletIcon] = useState<string>();
  const [connecting, setConnecting] = useState(false);
  const [unavailable, setUnavailable] = useState<OkxWalletUnavailable>();

  const [selected, setSelected] = useState<XStock>(XSTOCKS[0]);
  const [asset, setAsset] = useState<SenderAsset>();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [created, setCreated] = useState<CreatedGift>();
  const [copied, setCopied] = useState(false);

  const [giftLink, setGiftLink] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function connect() {
    setError("");
    setUnavailable(undefined);
    setConnecting(true);
    try {
      const wallet = await connectOkxWallet();
      const flow = new ConnectedWalletSender({
        rpcUrl: process.env.NEXT_PUBLIC_XLAYER_RPC_URL ?? "https://rpc.xlayer.tech",
        provider: wallet.provider,
        deployment: {
          registry: publicAddress(DEPLOYMENT.registry, "Asset registry"),
          escrow: publicAddress(DEPLOYMENT.escrow, "Gift escrow"),
          claimPaymaster: publicAddress(DEPLOYMENT.claimPaymaster, "Claim paymaster"),
          claimBaseUrl: window.location.origin,
        },
      });
      setAccount(await flow.connect());
      setWalletIcon(wallet.icon);
      sender.current = flow;
    } catch (cause) {
      if (cause instanceof OkxWalletError && cause.unavailable) setUnavailable(cause.unavailable);
      setError(errorMessage(cause, "OKX Wallet could not connect."));
    } finally {
      setConnecting(false);
    }
  }

  // The landing page's "Connect OKX Wallet" arrives with ?connect=1 from a user click.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("connect") !== "1") return;
    window.history.replaceState(null, "", "/app");
    void connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const flow = sender.current;
    if (!account || !flow || !selected.token) return;
    let cancelled = false;
    setAsset(undefined);
    setStatus(`Reading ${selected.ticker} from the X Layer registry…`);
    flow.readAsset(selected.token)
      .then((value) => { if (!cancelled) { setAsset(value); setStatus(""); } })
      .catch((cause: unknown) => { if (!cancelled) { setError(errorMessage(cause, "The asset could not be read.")); setStatus(""); } });
    return () => { cancelled = true; };
  }, [account, selected]);

  function fillAmount(fraction: bigint) {
    if (!asset) return;
    setAmount(formatUnits((asset.balance * fraction) / 100n, asset.decimals));
  }

  async function createGift(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sender.current || !asset) return;
    setError("");
    setCreated(undefined);
    setSending(true);
    setStatus("Confirm in OKX Wallet. The gift is created in one escrow transaction.");
    try {
      const gift = await sender.current.createGift({ asset: asset.token, amount, note: note.trim() || undefined });
      setCreated({ id: gift.giftId.toString(), link: gift.claimLink, transaction: gift.createTransaction });
      setAsset({ ...asset, balance: asset.balance - gift.amount });
      setAmount("");
      setNote("");
      setStatus("");
    } catch (cause) {
      setError(errorMessage(cause, "The gift transaction did not complete."));
      setStatus("");
    } finally {
      setSending(false);
    }
  }

  async function copyLink() {
    if (!created) return;
    await navigator.clipboard.writeText(created.link);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  function openGift(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      const url = new URL(giftLink.trim());
      if (!/^\/g\/[0-9a-fA-F]{64}\/?$/u.test(url.pathname) || !/^\d+$/u.test(url.searchParams.get("giftId") ?? "")) throw new Error();
      router.push(`${url.pathname}${url.search}`);
    } catch {
      setError("Paste a complete Convey gift link.");
    }
  }

  const walletButton = account ? (
    <span className="wallet-chip">
      {walletIcon ? <img src={walletIcon} alt="" width={18} height={18} /> : <span className="wallet-dot" />}
      {shortAddress(account)}
      <span className="chain-tag">X Layer</span>
    </span>
  ) : (
    <button className="button button-light" type="button" onClick={connect} disabled={connecting}>
      {connecting ? "Check OKX Wallet…" : "Connect OKX Wallet"}
    </button>
  );

  return (
    <main className="page app-page">
      <LiveTicker />
      <SiteHeader variant="app">{walletButton}</SiteHeader>

      <section className="app-intro">
        <span className="eyebrow"><i className="pulse" />Send studio · X Layer mainnet</span>
        <h1>Send an <span className="gradient-text">xStock</span>.</h1>
        <p className="section-copy">Fund a gift from OKX Wallet. Your recipient claims it gasless with a passkey.</p>
        {unavailable ? <WalletHelp unavailable={unavailable} /> : null}
        {error && !account ? <p className="notice notice-error" role="alert">{error}</p> : null}
      </section>

      <section className="section studio" id="send" aria-label="Send studio">
        <div className="xstock-grid" role="radiogroup" aria-label="xStock">
          {XSTOCKS.map((stock) => (
            <button
              key={stock.ticker}
              type="button"
              role="radio"
              aria-checked={selected.ticker === stock.ticker}
              className={`xstock-option ${selected.ticker === stock.ticker ? "is-selected" : ""}`}
              onClick={() => { setSelected(stock); setAmount(""); }}
              disabled={!stock.token}
            >
              <XStockArt stock={stock} />
              <span className="xstock-name"><b>{stock.ticker}</b>{stock.company}</span>
              <span className="xstock-price">{quotes[stock.ticker] !== undefined ? formatUsd(quotes[stock.ticker]!) : "—"}<small>per share</small></span>
            </button>
          ))}
        </div>

        {!account ? (
          <div className="studio-locked">
            <p>Connect OKX Wallet on X Layer to fund a gift. Convey never holds your key.</p>
            <button className="button" type="button" onClick={connect} disabled={connecting}>{connecting ? "Check OKX Wallet…" : "Connect OKX Wallet"}</button>
          </div>
        ) : (
          <form className="studio-form" onSubmit={createGift}>
            <div className="balance-line">
              <span>Balance</span>
              <b>{asset ? `${formatUnits(asset.balance, asset.decimals)} ${asset.symbol}` : "…"}</b>
            </div>
            <label className="field">
              <span>Amount</span>
              <input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" inputMode="decimal" required disabled={!asset} />
              <span className="field-suffix">{asset?.symbol ?? selected.ticker}</span>
            </label>
            <div className="quick-fill">
              {[25n, 50n, 100n].map((fraction) => (
                <button key={fraction.toString()} type="button" onClick={() => fillAmount(fraction)} disabled={!asset || asset.balance === 0n}>
                  {fraction === 100n ? "Max" : `${fraction}%`}
                </button>
              ))}
            </div>
            <label className="field">
              <span>Note <small>optional, stored as a hash</small></span>
              <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Happy birthday. Your first share." maxLength={140} />
            </label>
            <button className="button button-wide" type="submit" disabled={sending || !asset}>
              {sending ? <><span className="spinner" />Creating gift…</> : `Create ${selected.ticker} gift`}
            </button>
            <p className="fine-print">Includes a 0.00002 OKB claim reserve so your recipient pays no gas. Unclaimed gifts can be reclaimed.</p>
          </form>
        )}

        {status ? <p className="notice" aria-live="polite">{status}</p> : null}
        {error && account ? <p className="notice notice-error" role="alert">{error}</p> : null}

        {created ? (
          <div className="gift-created" role="status">
            <div className="burst" aria-hidden="true">{Array.from({ length: 12 }, (_, index) => <i key={index} style={{ ["--i" as string]: index }} />)}</div>
            <span className="eyebrow">Gift #{created.id} is live</span>
            <h3>Send this link to your recipient.</h3>
            <div className="link-box">
              <code>{created.link}</code>
              <button className="button button-light" type="button" onClick={copyLink}>{copied ? "Copied ✓" : "Copy link"}</button>
            </div>
            <p className="fine-print">Anyone holding this link can claim the gift. Share it privately.</p>
            <a className="text-link" href={`${EXPLORER}/tx/${created.transaction}`} target="_blank" rel="noreferrer">View the escrow transaction on OKLink ↗</a>
          </div>
        ) : null}
      </section>

      <section className="section open-gift" id="open">
        <h2 className="section-title">Received a gift?</h2>
        <p className="section-copy">Open the link you were sent, or paste it here.</p>
        <form className="paste-form" onSubmit={openGift}>
          <input aria-label="Gift link" value={giftLink} onChange={(event) => setGiftLink(event.target.value)} placeholder="https://conveyapp.site/g/…" inputMode="url" />
          <button className="button" type="submit">Open gift</button>
        </form>
      </section>

      <footer className="footer">
        <span>convey. · xStock gifts on X Layer</span>
        <span>xStocks are tokenized exposure, not shares held on your behalf. Not investment advice.</span>
      </footer>
    </main>
  );
}

function WalletHelp({ unavailable }: { unavailable: OkxWalletUnavailable }) {
  return (
    <div className="wallet-help">
      {unavailable.kind === "open-in-app" ? (
        <a className="button button-light" href={unavailable.url}>Open in OKX Wallet app</a>
      ) : (
        <a className="button button-light" href={unavailable.url} target="_blank" rel="noreferrer">Get OKX Wallet ↗</a>
      )}
    </div>
  );
}
