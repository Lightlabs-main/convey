"use client";

import { useEffect, useMemo, useState } from "react";
import { formatUnits, isAddress, type Address, type Hex } from "viem";
import {
  enrollReceiverAccount,
  recoverReceiverAccount,
  parseClaimLink,
  prepareReceiverClaim,
  receiverClaimGasSeedFromLive,
  readGiftPreview,
  readLiveGiftValuation,
  unlockReceiverAccount,
  type EnrolledReceiverAccount,
  type ReceiverGiftPreview,
  type ReceiverGiftValuation,
} from "@/src/receiver/flow";
import { ConveyRelayerClient } from "@/src/relayer/client";
import { createBrowserReceiverVaultStorage } from "@/src/receiver/storage";

function shortAddress(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

type ReceiverClaimAccount = {
  owner: Address;
  credentialId: string;
  session: EnrolledReceiverAccount["session"];
  recoveryKey?: Hex;
  recoveryBundle?: string;
};

export default function ClaimScreen({ secret, giftId }: { secret: string; giftId: string }) {
  const [preview, setPreview] = useState<ReceiverGiftPreview>();
  const [valuation, setValuation] = useState<ReceiverGiftValuation>();
  const [account, setAccount] = useState<ReceiverClaimAccount>();
  const [recoverySaved, setRecoverySaved] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recoveryKeyInput, setRecoveryKeyInput] = useState("");
  const [recoveryBundleInput, setRecoveryBundleInput] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);
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
      const storage = createBrowserReceiverVaultStorage();
      if (storage.load()) throw new Error("A receiver account is already enrolled on this device. Use it or recover it instead.");
      const enrolled = await enrollReceiverAccount({
        storage,
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

  async function unlockExistingAccount() {
    setError("");
    setStatus("Verify your existing Convey passkey on this device…");
    try {
      const storage = createBrowserReceiverVaultStorage();
      const stored = storage.load();
      if (!stored) throw new Error("No receiver account is enrolled on this device yet.");
      const session = await unlockReceiverAccount(storage);
      setAccount({ owner: stored.vault.owner, credentialId: stored.vault.credentialId, session });
      setRecoverySaved(true);
      setRecoveryMode(false);
      setStatus("Your existing device-local owner key is ready for the sponsored claim.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The existing receiver account could not be unlocked.");
      setStatus("Your gift has not moved.");
    }
  }

  async function recoverAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview) return;
    setError("");
    setStatus("Creating a new passkey and restoring your existing owner key…");
    try {
      if (!/^0x[0-9a-fA-F]{64}$/u.test(recoveryKeyInput.trim())) throw new Error("The recovery key must contain exactly 32 bytes.");
      const recovered = await recoverReceiverAccount({
        storage: createBrowserReceiverVaultStorage(),
        recoveryKey: recoveryKeyInput.trim() as Hex,
        recoveryBundle: recoveryBundleInput.trim() || undefined,
        userName: `receiver-${preview.giftId.toString()}`,
        displayName: "Convey receiver",
        rpName: "Convey",
      });
      setAccount(recovered);
      setRecoverySaved(true);
      setRecoveryMode(false);
      setRecoveryKeyInput("");
      setRecoveryBundleInput("");
      setStatus(`Recovered the existing owner key at ${shortAddress(recovered.owner)}. It is ready for the sponsored claim.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The receiver account could not be recovered.");
      setStatus("Your gift has not moved.");
    }
  }

  function requiredAddress(name: string): Address {
    const value = {
      NEXT_PUBLIC_CONVEY_ENTRYPOINT_ADDRESS: process.env.NEXT_PUBLIC_CONVEY_ENTRYPOINT_ADDRESS,
      NEXT_PUBLIC_CONVEY_SMART_WALLET_FACTORY: process.env.NEXT_PUBLIC_CONVEY_SMART_WALLET_FACTORY,
      NEXT_PUBLIC_CONVEY_SMART_WALLET_IMPLEMENTATION: process.env.NEXT_PUBLIC_CONVEY_SMART_WALLET_IMPLEMENTATION,
      NEXT_PUBLIC_CONVEY_CLAIM_ESCROW_ADDRESS: process.env.NEXT_PUBLIC_CONVEY_CLAIM_ESCROW_ADDRESS,
      NEXT_PUBLIC_CONVEY_CLAIM_PAYMASTER_ADDRESS: process.env.NEXT_PUBLIC_CONVEY_CLAIM_PAYMASTER_ADDRESS,
    }[name as "NEXT_PUBLIC_CONVEY_ENTRYPOINT_ADDRESS" | "NEXT_PUBLIC_CONVEY_SMART_WALLET_FACTORY" | "NEXT_PUBLIC_CONVEY_SMART_WALLET_IMPLEMENTATION" | "NEXT_PUBLIC_CONVEY_CLAIM_ESCROW_ADDRESS" | "NEXT_PUBLIC_CONVEY_CLAIM_PAYMASTER_ADDRESS"];
    if (!value || !isAddress(value)) throw new Error(`${name} is not configured with a live address`);
    return value as Address;
  }

  function requiredSelector(name: string): `0x${string}` {
    const value = process.env.NEXT_PUBLIC_CONVEY_CLAIM_FUNCTION_SELECTOR;
    if (!value || !/^0x[0-9a-fA-F]{8}$/u.test(value)) throw new Error(`${name} is not configured with a live selector`);
    return value as `0x${string}`;
  }

  function requiredSalt(): bigint {
    const value = process.env.NEXT_PUBLIC_CONVEY_RECEIVER_SALT;
    if (!value || !/^\d+$/u.test(value)) throw new Error("NEXT_PUBLIC_CONVEY_RECEIVER_SALT is not configured");
    return BigInt(value);
  }

  async function claimGift() {
    if (!claim || !preview || !account?.session || !recoverySaved) return;
    setError("");
    setClaiming(true);
    setStatus("Reading live gas fields from Convey's private bundler…");
    try {
      const executionRpcUrl = process.env.NEXT_PUBLIC_XLAYER_RPC_URL;
      if (!executionRpcUrl) throw new Error("The receiver screen is missing its live X Layer RPC");
      const relay = new ConveyRelayerClient({
        relayUrl: new URL("/api/relay", window.location.origin).toString().replace(/\/$/u, ""),
        entryPoint: requiredAddress("NEXT_PUBLIC_CONVEY_ENTRYPOINT_ADDRESS"),
        chainId: 196,
      });
      const seed = receiverClaimGasSeedFromLive(await relay.claimGasSeed());
      setStatus("Authorizing and estimating the exact sponsored claim…");
      const prepared = await prepareReceiverClaim({
        claim,
        executionRpcUrl,
        entryPoint: requiredAddress("NEXT_PUBLIC_CONVEY_ENTRYPOINT_ADDRESS"),
        factory: requiredAddress("NEXT_PUBLIC_CONVEY_SMART_WALLET_FACTORY"),
        implementation: requiredAddress("NEXT_PUBLIC_CONVEY_SMART_WALLET_IMPLEMENTATION"),
        escrow: requiredAddress("NEXT_PUBLIC_CONVEY_CLAIM_ESCROW_ADDRESS"),
        claimFunctionSelector: requiredSelector("NEXT_PUBLIC_CONVEY_CLAIM_FUNCTION_SELECTOR"),
        paymaster: requiredAddress("NEXT_PUBLIC_CONVEY_CLAIM_PAYMASTER_ADDRESS"),
        signer: account.session.signer,
        salt: requiredSalt(),
        gasSeed: seed,
        relay,
      });
      setStatus("Sending the signed claim through Convey's private route…");
      const accepted = await relay.submitClaim(prepared.userOperation.userOperation, {
        idempotencyKey: `claim-${preview.giftId.toString()}-${prepared.account.toLowerCase()}`,
      });
      const result = await relay.waitForClaim(accepted.userOperationHash);
      if (result.status !== "confirmed" || result.success !== true) throw new Error("the sponsored claim was included but did not succeed");
      setClaimed(true);
      const refreshed = await readGiftPreview(executionRpcUrl, requiredAddress("NEXT_PUBLIC_CONVEY_CLAIM_ESCROW_ADDRESS"), claim);
      setPreview(refreshed);
      setStatus(`Claim confirmed in X Layer block ${result.blockNumber ?? ""}. Your asset is in ${prepared.account}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The sponsored claim could not be completed.");
      setStatus("Your gift has not moved.");
    } finally {
      setClaiming(false);
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
            {account && !recoverySaved ? <div className="recovery"><div className="recovery-label">Save this recovery key once</div><code>{account.recoveryKey}</code><p>Keep the key separate from this encrypted bundle. The bundle contains ciphertext only and is needed on a replacement device.</p>{account.recoveryBundle ? <a className="recovery-download" href={`data:application/json;charset=utf-8,${encodeURIComponent(account.recoveryBundle)}`} download="convey-recovery-bundle.json">Download encrypted recovery bundle</a> : null}<button type="button" onClick={() => { setRecoverySaved(true); setStatus("Recovery key saved. Your device-local owner key is ready for the sponsored claim."); }}>I saved it</button></div> : null}
            {account && recoverySaved ? <div className="risk">Your device-local owner key is enrolled at {shortAddress(account.owner)}. The key never leaves this device.</div> : null}
            {preview?.state === "open" && !preview.expired && !account && !recoveryMode ? <><button className="button" type="button" onClick={secureAccount}>Create secure account</button><button className="secondary-button" type="button" onClick={unlockExistingAccount}>Use existing account</button><button className="text-button" type="button" onClick={() => setRecoveryMode(true)}>Recover an existing account</button></> : null}
            {preview?.state === "open" && !preview.expired && !account && recoveryMode ? <form className="recovery recovery-form" onSubmit={recoverAccount}><div className="recovery-label">Recover an existing account</div><p>Enter the recovery key you saved separately. Paste the encrypted bundle too when using a replacement device; on this device it may already be stored locally.</p><label>Recovery key<input value={recoveryKeyInput} onChange={(event) => setRecoveryKeyInput(event.target.value)} autoComplete="off" required /></label><label>Encrypted recovery bundle<textarea value={recoveryBundleInput} onChange={(event) => setRecoveryBundleInput(event.target.value)} placeholder="Paste the downloaded JSON bundle on a new device" rows={4} /></label><div><button className="button" type="submit">Recover account</button><button className="text-button" type="button" onClick={() => setRecoveryMode(false)}>Cancel</button></div></form> : null}
            {preview?.state === "open" && !preview.expired && account && recoverySaved && !claimed ? <button className="button" type="button" onClick={claimGift} disabled={claiming}>{claiming ? "Claiming securely…" : "Claim this gift"}</button> : null}
            <p className="status" aria-live="polite">{status}</p>
            <div className="actions">
              <button className="action" type="button" disabled={!claimed} onClick={() => setStatus("Your tokenized exposure is held in your smart account.")}><span><strong>Keep it</strong><br />Hold your tokenized exposure</span><span>{claimed ? "ready" : "after claim"}</span></button>
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
