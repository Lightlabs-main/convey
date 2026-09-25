#!/usr/bin/env node
/**
 * Convey MCP server: lets AI agents gift X Layer xStocks to people by link.
 *
 * Read-only tools work with no configuration. Spending tools need an agent
 * wallet (CONVEY_AGENT_PRIVATE_KEY), a per-gift cap (CONVEY_AGENT_MAX_GIFT_AMOUNT)
 * and an explicit `confirm: true` on each call.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createPublicClient, defineChain, formatEther, formatUnits, getAddress, http, isAddress, parseUnits, type Address, type Hex } from "viem";
import { privateKeyToAccount, privateKeyToAddress } from "viem/accounts";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildClaimLink, ConnectedWalletSender, randomSecret, type SenderAsset } from "../src/sender/index.ts";
import { issuerApiSymbol, parseClaimLink, readGiftPreview, readLiveGiftValuation } from "../src/receiver/flow.ts";
import { localAccountProvider } from "./local-provider.ts";
import { createPlan, isDue, PlanStore, recordSent, remainingGifts, spentUnits, toUnits, type RecurringPlan } from "./recurring.ts";

const EXPLORER = "https://www.oklink.com/xlayer";
const ISSUER_API = "https://api.backed.fi/api/v2/public";
const ZERO_SECRET = `0x${"00".repeat(32)}` as Hex;

function envAddress(name: string, fallback: string): Address {
  const value = process.env[name]?.trim() || fallback;
  if (!isAddress(value)) throw new Error(`${name} must be an EVM address`);
  return getAddress(value);
}

// Public X Layer mainnet deployment; every value can be overridden by env.
const config = {
  rpcUrl: process.env.XLAYER_RPC_URL?.trim() || "https://rpc.xlayer.tech",
  appUrl: process.env.CONVEY_APP_URL?.trim() || "https://conveyapp.site",
  registry: envAddress("CONVEY_ASSET_REGISTRY_ADDRESS", "0x156d160e004B7fb2021CFCA8fC6cF069c3b8b029"),
  escrow: envAddress("CONVEY_CLAIM_ESCROW_ADDRESS", "0xffd2DACE75dbC3bC3f2e10C6c7b011Aa4EC043cD"),
  claimPaymaster: envAddress("CONVEY_CLAIM_PAYMASTER_ADDRESS", "0x655025c861C1848BA5324863D85BFA32cCF69e5B"),
  xstocks: {
    NVDAx: { company: "NVIDIA", token: envAddress("CONVEY_WNVDA_TOKEN_ADDRESS", "0xa8ddb5cd96b5222afe198316e9a57caa642850d5") },
    AAPLx: { company: "Apple", token: envAddress("CONVEY_WAAPL_TOKEN_ADDRESS", "0x943bf64d566c32a2bcd41ac92fb63c111cc9de8f") },
    TSLAx: { company: "Tesla", token: envAddress("CONVEY_WTSLA_TOKEN_ADDRESS", "0xc3fdbe3a68ee5de461d30415a8165cf9aefe1171") },
  },
};
type Ticker = keyof typeof config.xstocks;
const TICKERS = Object.keys(config.xstocks) as [Ticker, ...Ticker[]];

const agentKey = process.env.CONVEY_AGENT_PRIVATE_KEY?.trim();
if (agentKey && !/^0x[0-9a-fA-F]{64}$/u.test(agentKey)) throw new Error("CONVEY_AGENT_PRIVATE_KEY must be a 32-byte hex private key");
const agent = agentKey ? privateKeyToAccount(agentKey as Hex) : undefined;
const maxGiftAmount = process.env.CONVEY_AGENT_MAX_GIFT_AMOUNT?.trim();

const chain = defineChain({
  id: 196,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
});
const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
const sender = new ConnectedWalletSender({
  rpcUrl: config.rpcUrl,
  provider: localAccountProvider(publicClient, agent),
  deployment: { registry: config.registry, escrow: config.escrow, claimPaymaster: config.claimPaymaster, claimBaseUrl: config.appUrl },
});
const ready = sender.connect();
ready.catch(() => undefined); // surfaced when a tool awaits it

async function issuerPrice(ticker: Ticker): Promise<number | undefined> {
  try {
    const response = await fetch(`${ISSUER_API}/assets/${issuerApiSymbol(ticker)}/price-data`);
    const { quote } = (await response.json()) as { quote?: unknown };
    return response.ok && typeof quote === "number" && Number.isFinite(quote) ? quote : undefined;
  } catch {
    return undefined;
  }
}

function result(value: unknown) {
  const text = JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item), 2);
  return { content: [{ type: "text" as const, text }] };
}

function failure(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

function requireSpending(confirm: boolean): string | undefined {
  if (!agent) return "No agent wallet is configured. Set CONVEY_AGENT_PRIVATE_KEY to send gifts.";
  if (!maxGiftAmount) return "Set CONVEY_AGENT_MAX_GIFT_AMOUNT (in xStock units) before sending gifts.";
  if (!confirm) return "This spends real assets on X Layer mainnet. Repeat the call with confirm: true once the user has approved it.";
  return undefined;
}

async function readXStock(ticker: Ticker): Promise<SenderAsset> {
  await ready;
  return sender.readAsset(config.xstocks[ticker].token);
}

const server = new McpServer({ name: "convey", version: "1.0.0" });

server.registerTool("list_xstocks", {
  title: "List giftable xStocks",
  description: "Lists the tokenized stocks (xStocks) that Convey can gift on X Layer, with registry certification and the live issuer price per share.",
  annotations: { readOnlyHint: true, openWorldHint: true },
}, async () => {
  const rows = await Promise.all(TICKERS.map(async (ticker) => {
    const [asset, price] = await Promise.all([readXStock(ticker), issuerPrice(ticker)]);
    return {
      ticker,
      company: config.xstocks[ticker].company,
      token: asset.token,
      symbol: asset.symbol,
      giftable: asset.certified && asset.enabled,
      priceUsd: price ?? "unavailable",
      cashOut: asset.cashOutRoute === "0x0000000000000000000000000000000000000000" ? "hold-only" : "USDT0 route",
    };
  }));
  return result({ chain: "X Layer mainnet (196)", xstocks: rows });
});

server.registerTool("get_gift", {
  title: "Check a gift",
  description: "Reads a Convey gift's live state (open, claimed, reclaimed or expired), asset, amount and live USD value. Accepts a gift ID or a full claim link.",
  inputSchema: {
    gift: z.string().describe("Gift ID (e.g. \"3\") or a full https://conveyapp.site/g/... claim link"),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
}, async ({ gift }) => {
  let giftId: bigint;
  try {
    giftId = /^\d+$/u.test(gift.trim()) ? BigInt(gift.trim()) : parseClaimLink(gift.trim()).giftId;
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Not a gift ID or claim link.");
  }
  try {
    const preview = await readGiftPreview(config.rpcUrl, config.escrow, { giftId, secret: ZERO_SECRET });
    const valuation = await readLiveGiftValuation(config.rpcUrl, preview).catch(() => undefined);
    return result({
      giftId,
      state: preview.expired ? "expired" : preview.state,
      asset: preview.symbol,
      amount: formatUnits(preview.amount, preview.decimals),
      estimatedUsd: valuation ? Number(valuation.estimatedUsd.toFixed(2)) : "unavailable",
      sender: preview.sender,
      codeRequired: preview.codeRequired,
      expiresAt: preview.expiry === 0n ? "never" : new Date(Number(preview.expiry) * 1000).toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return failure(message.includes("0xbc663ca6") ? `Gift ${giftId} does not exist on the Convey escrow.` : message || "The gift could not be read.");
  }
});

server.registerTool("agent_wallet", {
  title: "Agent wallet status",
  description: "Shows the agent's X Layer wallet address, OKB balance (needed for claim reserves and gas), xStock balances and the per-gift cap.",
  annotations: { readOnlyHint: true, openWorldHint: true },
}, async () => {
  if (!agent) return failure("No agent wallet is configured. Set CONVEY_AGENT_PRIVATE_KEY to send gifts.");
  const [okb, assets] = await Promise.all([
    publicClient.getBalance({ address: agent.address }),
    Promise.all(TICKERS.map(async (ticker) => {
      const asset = await readXStock(ticker);
      return { ticker, balance: formatUnits(asset.balance, asset.decimals) };
    })),
  ]);
  return result({ address: agent.address, okb: formatEther(okb), xstocks: assets, maxGiftAmount: maxGiftAmount ?? "not set" });
});

server.registerTool("send_gift", {
  title: "Send an xStock gift",
  description:
    "Creates a Convey gift from the agent wallet and returns a claim link. Anyone holding the link can claim, so deliver it only to the intended recipient. " +
    "The recipient needs no wallet or gas. Spends real assets: requires confirm: true after the user approves.",
  inputSchema: {
    ticker: z.enum(TICKERS).describe("Which xStock to gift"),
    amount: z.string().regex(/^\d+(\.\d+)?$/u).describe("Amount in xStock units, e.g. \"0.01\""),
    note: z.string().max(140).optional().describe("Optional message; only its hash is stored on chain"),
    confirm: z.boolean().default(false).describe("Must be true to send; set it only after the user approves"),
  },
  annotations: { destructiveHint: true, openWorldHint: true },
}, async ({ ticker, amount, note, confirm }) => {
  const blocked = requireSpending(confirm);
  if (blocked) return failure(blocked);
  try {
    const asset = await readXStock(ticker);
    if (!asset.certified || !asset.enabled) return failure(`${ticker} is not currently giftable.`);
    if (parseUnits(amount, asset.decimals) > parseUnits(maxGiftAmount!, asset.decimals)) {
      return failure(`${amount} ${ticker} exceeds the agent's per-gift cap of ${maxGiftAmount}.`);
    }
    const gift = await sender.createGift({ asset: asset.token, amount, note });
    return result({
      giftId: gift.giftId,
      claimLink: gift.claimLink,
      amount: `${formatUnits(gift.amount, asset.decimals)} ${asset.symbol}`,
      claimReserveOkb: formatEther(gift.claimReserveWei),
      transaction: `${EXPLORER}/tx/${gift.createTransaction}`,
      delivery: "Send the claim link privately. It is a bearer link and can be reclaimed with reclaim_gift while unclaimed.",
    });
  } catch (error) {
    return failure(error instanceof Error ? error.message : "The gift could not be created.");
  }
});

server.registerTool("reclaim_gift", {
  title: "Reclaim an unclaimed gift",
  description: "Returns an unclaimed gift created by the agent wallet back to it. Requires confirm: true.",
  inputSchema: {
    giftId: z.string().regex(/^\d+$/u).describe("Gift ID to reclaim"),
    confirm: z.boolean().default(false).describe("Must be true to reclaim"),
  },
  annotations: { destructiveHint: true, openWorldHint: true },
}, async ({ giftId, confirm }) => {
  const blocked = requireSpending(confirm);
  if (blocked) return failure(blocked);
  try {
    await ready;
    const transaction = await sender.reclaimGift(BigInt(giftId));
    return result({ giftId, reclaimed: true, transaction: `${EXPLORER}/tx/${transaction}` });
  } catch (error) {
    return failure(error instanceof Error ? error.message : "The gift could not be reclaimed.");
  }
});

// ---------- Recurring gifts ----------

const plans = new PlanStore(join(process.env.CONVEY_AGENT_STATE_DIR?.trim() || join(homedir(), ".convey-agent"), "plans.json"));
const IN_FLIGHT_TIMEOUT_MS = 10 * 60 * 1000;
const GIFT_LOOKUP_ABI = [
  { type: "function", name: "nextGiftId", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function", name: "getGift", stateMutability: "view", inputs: [{ name: "giftId", type: "uint256" }],
    outputs: [{ type: "tuple", components: [
      { name: "sender", type: "address" }, { name: "asset", type: "address" }, { name: "amount", type: "uint256" },
      { name: "claimKey", type: "address" }, { name: "codeHash", type: "bytes32" }, { name: "expiry", type: "uint64" },
      { name: "noteHash", type: "bytes32" }, { name: "state", type: "uint8" },
    ] }],
  },
] as const;

function formatUnitsString(units: bigint): string {
  return formatUnits(units, 18);
}

function planSummary(plan: RecurringPlan) {
  return {
    planId: plan.id,
    status: plan.status,
    gift: `${plan.amountPerGift} ${plan.ticker} every ${plan.intervalSeconds / 3600} hours`,
    recipient: plan.recipient,
    budget: `${formatUnitsString(spentUnits(plan))} of ${plan.totalBudget} ${plan.ticker} used`,
    giftsRemaining: remainingGifts(plan),
    nextRunAt: plan.status === "active" ? plan.nextRunAt : undefined,
    inFlight: plan.inFlight ? `since ${plan.inFlight.since}` : undefined,
    sent: plan.sent,
  };
}

/** Finds the gift an interrupted send created, by the claim-key address derived from the saved secret. */
async function findInFlightGift(secret: Hex): Promise<bigint | undefined> {
  if (!agent) return undefined;
  const claimKey = privateKeyToAddress(secret).toLowerCase();
  const next = await publicClient.readContract({ address: config.escrow, abi: GIFT_LOOKUP_ABI, functionName: "nextGiftId" });
  for (let id = next - 1n; id >= 1n && id >= next - 50n; id -= 1n) {
    const gift = await publicClient.readContract({ address: config.escrow, abi: GIFT_LOOKUP_ABI, functionName: "getGift", args: [id] });
    if (gift.claimKey.toLowerCase() === claimKey && gift.sender.toLowerCase() === agent.address.toLowerCase()) return id;
  }
  return undefined;
}

