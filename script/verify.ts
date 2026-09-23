import { writeFile } from "node:fs/promises";
import { redactRpcUrl } from "./rpc-config.ts";

const RPC_URL = process.env.XLAYER_RPC_URL ?? "https://rpc.xlayer.tech";
const PINNED_BLOCK = process.env.XLAYER_PINNED_BLOCK ?? "0x43f886a";
const OUTPUT_PATH = process.env.XLAYER_VERIFICATION_OUTPUT ?? "docs/verification.raw.json";
const EXPECTED_CHAIN_ID = 196n;

const addresses = {
  entryPointV06: "0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789",
  entryPointV07: "0x0000000071727de22e5e9d8baf0edac6f37da032",
  entryPointV08: "0x4337084d9e255ff0702461cf8895ce9e3b5ff108",
  uniswapV3Factory: "0x4b2ab38dbf28d31d467aa8993f6c2585981d6804",
  quoterV2: "0xd1b797d92d87b688193a2b976efc8d577d204343",
  usdt0: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
  usdg: "0x4ae46a509f6b1d9056937ba4500cb143933d2dc8",
  okxSmartWalletFactory: "0xdd3fea01cd550c9effc893f346690b9a649f35ef",
  okxSmartWalletImplementation: "0xe40ccb2d94975c51bff0c004efdfd9b3a5796fa4",
} as const;

const assets = [
  { symbol: "NVDAx", wrapper: "0xa8ddb5cd96b5222afe198316e9a57caa642850d5" },
  { symbol: "TSLAx", wrapper: "0xc3fdbe3a68ee5de461d30415a8165cf9aefe1171" },
  { symbol: "AAPLx", wrapper: "0x943bf64d566c32a2bcd41ac92fb63c111cc9de8f" },
] as const;

let rpcId = 0;
async function rpc(method: string, params: unknown[]) {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result as string;
}

async function api(path: string) {
  const response = await fetch(`https://api.backed.fi/api/v2/public${path}`);
  if (!response.ok) throw new Error(`xStocks API HTTP ${response.status}: ${path}`);
  return response.json();
}

const word = (value: string | bigint) =>
  (typeof value === "bigint" ? value.toString(16) : value.toLowerCase().replace(/^0x/, "")).padStart(64, "0");
const addressFromWord = (hex: string) => `0x${hex.slice(-40)}`.toLowerCase();
const uint = (hex: string, index = 0) => BigInt(`0x${hex.slice(2 + index * 64, 2 + (index + 1) * 64)}`);
const feeBytes = (fee: number) => fee.toString(16).padStart(6, "0");
const encodeQuoteExactInput = (path: string, amountIn: bigint) => {
  const cleanPath = path.replace(/^0x/, "");
  const byteLength = BigInt(cleanPath.length / 2);
  const paddedPath = cleanPath.padEnd(Math.ceil(cleanPath.length / 64) * 64, "0");
  return `0xcdca1753${word(64n)}${word(amountIn)}${word(byteLength)}${paddedPath}`;
};

async function call(to: string, data: string) {
  return rpc("eth_call", [{ to, data }, PINNED_BLOCK]);
}

