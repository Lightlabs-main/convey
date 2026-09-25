import { createPublicClient, formatUnits, http, parseAbiItem, parseEventLogs, type Address, type Hex } from "viem";

/**
 * Public gift activity, read only from GiftEscrow events on X Layer. Nothing
 * is counted off-chain. The public RPC serves at most 100 blocks per log
 * query, so history is scanned once in parallel chunks and then extended
 * incrementally from the last scanned block.
 */

export const dynamic = "force-dynamic";

const RPC_URL = process.env.NEXT_PUBLIC_XLAYER_RPC_URL ?? "https://rpc.xlayer.tech";
const ESCROW = (process.env.NEXT_PUBLIC_CONVEY_CLAIM_ESCROW_ADDRESS ?? "0xffd2DACE75dbC3bC3f2e10C6c7b011Aa4EC043cD") as Address;
const ESCROW_DEPLOY_BLOCK = 71_578_067n;
const CHUNK = 100n;
const CONCURRENCY = 4;
const CACHE_MS = 30_000;

const CREATED = parseAbiItem("event GiftCreated(uint256 indexed giftId, address indexed sender, address indexed asset, uint256 amount, address claimKey, bytes32 codeHash, uint64 expiry, bytes32 noteHash)");
const CLAIMED = parseAbiItem("event GiftClaimed(uint256 indexed giftId, address indexed claimer, uint256 amount)");
const RECLAIMED = parseAbiItem("event GiftReclaimed(uint256 indexed giftId, address indexed sender, uint256 amount)");

const TICKERS: Record<string, { ticker: string; issuer: string }> = {
  "0xa8ddb5cd96b5222afe198316e9a57caa642850d5": { ticker: "NVDAx", issuer: "NVDAx" },
  "0x943bf64d566c32a2bcd41ac92fb63c111cc9de8f": { ticker: "AAPLx", issuer: "AAPLx" },
  "0xc3fdbe3a68ee5de461d30415a8165cf9aefe1171": { ticker: "TSLAx", issuer: "TSLAx" },
};

interface GiftRecord {
  giftId: string;
  ticker: string;
  asset: Address;
  amount: string;
  sender: Address;
  createdAt: number;
  createdTx: Hex;
  status: "waiting" | "claimed" | "returned";
  recipient?: Address;
  settledAt?: number;
  settledTx?: Hex;
}

const client = createPublicClient({ transport: http(RPC_URL) });
const gifts = new Map<string, GiftRecord>();
const blockTimes = new Map<bigint, number>();
let scannedTo = ESCROW_DEPLOY_BLOCK - 1n;
let cached: { at: number; body: unknown } | undefined;
let scanning: Promise<void> | undefined;

async function blockTime(block: bigint): Promise<number> {
  const known = blockTimes.get(block);
  if (known !== undefined) return known;
  const { timestamp } = await withRetry(() => client.getBlock({ blockNumber: block }));
  blockTimes.set(block, Number(timestamp));
  return Number(timestamp);
}

async function withRetry<T>(task: () => Promise<T>, attempts = 5): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      if (attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
    }
  }
}

/** One log query per range; the three gift events are decoded from it. */
async function scanRange(from: bigint, to: bigint) {
  const logs = await withRetry(() => client.getLogs({ address: ESCROW, fromBlock: from, toBlock: to }));
  const events = parseEventLogs({ abi: [CREATED, CLAIMED, RECLAIMED], logs });
  return {
    created: events.filter((event) => event.eventName === "GiftCreated"),
    claimed: events.filter((event) => event.eventName === "GiftClaimed"),
    reclaimed: events.filter((event) => event.eventName === "GiftReclaimed"),
  };
}

async function scan(): Promise<void> {
  const head = await withRetry(() => client.getBlockNumber());
  const ranges: [bigint, bigint][] = [];
  for (let from = scannedTo + 1n; from <= head; from += CHUNK) ranges.push([from, from + CHUNK - 1n > head ? head : from + CHUNK - 1n]);
  const results: Awaited<ReturnType<typeof scanRange>>[] = [];
  for (let i = 0; i < ranges.length; i += CONCURRENCY) {
    results.push(...await Promise.all(ranges.slice(i, i + CONCURRENCY).map(([from, to]) => scanRange(from, to))));
  }
  for (const { created } of results) {
    for (const log of created) {
      const asset = log.args.asset!.toLowerCase() as Address;
      gifts.set(log.args.giftId!.toString(), {
        giftId: log.args.giftId!.toString(),
        ticker: TICKERS[asset]?.ticker ?? "xStock",
        asset,
        amount: formatUnits(log.args.amount!, 18),
        sender: log.args.sender!,
        createdAt: await blockTime(log.blockNumber),
        createdTx: log.transactionHash,
        status: "waiting",
      });
    }
  }
  for (const { claimed, reclaimed } of results) {
    for (const log of [...claimed, ...reclaimed]) {
      const gift = gifts.get(log.args.giftId!.toString());
      if (!gift) continue;
      const isClaim = log.eventName === "GiftClaimed";
      gift.status = isClaim ? "claimed" : "returned";
      if (isClaim) gift.recipient = (log.args as { claimer: Address }).claimer;
      gift.settledAt = await blockTime(log.blockNumber);
      gift.settledTx = log.transactionHash;
    }
  }
  scannedTo = head;
}

/** Live value of one wrapper unit: issuer price x wrapper multiplier. Undefined when either read fails. */
async function unitValues(): Promise<Record<string, number>> {
  const entries = await Promise.all(Object.values(TICKERS).map(async ({ ticker, issuer }) => {
    try {
      const base = `https://api.backed.fi/api/v2/public/assets/${issuer}`;
      const [price, multiplier] = await Promise.all([
        fetch(`${base}/price-data`, { cache: "no-store" }).then((r) => r.json() as Promise<{ quote?: number }>),
        fetch(`${base}/multiplier?network=XLayer`, { cache: "no-store" }).then((r) => r.json() as Promise<{ currentMultiplier?: number }>),
      ]);
      return typeof price.quote === "number" && typeof multiplier.currentMultiplier === "number"
        ? [[ticker, price.quote * multiplier.currentMultiplier]] as const
        : [];
    } catch {
      return [];
    }
  }));
  return Object.fromEntries(entries.flat());
}

export async function GET(): Promise<Response> {
  if (cached && Date.now() - cached.at < CACHE_MS) return Response.json(cached.body, { headers: { "cache-control": "no-store" } });
  try {
    scanning ??= scan().finally(() => { scanning = undefined; });
    await scanning;
    const values = await unitValues();
    const all = [...gifts.values()].sort((a, b) => Number(b.giftId) - Number(a.giftId));
    const claimed = all.filter((gift) => gift.status === "claimed");
    const body = {
      escrow: ESCROW,
      scannedTo: scannedTo.toString(),
      stats: {
        sent: all.length,
        claimed: claimed.length,
        recipients: new Set(claimed.map((gift) => gift.recipient!.toLowerCase())).size,
        recipientGasOkb: 0,
      },
      recent: all.slice(0, 8).map((gift) => ({
        ...gift,
        valueUsd: values[gift.ticker] !== undefined ? Number(gift.amount) * values[gift.ticker] : undefined,
      })),
    };
    cached = { at: Date.now(), body };
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "activity_unavailable" }, { status: 503 });
  }
}