/** Resolves a plan left in flight by an interrupted run. Returns a note for the agent. */
async function reconcile(plan: RecurringPlan): Promise<string | undefined> {
  const inFlight = plan.inFlight;
  if (!inFlight) return undefined;
  const giftId = await findInFlightGift(inFlight.secret as Hex);
  if (giftId !== undefined) {
    const claimLink = buildClaimLink(config.appUrl, inFlight.secret as Hex, giftId);
    plans.update(plan.id, (stored) => recordSent(stored, { giftId: giftId.toString(), claimLink, transaction: "recovered after an interrupted run", sentAt: inFlight.since }));
    return `Recovered gift ${giftId} from an interrupted run. Deliver its link to ${plan.recipient}: ${claimLink}`;
  }
  if (Date.now() - new Date(inFlight.since).getTime() > IN_FLIGHT_TIMEOUT_MS) {
    plans.update(plan.id, (stored) => { stored.inFlight = undefined; });
    return "A previous send never reached the chain; the plan will retry.";
  }
  return "A send is still confirming; this plan is skipped for now.";
}

server.registerTool("create_recurring_plan", {
  title: "Create a recurring gift plan",
  description:
    "Sets up a recurring xStock gift, e.g. 0.01 AAPLx every 30 days, with a total budget. Creating the plan is the user's standing approval: " +
    "run_due_gifts then sends each gift when due without asking again, never above the budget. Requires confirm: true after the user approves the whole plan.",
  inputSchema: {
    ticker: z.enum(TICKERS).describe("Which xStock to gift"),
    amountPerGift: z.string().regex(/^\d+(\.\d+)?$/u).describe("Amount per gift in xStock units"),
    intervalDays: z.number().min(1 / 24).max(366).describe("Days between gifts (minimum 1 hour = 0.0417)"),
    totalBudget: z.string().regex(/^\d+(\.\d+)?$/u).describe("Total xStock units the plan may ever send"),
    recipient: z.string().min(1).max(120).describe("Who the links are for, e.g. \"Maya (maya@example.com)\""),
    note: z.string().max(140).optional().describe("Optional message stored as a hash with each gift"),
    startAt: z.string().optional().describe("ISO time of the first gift; defaults to now"),
    confirm: z.boolean().default(false).describe("Must be true, after the user approves the whole plan"),
  },
  annotations: { destructiveHint: true, openWorldHint: true },
}, async ({ ticker, amountPerGift, intervalDays, totalBudget, recipient, note, startAt, confirm }) => {
  const blocked = requireSpending(confirm);
  if (blocked) return failure(blocked);
  try {
    const plan = createPlan({
      ticker, amountPerGift, totalBudget, recipient, note,
      intervalSeconds: Math.round(intervalDays * 86_400),
      startAt: startAt ? new Date(startAt) : undefined,
    }, maxGiftAmount!);
    plans.write([...plans.read(), plan]);
    return result({ ...planSummary(plan), next: "Schedule run_due_gifts (e.g. daily) in your agent host. Each run sends only gifts that are due." });
  } catch (error) {
    return failure(error instanceof Error ? error.message : "The plan could not be created.");
  }
});

