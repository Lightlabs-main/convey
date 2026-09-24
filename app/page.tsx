"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function HomePage() {
  const router = useRouter();
  const [link, setLink] = useState("");
  const [error, setError] = useState("");

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
      </div>
    </main>
  );
}
