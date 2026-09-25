"use client";

import { LiveTicker } from "./components/LiveTicker";
import { Reveal } from "./components/Reveal";
import { SiteHeader } from "./components/SiteHeader";
import { XStockArt } from "./components/XStockArt";
import { EXPLORER, XSTOCKS, formatUsd, useLiveQuotes, type XStock } from "./lib/xstocks";

const CONTRACTS = [
  ["GiftEscrow", process.env.NEXT_PUBLIC_CONVEY_CLAIM_ESCROW_ADDRESS, "Holds each xStock until a signature-bound claim."],
  ["Claim paymaster", process.env.NEXT_PUBLIC_CONVEY_CLAIM_PAYMASTER_ADDRESS, "Sender-funded ERC-4337 v0.7 gas sponsorship."],
  ["Asset registry", process.env.NEXT_PUBLIC_CONVEY_ASSET_REGISTRY_ADDRESS, "Certified X Layer xStocks and cash-out routes."],
] as const;

function shortAddress(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export default function LandingPage() {
  const quotes = useLiveQuotes();

  return (
    <main className="page">
      <LiveTicker />
      <SiteHeader>
        <a className="button button-light" href="/app">Launch app</a>
      </SiteHeader>

      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow"><i className="pulse" />Live on X Layer mainnet</span>
          <h1>Gift a share of NVIDIA.<br /><span className="gradient-text">In one link.</span></h1>
          <p className="lede">
            Send tokenized xStocks from OKX Wallet. Your recipient opens a link, taps their fingerprint, and owns the
            asset in their own smart account. No wallet to install, no OKB to buy, no gas to pay.
          </p>
          <div className="hero-actions">
            <a className="button" href="/app?connect=1">Connect OKX Wallet</a>
            <a className="button button-ghost" href="/app#open">I received a gift</a>
          </div>
          <dl className="hero-stats">
            <div><dt>0 OKB</dt><dd>receiver gas</dd></div>
            <div><dt>1 link</dt><dd>to deliver</dd></div>
            <div><dt>196</dt><dd>X Layer chain</dd></div>
          </dl>
        </div>
        <HeroCards quotes={quotes} />
      </section>

      <Reveal className="stack">
        <span className="stack-label">Built on the OKX stack</span>
        <ul>
          <li><b>X Layer</b>settlement</li>
          <li><b>OKX Wallet</b>sender</li>
          <li><b>xStocks</b>assets</li>
          <li><b>OKX Smart Wallet</b>receiver</li>
          <li><b>OKBund</b>ERC-4337 bundler</li>
        </ul>
      </Reveal>

      <section className="section" id="how">
        <Reveal><h2 className="section-title">From your wallet to theirs,<br />without the wallet setup.</h2></Reveal>
        <div className="steps">
          {[
            ["01", "Pick an xStock", "Choose NVDAx, AAPLx or TSLAx from Convey's certified X Layer registry and fund the gift from OKX Wallet."],
            ["02", "Share one link", "The link holds a one-time key. It never touches the chain, so a copied claim cannot be redirected."],
            ["03", "They claim gasless", "A passkey creates their OKX Smart Wallet. Your small OKB reserve pays their gas through Convey's paymaster."],
          ].map(([number, title, body], index) => (
            <Reveal className="step" key={number} delay={index * 120}>
              <span className="step-number">{number}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="section" id="assets">
        <Reveal><h2 className="section-title">Real xStocks. Live prices.</h2></Reveal>
        <div className="xstock-grid">
          {XSTOCKS.map((stock, index) => (
            <Reveal className="xstock-option xstock-static" key={stock.ticker} delay={index * 100}>
              <XStockArt stock={stock} />
              <span className="xstock-name"><b>{stock.ticker}</b>{stock.company}</span>
              <span className="xstock-price">{quotes[stock.ticker] !== undefined ? formatUsd(quotes[stock.ticker]!) : "—"}<small>issuer quote</small></span>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="section" id="proof">
        <Reveal><h2 className="section-title">Onchain, not a demo.</h2></Reveal>
        <div className="proof-grid">
          {CONTRACTS.map(([name, address, body], index) => (
            <Reveal className="proof-card" key={name} delay={index * 100}>
              <h3>{name}</h3>
              <p>{body}</p>
              {address ? <a className="mono-link" href={`${EXPLORER}/address/${address}`} target="_blank" rel="noreferrer">{shortAddress(address)} ↗</a> : null}
            </Reveal>
          ))}
        </div>
      </section>

      <Reveal className="cta-band">
        <h2>Someone deserves a share of the future.</h2>
        <a className="button" href="/app?connect=1">Send your first xStock</a>
      </Reveal>

      <footer className="footer">
        <span>convey. · xStock gifts on X Layer</span>
        <span>xStocks are tokenized exposure, not shares held on your behalf. Not investment advice.</span>
      </footer>
    </main>
  );
}

function HeroCards({ quotes }: { quotes: Partial<Record<XStock["ticker"], number>> }) {
  return (
    <div className="hero-art" aria-hidden="true">
      <div className="glow" />
      <div className="orbit orbit-one" />
      <div className="orbit orbit-two" />
      {XSTOCKS.map((stock, index) => (
        <div className={`gift-card gift-card-${index}`} key={stock.ticker}>
          <div className="gift-card-top">
            <XStockArt stock={stock} size={40} />
            <span className="gift-card-name"><b>{stock.ticker}</b>{stock.company}</span>
            <span className="ribbon">gift</span>
          </div>
          <div className="gift-card-price">{quotes[stock.ticker] !== undefined ? formatUsd(quotes[stock.ticker]!) : "live quote"}</div>
          <svg className="spark" viewBox="0 0 200 48" preserveAspectRatio="none"><path d="M0 40 C30 36 40 18 70 24 S120 38 140 16 S180 10 200 4" /></svg>
          <div className="gift-card-foot"><span>X Layer · 196</span><span>gasless claim</span></div>
        </div>
      ))}
      <div className="toast"><span className="check">✓</span>Gift claimed · 0 gas paid</div>
    </div>
  );
}