server.registerTool("list_recurring_plans", {
  title: "List recurring gift plans",
  description: "Shows every recurring plan with its budget used, gifts remaining, next run and the links already sent.",
  annotations: { readOnlyHint: true },
}, async () => result({ plans: plans.read().map(planSummary) }));

server.registerTool("cancel_recurring_plan", {
  title: "Cancel a recurring gift plan",
  description: "Stops a recurring plan. Gifts already sent are unaffected; unclaimed ones can be returned with reclaim_gift.",
  inputSchema: { planId: z.string().describe("Plan ID from list_recurring_plans") },
  annotations: { destructiveHint: false, idempotentHint: true },
}, async ({ planId }) => {
  try {
    const plan = plans.update(planId, (stored) => { if (stored.status === "active") stored.status = "cancelled"; });
    return result(planSummary(plan));
  } catch (error) {
    return failure(error instanceof Error ? error.message : "The plan could not be cancelled.");
  }
});

server.registerTool("run_due_gifts", {
  title: "Send due recurring gifts",
  description:
    "Sends every recurring gift that is due now, at most one per plan, within each plan's approved budget, and returns the new claim links. " +
    "Deliver each link privately to the plan's recipient. Safe to call on a schedule; runs never overlap and never double-send.",
  annotations: { destructiveHint: true, openWorldHint: true },
}, async () => {
  const blocked = requireSpending(true);
  if (blocked) return failure(blocked);
  try {
    return await plans.withLock(async () => {
      const notes: string[] = [];
      const delivered: unknown[] = [];
      for (const plan of plans.read()) {
        const note = await reconcile(plan);
        if (note) notes.push(`[${plan.id}] ${note}`);
      }
      const now = new Date();
      for (const plan of plans.read().filter((candidate) => isDue(candidate, now))) {
        if (toUnits(plan.amountPerGift) > toUnits(maxGiftAmount!)) {
          notes.push(`[${plan.id}] skipped: amount is above the current per-gift cap of ${maxGiftAmount}.`);
          continue;
        }
        const secret = randomSecret();
        plans.update(plan.id, (stored) => { stored.inFlight = { since: new Date().toISOString(), secret }; });
        try {
          const asset = await readXStock(plan.ticker as Ticker);
          const gift = await sender.createGift({ asset: asset.token, amount: plan.amountPerGift, note: plan.note, secret });
          const sent = { giftId: gift.giftId.toString(), claimLink: gift.claimLink, transaction: `${EXPLORER}/tx/${gift.createTransaction}`, sentAt: new Date().toISOString() };
          const updated = plans.update(plan.id, (stored) => recordSent(stored, sent));
          delivered.push({ planId: plan.id, recipient: plan.recipient, amount: `${plan.amountPerGift} ${plan.ticker}`, ...sent, giftsRemaining: remainingGifts(updated) });
        } catch (error) {
          // The transaction may or may not have landed; the next run reconciles it on chain.
          notes.push(`[${plan.id}] send failed: ${error instanceof Error ? error.message : "unknown error"}`);
        }
      }
      return result({
        delivered,
        notes,
        instruction: delivered.length ? "Deliver each claimLink privately to its recipient now." : "Nothing was due.",
      });
    });
  } catch (error) {
    return failure(error instanceof Error ? error.message : "run_due_gifts failed.");
  }
});

await server.connect(new StdioServerTransport());
