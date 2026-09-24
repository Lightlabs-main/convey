"use client";

import { useEffect, useMemo, useState } from "react";
import { formatUnits } from "viem";
import {
  enrollReceiverAccount,
  parseClaimLink,
  readGiftPreview,
  readLiveGiftValuation,
  type EnrolledReceiverAccount,
  type ReceiverGiftPreview,
  type ReceiverGiftValuation,
} from "@/src/receiver/flow";
import { createBrowserReceiverVaultStorage } from "@/src/receiver/storage";

function shortAddress(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export default function ClaimScreen({ secret, giftId }: { secret: string; giftId: string }) {
  const [preview, setPreview] = useState<ReceiverGiftPreview>();
  const [valuation, setValuation] = useState<ReceiverGiftValuation>();
  const [account, setAccount] = useState<EnrolledReceiverAccount>();
  const [recoverySaved, setRecoverySaved] = useState(false);
  const [status, setStatus] = useState("Reading the live gift record…");
  const [error, setError] = useState("");
  const claim = useMemo(() => {
    try {
      return parseClaimLink(`https://convey.invalid/g/${secret}?giftId=${encodeURIComponent(giftId)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This gift link is invalid.");
      return undefined;
    }
  }, [giftId, secret]);

  useEffect(() => {
    if (!claim) return;
    const rpcUrl = process.env.NEXT_PUBLIC_XLAYER_RPC_URL;
    const escrow = process.env.NEXT_PUBLIC_CONVEY_CLAIM_ESCROW_ADDRESS as `0x${string}` | undefined;
    if (!rpcUrl || !escrow) {
      setError("The receiver screen is not configured with a live X Layer RPC and escrow address.");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const livePreview = await readGiftPreview(rpcUrl, escrow, claim);
        if (cancelled) return;
        setPreview(livePreview);
        setStatus("Reading the current live value…");
        try {
          const liveValuation = await readLiveGiftValuation(rpcUrl, livePreview);
          if (!cancelled) setValuation(liveValuation);
        } catch {
          if (!cancelled) setStatus("Gift details are live; current USD value is unavailable from the registered valuation source.");
        }
        if (!cancelled) setStatus(livePreview.expired ? "This gift has expired." : livePreview.state === "open" ? "Your gift is ready to secure." : "This gift has already been closed.");
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "The live gift record could not be read.");
      }
    })();
    return () => { cancelled = true; };
  }, [claim]);

  async function secureAccount() {
    if (!preview) return;
    setError("");
    setStatus("Waiting for your device to create a secure passkey…");
    try {
      const enrolled = await enrollReceiverAccount({
        storage: createBrowserReceiverVaultStorage(),
        userName: `receiver-${preview.giftId.toString()}`,
        displayName: "Convey receiver",
        rpName: "Convey",
      });
      setAccount(enrolled);
      setStatus("Save your recovery key before continuing. It is shown once and is not stored by Convey.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Passkey enrollment was not completed.");
      setStatus("Your gift has not moved.");
    }
  }

  const tokenAmount = preview ? formatUnits(preview.amount, preview.decimals) : "—";

  return (
    <main>
      <div className="network-bar">X Layer mainnet · chain 196 · gasless receiver claim</div>
      <div className="shell claim-wrap">
        <nav className="nav"><span className="wordmark">convey.</span><span className="nav-note">your gift is waiting</span></nav>
        <div className="claim-grid">
          <section className="claim-card">
            <div className="eyebrow">A real gift, on-chain</div>
            <h1 className="claim-title">Someone sent you a stock.</h1>
            <p className="claim-subtitle">No wallet was needed to send it. Your claim is gasless, and the asset goes to a smart account created for you.</p>
            <div className="gift-value">
              <div><strong>{valuation ? `$${valuation.estimatedUsd.toFixed(2)}` : tokenAmount}</strong><span>{valuation ? `${preview?.symbol ?? "asset"} · live issuer value` : preview ? `${preview.symbol} · live chain amount` : "Reading live chain…"}</span></div>
              {preview ? <span>from {shortAddress(preview.sender)}</span> : null}
            </div>
            {preview ? <div className="risk">{preview.riskTag}</div> : null}
            {error ? <div className="error" role="alert">{error}</div> : null}
            {account && !recoverySaved ? <div className="recovery"><div className="recovery-label">Save this recovery key once</div><code>{account.recoveryKey}</code><button type="button" onClick={() => { setRecoverySaved(true); setStatus("Recovery key saved. Your device-local owner key is ready for the sponsored claim."); }}>I saved it</button></div> : null}
            {account && recoverySaved ? <div className="risk">Your device-local owner key is enrolled at {shortAddress(account.owner)}. The key never leaves this device.</div> : null}
            {preview?.state === "open" && !preview.expired && !account ? <button className="button" type="button" onClick={secureAccount}>Secure my claim</button> : null}
            <p className="status" aria-live="polite">{status}</p>
            <div className="actions">
              <button className="action" type="button" disabled><span><strong>Keep it</strong><br />Hold your tokenized exposure</span><span>soon</span></button>
              {preview?.cashOutRoute !== "0x0000000000000000000000000000000000000000" ? <button className="action" type="button" disabled><span><strong>Cash out</strong><br />Live quote to USDT0</span><span>soon</span></button> : null}
              <button className="action" type="button" disabled><span><strong>Move it</strong><br />Send to any address</span><span>soon</span></button>
            </div>
          </section>
          <aside className="side-card">
            <h2 className="side-title">What happens next</h2>
            <p className="side-copy">You keep control. Convey only routes the sponsored operation; it never receives your private key.</p>
            <ul className="side-list"><li>Your device creates a secure account.</li><li>The sender-funded reserve covers claim gas.</li><li>The asset lands in your smart account.</li></ul>
          </aside>
        </div>
      </div>
    </main>
  );
}
