import { createPublicClient, erc20Abi, formatUnits, http, isAddress, type Address } from "viem";
import { unitValues, XSTOCK_TOKEN_ADDRESSES as XSTOCK_ADDRESSES, XSTOCK_TOKENS as XSTOCKS } from "@/app/lib/xstockValues";

/**
 * Live holdings of one receiver account, read from X Layer token balances.
 * Every launch xStock and USDT0 is reported, including zero balances.
 */

export const dynamic = "force-dynamic";

const RPC_URL = process.env.NEXT_PUBLIC_XLAYER_RPC_URL ?? "https://rpc.xlayer.tech";
const USDT0 = process.env.NEXT_PUBLIC_CONVEY_EXIT_USDT0_ADDRESS;

const client = createPublicClient({ transport: http(RPC_URL) });

export async function GET(request: Request): Promise<Response> {
  const account = new URL(request.url).searchParams.get("account");
  if (!account || !isAddress(account)) return Response.json({ error: "invalid_account" }, { status: 400 });
  try {
    const tokens: { token: Address; ticker: string; decimals: number }[] = [
      ...XSTOCK_ADDRESSES.map((token) => ({ token, ticker: XSTOCKS[token].ticker, decimals: 18 })),
      ...(USDT0 && isAddress(USDT0) ? [{ token: USDT0 as Address, ticker: "USDT0", decimals: 6 }] : []),
    ];
    const [balances, values] = await Promise.all([
      Promise.all(tokens.map(({ token }) => client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account as Address] }))),
      unitValues(),
    ]);
    const holdings = tokens.map(({ token, ticker, decimals }, index) => {
      const amount = formatUnits(balances[index], decimals);
      const unit = ticker === "USDT0" ? 1 : values[ticker];
      return { token, ticker, amount, raw: balances[index].toString(), valueUsd: unit !== undefined ? Number(amount) * unit : undefined };
    });
    const totalUsd = holdings.every((holding) => holding.raw === "0" || holding.valueUsd !== undefined)
      ? holdings.reduce((sum, holding) => sum + (holding.valueUsd ?? 0), 0)
      : undefined;
    return Response.json({ account, holdings, totalUsd, readAt: Date.now() }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "portfolio_unavailable" }, { status: 503 });
  }
}