async function main() {
  const chainId = BigInt(await rpc("eth_chainId", []));
  if (chainId !== EXPECTED_CHAIN_ID) throw new Error(`chainId ${chainId}, expected ${EXPECTED_CHAIN_ID}`);
  const block = await rpc("eth_getBlockByNumber", [PINNED_BLOCK, false]) as any;
  if (!block) throw new Error(`Pinned block ${PINNED_BLOCK} unavailable`);
  const gasPrice = BigInt(await rpc("eth_gasPrice", []));

  const entryPoints: Record<string, { address: string; codeBytes: number }> = {};
  for (const [version, address] of Object.entries({ v06: addresses.entryPointV06, v07: addresses.entryPointV07, v08: addresses.entryPointV08 })) {
    const code = await rpc("eth_getCode", [address, PINNED_BLOCK]);
    const codeBytes = (code.length - 2) / 2;
    if (codeBytes === 0) throw new Error(`EntryPoint ${version} has no code`);
    entryPoints[version] = { address, codeBytes };
  }

  const [okxFactoryCode, okxImplementationCode, okxWalletEntryPointResult] = await Promise.all([
    rpc("eth_getCode", [addresses.okxSmartWalletFactory, PINNED_BLOCK]),
    rpc("eth_getCode", [addresses.okxSmartWalletImplementation, PINNED_BLOCK]),
    call(addresses.okxSmartWalletImplementation, "0xb0d691fe"),
  ]);
  const okxWalletEntryPoint = addressFromWord(okxWalletEntryPointResult);
  if (okxWalletEntryPoint !== addresses.entryPointV07) throw new Error(`OKX wallet uses unexpected EntryPoint ${okxWalletEntryPoint}`);

  const usdt0Decimals = Number(uint(await call(addresses.usdt0, "0x313ce567")));
  if (usdt0Decimals !== 6) throw new Error(`USDT0 decimals ${usdt0Decimals}, expected 6`);

  const verifiedAssets = [];
  for (const asset of assets) {
    const [metadata, multiplier, priceData, decimalsHex, underlyingHex] = await Promise.all([
      api(`/assets/${asset.symbol}`),
      api(`/assets/${asset.symbol}/multiplier?network=XLayer`),
      api(`/assets/${asset.symbol}/price-data`),
      call(asset.wrapper, "0x313ce567"),
      call(asset.wrapper, "0x38d52e0f"),
    ]);
    const deployment = metadata.deployments.find((item: any) => item.network === "XLayer");
    if (!deployment) throw new Error(`${asset.symbol}: no XLayer issuer deployment`);
    if (deployment.wrapperAddressV2?.toLowerCase() !== asset.wrapper) throw new Error(`${asset.symbol}: wrapper is not issuer-certified V2`);
    const decimals = Number(uint(decimalsHex));
    const underlying = addressFromWord(underlyingHex);
    if (underlying !== deployment.address.toLowerCase()) throw new Error(`${asset.symbol}: asset() differs from issuer deployment`);
    if (decimals !== 18) throw new Error(`${asset.symbol}: unexpected decimals ${decimals}`);

    const pools = [];
    const usdgPools = [];
    for (const fee of [100n, 500n, 3000n, 10000n]) {
      const data = `0x1698ee82${word(asset.wrapper)}${word(addresses.usdt0)}${word(fee)}`;
      const pool = addressFromWord(await call(addresses.uniswapV3Factory, data));
      if (pool !== "0x0000000000000000000000000000000000000000") pools.push({ fee: Number(fee), pool });
      const usdgData = `0x1698ee82${word(asset.wrapper)}${word(addresses.usdg)}${word(fee)}`;
      const usdgPool = addressFromWord(await call(addresses.uniswapV3Factory, usdgData));
      if (usdgPool !== "0x0000000000000000000000000000000000000000") usdgPools.push({ fee: Number(fee), pool: usdgPool });
    }

    const stablePools = [];
    for (const fee of [100n, 500n, 3000n, 10000n]) {
      const data = `0x1698ee82${word(addresses.usdg)}${word(addresses.usdt0)}${word(fee)}`;
      const pool = addressFromWord(await call(addresses.uniswapV3Factory, data));
      if (pool !== "0x0000000000000000000000000000000000000000") stablePools.push({ fee: Number(fee), pool });
    }

    const quotes: Record<string, unknown> = {};
    for (const usd of [5, 20, 50]) {
      const tokenPrice = Number(priceData.quote) * Number(multiplier.currentMultiplier);
      const amountIn = BigInt(Math.floor((usd / tokenPrice) * 1e18));
      const candidates = [];
      for (const pool of pools) {
        const data = `0xc6a5026a${word(asset.wrapper)}${word(addresses.usdt0)}${word(amountIn)}${word(BigInt(pool.fee))}${word(0n)}`;
        try {
          const result = await call(addresses.quoterV2, data);
          candidates.push({ fee: pool.fee, pool: pool.pool, amountOut: uint(result, 0), gasEstimate: uint(result, 3) });
        } catch (error) {
          candidates.push({ fee: pool.fee, pool: pool.pool, error: String(error) });
        }
      }
      for (const first of usdgPools) {
        for (const second of stablePools) {
          const path = `${asset.wrapper}${feeBytes(first.fee)}${addresses.usdg.slice(2)}${feeBytes(second.fee)}${addresses.usdt0.slice(2)}`;
          try {
            const result = await call(addresses.quoterV2, encodeQuoteExactInput(path, amountIn));
            candidates.push({ fees: [first.fee, second.fee], pools: [first.pool, second.pool], via: "USDG", amountOut: uint(result, 0), gasEstimate: uint(result, 3) });
          } catch (error) {
            candidates.push({ fees: [first.fee, second.fee], pools: [first.pool, second.pool], via: "USDG", error: String(error) });
          }
        }
      }
      const executable = candidates.filter((item: any) => item.amountOut).sort((a: any, b: any) => a.amountOut > b.amountOut ? -1 : 1)[0] as any;
      const bestAmountOut = executable?.amountOut ?? null;
      quotes[`$${usd}`] = {
        amountIn: amountIn.toString(),
        bestAmountOut: bestAmountOut?.toString() ?? null,
        executableUsd: bestAmountOut === null ? null : Number(bestAmountOut) / 1e6,
        // This compares an executable pool quote with a nominal amount derived
        // from the issuer's current indicative quote. It is not AMM price impact:
        // measuring that requires a spot/TWAP baseline from the same block.
        executableDeltaFromNominalPercent: bestAmountOut === null ? null : ((usd - Number(bestAmountOut) / 1e6) / usd) * 100,
        fee: executable?.fee ?? null,
        pool: executable?.pool ?? null,
        fees: executable?.fees ?? null,
        pools: executable?.pools ?? null,
        via: executable?.via ?? null,
        candidates,
      };
    }
    verifiedAssets.push({ symbol: asset.symbol, wrapper: asset.wrapper, underlying, decimals, multiplier, issuerQuoteUsd: priceData.quote, directUsdt0Pools: pools, usdgPools, stablePools, quotes });
  }

  const result = {
    observedAt: new Date().toISOString(),
    evidenceModel: {
      onchain: `eth_call and bytecode reads pinned to block ${Number(BigInt(block.number))}`,
      issuerApi: "live, timestamped at observedAt; the API does not expose historical snapshots",
      warning: "Reruns at the same pinned block can produce different input amounts because issuer quotes and multipliers are live",
    },
    rpcUrl: redactRpcUrl(RPC_URL),
    chainId: Number(chainId),
    pinnedBlock: { number: Number(BigInt(block.number)), hex: block.number, hash: block.hash, timestamp: new Date(Number(BigInt(block.timestamp)) * 1000).toISOString(), baseFeeWei: BigInt(block.baseFeePerGas).toString(), gasPriceWei: gasPrice.toString() },
    entryPoints,
    okxSmartWallet: {
      factory: addresses.okxSmartWalletFactory,
      factoryCodeBytes: (okxFactoryCode.length - 2) / 2,
      implementation: addresses.okxSmartWalletImplementation,
      implementationCodeBytes: (okxImplementationCode.length - 2) / 2,
      entryPoint: okxWalletEntryPoint,
      sourceRevisionInspected: "95aa59bbc22acd4573a9932e959384fe56c7b543",
      erc7579InterfaceFoundInSource: false,
    },
    usdt0: { address: addresses.usdt0, decimals: usdt0Decimals },
    uniswapV3: { factory: addresses.uniswapV3Factory, quoterV2: addresses.quoterV2 },
    assets: verifiedAssets,
  };
  await writeFile(OUTPUT_PATH, `${JSON.stringify(result, (_, value) => typeof value === "bigint" ? value.toString() : value, 2)}\n`);
  console.log(JSON.stringify(result, (_, value) => typeof value === "bigint" ? value.toString() : value, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
