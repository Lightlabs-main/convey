import type { EIP1193Provider } from "viem";

/**
 * OKX Wallet connection for the sender surface.
 *
 * Discovery order: the EIP-6963 announcement from OKX Wallet (rdns
 * `com.okex.wallet`), then its dedicated `window.okxwallet` injection. On a
 * phone without the extension, the page is reopened inside the OKX Wallet app
 * browser through its documented deep link. Connection always ends on X Layer.
 */

export const XLAYER_CHAIN_ID = 196;
const XLAYER_CHAIN_HEX = "0xc4";
const OKX_RDNS = "com.okex.wallet";
export const OKX_WALLET_DOWNLOAD_URL = "https://web3.okx.com/download";

const XLAYER_CHAIN_PARAMS = {
  chainId: XLAYER_CHAIN_HEX,
  chainName: "X Layer Mainnet",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: ["https://rpc.xlayer.tech"],
  blockExplorerUrls: ["https://www.oklink.com/xlayer"],
};

declare global {
  interface Window {
    okxwallet?: EIP1193Provider;
  }
}

export interface OkxWalletProvider {
  provider: EIP1193Provider;
  /** Data-URI icon supplied by the wallet itself through EIP-6963, when announced. */
  icon?: string;
}

interface Eip6963AnnounceEvent extends Event {
  detail: { info: { rdns: string; icon: string }; provider: EIP1193Provider };
}

export type OkxWalletUnavailable = { kind: "open-in-app"; url: string } | { kind: "install"; url: string };

export class OkxWalletError extends Error {
  readonly unavailable?: OkxWalletUnavailable;

  constructor(message: string, unavailable?: OkxWalletUnavailable) {
    super(message);
    this.unavailable = unavailable;
  }
}

/** Waits briefly for OKX Wallet's EIP-6963 announcement, then falls back to `window.okxwallet`. */
export function discoverOkxWallet(timeoutMs = 350): Promise<OkxWalletProvider | undefined> {
  if (typeof window === "undefined") return Promise.resolve(undefined);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: OkxWalletProvider | undefined) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      resolve(value);
    };
    const onAnnounce = (event: Event) => {
      const { info, provider } = (event as Eip6963AnnounceEvent).detail ?? {};
      if (info?.rdns === OKX_RDNS && provider) finish({ provider, icon: info.icon });
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    window.setTimeout(() => finish(window.okxwallet ? { provider: window.okxwallet } : undefined), timeoutMs);
  });
}

function isMobile(): boolean {
  return /Android|iPhone|iPad|iPod/iu.test(navigator.userAgent);
}

/** Deep link that reopens this exact page inside the OKX Wallet app browser. */
export function okxAppDeepLink(pageUrl: string): string {
  return `okx://wallet/dapp/url?dappUrl=${encodeURIComponent(pageUrl)}`;
}

async function ensureXLayer(provider: EIP1193Provider): Promise<void> {
  const current = await provider.request({ method: "eth_chainId" });
  if (typeof current === "string" && parseInt(current, 16) === XLAYER_CHAIN_ID) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: XLAYER_CHAIN_HEX }] });
  } catch (error) {
    // 4902: the wallet does not know the chain yet.
    if ((error as { code?: number }).code !== 4902) throw error;
    await provider.request({ method: "wallet_addEthereumChain", params: [XLAYER_CHAIN_PARAMS] });
  }
}

/**
 * Opens the OKX Wallet approval prompt and leaves the wallet on X Layer.
 * Throws `OkxWalletError` with a next step when OKX Wallet is not present.
 */
export async function connectOkxWallet(): Promise<OkxWalletProvider> {
  const wallet = await discoverOkxWallet();
  if (!wallet) {
    if (isMobile()) {
      throw new OkxWalletError("Open Convey in the OKX Wallet app to connect.", { kind: "open-in-app", url: okxAppDeepLink(window.location.href) });
    }
    throw new OkxWalletError("Install the OKX Wallet extension to send a gift.", { kind: "install", url: OKX_WALLET_DOWNLOAD_URL });
  }
  try {
    await wallet.provider.request({ method: "eth_requestAccounts" });
    await ensureXLayer(wallet.provider);
  } catch (error) {
    if ((error as { code?: number }).code === 4001) throw new OkxWalletError("The request was declined in OKX Wallet.");
    throw error;
  }
  return wallet;
}
