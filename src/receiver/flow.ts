import {
  createPublicClient,
  defineChain,
  encodeFunctionData,
  http,
  isAddress,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import { buildOkxClaimUserOperation, type BuiltOkxClaimUserOperation, type OkxClaimGas, type OkxEcdsaMessageSigner } from "../relayer/okx.ts";
import { ConveyRelayerClient } from "../relayer/client.ts";
import { XLAYER_CHAIN_ID, XLAYER_ENTRYPOINT_V07 } from "../relayer/config.ts";
import type { ClaimGasSeed, ClaimPaymasterAuthorizationResponse, UserOperationGasEstimate } from "../relayer/types.ts";
import { enrollReceiverPasskey, unlockReceiverPasskey } from "./passkey.ts";
import { receiverSignerFromPrivateKey } from "./signer.ts";
import { storedReceiverVault, type ReceiverVaultStorage } from "./storage.ts";
import {
  enrollReceiverKey,
  unlockReceiverKey,
  rewrapRecoveredReceiverKey,
} from "./vault.ts";

const ZERO_BYTES = "0x" as Hex;
const CLAIM_PAYMASTER_PLACEHOLDER = `0x${"00".repeat(141)}` as Hex;

const ESCROW_ABI = [
  {
    type: "function",
    name: "registry",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "registry", type: "address" }],
  },
  {
    type: "function",
    name: "getGift",
    stateMutability: "view",
    inputs: [{ name: "giftId", type: "uint256" }],
    outputs: [
      {
        name: "gift",
        type: "tuple",
        components: [
          { name: "sender", type: "address" },
          { name: "asset", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "secretHash", type: "bytes32" },
          { name: "codeHash", type: "bytes32" },
          { name: "expiry", type: "uint64" },
          { name: "noteHash", type: "bytes32" },
          { name: "state", type: "uint8" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [
      { name: "giftId", type: "uint256" },
      { name: "secret", type: "bytes" },
      { name: "code", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

const REGISTRY_ABI = [{
  type: "function",
  name: "getAsset",
  stateMutability: "view",
  inputs: [{ name: "token", type: "address" }],
  outputs: [{ name: "entry", type: "tuple", components: [
    { name: "token", type: "address" },
    { name: "kind", type: "uint8" },
    { name: "decimals", type: "uint8" },
    { name: "isWrapped", type: "bool" },
    { name: "underlying", type: "address" },
    { name: "valuation", type: "uint8" },
    { name: "valuationRef", type: "address" },
    { name: "cashOutRoute", type: "address" },
    { name: "certified", type: "bool" },
    { name: "enabled", type: "bool" },
    { name: "riskTag", type: "string" },
  ] }],
}] as const;

const ERC20_METADATA_ABI = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

const WRAPPER_ABI = [{
  type: "function",
  name: "convertToAssets",
  stateMutability: "view",
  inputs: [{ name: "shares", type: "uint256" }],
  outputs: [{ name: "assets", type: "uint256" }],
}] as const;

export interface ParsedClaimLink {
  giftId: bigint;
  secret: Hex;
}

export interface ReceiverGiftPreview {
  giftId: bigint;
  registry: Address;
  sender: Address;
  asset: Address;
  amount: bigint;
  symbol: string;
  decimals: number;
  isWrapped: boolean;
  underlying: Address;
  valuation: number;
  cashOutRoute: Address;
  certified: boolean;
  enabled: boolean;
  riskTag: string;
  secretHash: Hex;
  codeRequired: boolean;
  expiry: bigint;
  noteHash: Hex;
  state: "open" | "claimed" | "reclaimed";
  expired: boolean;
  blockTimestamp: bigint;
}

export interface ReceiverAccountSession {
  owner: Address;
  signer: OkxEcdsaMessageSigner;
}

export interface EnrolledReceiverAccount {
  owner: Address;
  credentialId: string;
  recoveryKey: Hex;
  /** Short-lived in-memory signer from the enrollment ceremony. */
  session: ReceiverAccountSession;
}

export interface ReceiverEnrollmentOptions {
  storage: ReceiverVaultStorage;
  userName: string;
  displayName: string;
  rpName?: string;
  rpId?: string;
  userId?: Uint8Array;
}

export interface ReceiverRecoveryOptions {
  storage: ReceiverVaultStorage;
  recoveryKey: Hex;
  userName: string;
  displayName: string;
  rpName?: string;
  rpId?: string;
  userId?: Uint8Array;
}

export interface ReceiverClaimBuildOptions {
  claim: ParsedClaimLink;
  code?: string;
  executionRpcUrl: string;
  entryPoint?: Address;
  factory: Address;
  implementation: Address;
  escrow: Address;
  claimFunctionSelector: Hex;
  paymaster: Address;
  signer: OkxEcdsaMessageSigner;
  salt: bigint;
  gas: OkxClaimGas;
  paymasterVerificationGasLimit: bigint;
  paymasterPostOpGasLimit: bigint;
  relay: ConveyRelayerClient;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface BuiltReceiverClaim {
  account: Address;
  deployed: boolean;
  claimData: Hex;
  authorization: ClaimPaymasterAuthorizationResponse;
  userOperation: BuiltOkxClaimUserOperation;
}

export interface ReceiverClaimGasSeed {
  gas: OkxClaimGas;
  paymasterVerificationGasLimit: bigint;
  paymasterPostOpGasLimit: bigint;
}

export interface PreparedReceiverClaim extends BuiltReceiverClaim {
  estimate: UserOperationGasEstimate;
  gas: ReceiverClaimGasSeed;
}

export interface ReceiverClaimPreparationOptions extends Omit<ReceiverClaimBuildOptions, "gas" | "paymasterVerificationGasLimit" | "paymasterPostOpGasLimit"> {
  gasSeed: ReceiverClaimGasSeed;
  maxPasses?: number;
}

export interface ReceiverGiftValuation {
  symbol: string;
  tokenAmount: bigint;
  underlyingAmount: bigint;
  underlyingDecimals: number;
  underlyingPriceUsd: number;
  estimatedUsd: number;
  multiplier: number;
  observedAt: string;
  source: "issuer-api";
}

function randomUserId(): Uint8Array {
  if (!globalThis.crypto?.getRandomValues) throw new Error("Web Crypto is required for receiver enrollment");
  return globalThis.crypto.getRandomValues(new Uint8Array(32));
}

function positiveGiftId(value: bigint): bigint {
  if (typeof value !== "bigint" || value <= 0n) throw new Error("giftId must be greater than zero");
  return value;
}

function tupleValue(value: unknown, key: string, index: number): unknown {
  if (Array.isArray(value)) return value[index];
  if (value && typeof value === "object" && key in value) return (value as Record<string, unknown>)[key];
  throw new Error(`escrow returned an invalid gift tuple (${key})`);
}

function addressValue(value: unknown, name: string): Address {
  if (typeof value !== "string" || !isAddress(value)) throw new Error(`escrow returned an invalid ${name}`);
  return value as Address;
}

function bigintValue(value: unknown, name: string): bigint {
  if (typeof value !== "bigint") throw new Error(`escrow returned an invalid ${name}`);
  return value;
}

function numberValue(value: unknown, name: string): number {
  if (typeof value !== "number" && typeof value !== "bigint") throw new Error(`escrow returned an invalid ${name}`);
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error(`escrow returned an invalid ${name}`);
  return result;
}

/**
 * Parses the shareable link. The secret is the bearer credential; giftId is a
 * non-secret lookup hint because GiftEscrow deliberately has no secret-to-ID
 * mapping. No secret is sent to the gateway until the signed claim operation.
 */
export function parseClaimLink(value: string): ParsedClaimLink {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("claim link is not a valid URL");
  }
  const match = /^\/g\/([0-9a-fA-F]{64})\/?$/u.exec(url.pathname);
  if (!match) throw new Error("claim link must contain a 32-byte secret at /g/<secret>");
  const rawGiftId = url.searchParams.get("giftId");
  if (!rawGiftId || !/^\d+$/u.test(rawGiftId)) throw new Error("claim link is missing a valid giftId");
  const giftId = positiveGiftId(BigInt(rawGiftId));
  return { giftId, secret: `0x${match[1].toLowerCase()}` as Hex };
}

export function buildClaimCalldata(claim: ParsedClaimLink, code?: string): Hex {
  positiveGiftId(claim.giftId);
  if (!/^0x[0-9a-fA-F]{64}$/u.test(claim.secret)) throw new Error("claim secret must contain exactly 32 bytes");
  return encodeFunctionData({
    abi: ESCROW_ABI,
    functionName: "claim",
    args: [claim.giftId, claim.secret, code === undefined ? ZERO_BYTES : stringToHex(code)],
  });
}

export async function readGiftPreview(
  executionRpcUrl: string,
  escrow: Address,
  claim: ParsedClaimLink,
): Promise<ReceiverGiftPreview> {
  positiveGiftId(claim.giftId);
  if (!isAddress(escrow)) throw new Error("escrow must be an EVM address");
  const client = createPublicClient({
    chain: defineChain({
      id: XLAYER_CHAIN_ID,
      name: "X Layer",
      nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
      rpcUrls: { default: { http: [executionRpcUrl] } },
    }),
    transport: http(executionRpcUrl),
  });
  const [giftValue, block, registry] = await Promise.all([
    client.readContract({ address: escrow, abi: ESCROW_ABI, functionName: "getGift", args: [claim.giftId] }),
    client.getBlock(),
    client.readContract({ address: escrow, abi: ESCROW_ABI, functionName: "registry" }),
  ]);
  const tuple = giftValue as unknown;
  const stateValue = numberValue(tupleValue(tuple, "state", 7), "gift state");
  if (stateValue > 2) throw new Error("escrow returned an unknown gift state");
  const expiry = bigintValue(tupleValue(tuple, "expiry", 5), "gift expiry");
  const asset = addressValue(tupleValue(tuple, "asset", 1), "asset");
  const registryAddress = addressValue(registry, "asset registry");
  const [assetValue, symbol, decimals] = await Promise.all([
    client.readContract({ address: registryAddress, abi: REGISTRY_ABI, functionName: "getAsset", args: [asset] }),
    client.readContract({ address: asset, abi: ERC20_METADATA_ABI, functionName: "symbol" }),
    client.readContract({ address: asset, abi: ERC20_METADATA_ABI, functionName: "decimals" }),
  ]);
  const assetTuple = assetValue as unknown;
  if (typeof symbol !== "string" || !symbol) throw new Error("asset returned an invalid symbol");
  const assetDecimals = numberValue(decimals, "asset decimals");
  return {
    giftId: claim.giftId,
    registry: registryAddress,
    sender: addressValue(tupleValue(tuple, "sender", 0), "sender"),
    asset,
    amount: bigintValue(tupleValue(tuple, "amount", 2), "gift amount"),
    symbol,
    decimals: assetDecimals,
    isWrapped: tupleValue(assetTuple, "isWrapped", 3) as boolean,
    underlying: addressValue(tupleValue(assetTuple, "underlying", 4), "underlying asset"),
    valuation: numberValue(tupleValue(assetTuple, "valuation", 5), "valuation source"),
    cashOutRoute: addressValue(tupleValue(assetTuple, "cashOutRoute", 7), "cash-out route"),
    certified: tupleValue(assetTuple, "certified", 8) as boolean,
    enabled: tupleValue(assetTuple, "enabled", 9) as boolean,
    riskTag: tupleValue(assetTuple, "riskTag", 10) as string,
    secretHash: tupleValue(tuple, "secretHash", 3) as Hex,
    codeRequired: (tupleValue(tuple, "codeHash", 4) as Hex).toLowerCase() !== `0x${"00".repeat(32)}`,
    expiry,
    noteHash: tupleValue(tuple, "noteHash", 6) as Hex,
    state: (["open", "claimed", "reclaimed"] as const)[stateValue],
    expired: stateValue === 0 && expiry !== 0n && block.timestamp >= expiry,
    blockTimestamp: block.timestamp,
  };
}

function finiteNumber(value: unknown, name: string): number {
  const result = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(result) || result <= 0) throw new Error(`issuer API returned an invalid ${name}`);
  return result;
}

/**
 * Reads the display value for a wrapped xStock from the live wrapper and the
 * live issuer API. Wrapper conversion supplies accounting units only; the API
 * quote supplies the independent underlying price.
 */
export async function readLiveGiftValuation(
  executionRpcUrl: string,
  preview: ReceiverGiftPreview,
  fetchImpl: typeof fetch = fetch,
): Promise<ReceiverGiftValuation> {
  if (!preview.isWrapped || preview.valuation !== 1) {
    throw new Error("this asset does not have a live issuer valuation path");
  }
  const client = createPublicClient({
    chain: defineChain({
      id: XLAYER_CHAIN_ID,
      name: "X Layer",
      nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
      rpcUrls: { default: { http: [executionRpcUrl] } },
    }),
    transport: http(executionRpcUrl),
  });
  const [underlyingAmount, underlyingDecimals, priceResponse, multiplierResponse] = await Promise.all([
    client.readContract({ address: preview.asset, abi: WRAPPER_ABI, functionName: "convertToAssets", args: [preview.amount] }),
    client.readContract({ address: preview.underlying, abi: ERC20_METADATA_ABI, functionName: "decimals" }),
    fetchImpl(`https://api.backed.fi/api/v2/public/assets/${encodeURIComponent(preview.symbol)}/price-data`).then(async (response) => {
      if (!response.ok) throw new Error(`issuer price API returned HTTP ${response.status}`);
      return response.json() as Promise<unknown>;
    }),
    fetchImpl(`https://api.backed.fi/api/v2/public/assets/${encodeURIComponent(preview.symbol)}/multiplier?network=XLayer`).then(async (response) => {
      if (!response.ok) throw new Error(`issuer multiplier API returned HTTP ${response.status}`);
      return response.json() as Promise<unknown>;
    }),
  ]);
  const priceRecord = priceResponse && typeof priceResponse === "object" ? priceResponse as Record<string, unknown> : {};
  const multiplierRecord = multiplierResponse && typeof multiplierResponse === "object" ? multiplierResponse as Record<string, unknown> : {};
  const price = finiteNumber(priceRecord.quote, "underlying price");
  const multiplier = finiteNumber(multiplierRecord.currentMultiplier, "wrapper multiplier");
  const decimals = numberValue(underlyingDecimals, "underlying decimals");
  const estimatedUsd = Number(underlyingAmount) / (10 ** decimals) * price;
  if (!Number.isFinite(estimatedUsd) || estimatedUsd < 0) throw new Error("live gift valuation is outside display range");
  return {
    symbol: preview.symbol,
    tokenAmount: preview.amount,
    underlyingAmount,
    underlyingDecimals: decimals,
    underlyingPriceUsd: price,
    estimatedUsd,
    multiplier,
    observedAt: new Date().toISOString(),
    source: "issuer-api",
  };
}

export async function enrollReceiverAccount(options: ReceiverEnrollmentOptions): Promise<EnrolledReceiverAccount> {
  const passkey = await enrollReceiverPasskey({
    userId: options.userId ?? randomUserId(),
    userName: options.userName,
    displayName: options.displayName,
    rpName: options.rpName,
    rpId: options.rpId,
  });
  const enrollment = await enrollReceiverKey(passkey.credentialId, passkey.prfOutput);
  options.storage.save(storedReceiverVault(enrollment, passkey.prfSalt));
  const privateKey = await unlockReceiverKey(enrollment.vault, passkey.prfOutput);
  return {
    owner: enrollment.vault.owner,
    credentialId: passkey.credentialId,
    recoveryKey: enrollment.recoveryKey,
    session: { owner: enrollment.vault.owner, signer: receiverSignerFromPrivateKey(privateKey) },
  };
}

export async function unlockReceiverAccount(
  storage: ReceiverVaultStorage,
  rpId?: string,
): Promise<ReceiverAccountSession> {
  const stored = storage.load();
  if (!stored) throw new Error("receiver account is not enrolled on this device");
  const prfOutput = await unlockReceiverPasskey(stored.vault.credentialId, stored.prfSalt, rpId);
  const privateKey = await unlockReceiverKey(stored.vault, prfOutput);
  return { owner: stored.vault.owner, signer: receiverSignerFromPrivateKey(privateKey) };
}

export async function recoverReceiverAccount(options: ReceiverRecoveryOptions): Promise<EnrolledReceiverAccount> {
  const stored = options.storage.load();
  if (!stored) throw new Error("receiver account is not enrolled on this device");
  const passkey = await enrollReceiverPasskey({
    userId: options.userId ?? randomUserId(),
    userName: options.userName,
    displayName: options.displayName,
    rpName: options.rpName,
    rpId: options.rpId,
  });
  const vault = await rewrapRecoveredReceiverKey(
    stored.recovery,
    options.recoveryKey,
    passkey.credentialId,
    passkey.prfOutput,
  );
  options.storage.save({ version: 1, vault, recovery: stored.recovery, prfSalt: passkey.prfSalt });
  const privateKey = await unlockReceiverKey(vault, passkey.prfOutput);
  return {
    owner: vault.owner,
    credentialId: vault.credentialId,
    recoveryKey: options.recoveryKey,
    session: { owner: vault.owner, signer: receiverSignerFromPrivateKey(privateKey) },
  };
}

function requireEstimateValue(value: string | undefined, name: string): bigint {
  if (!value || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u.test(value)) {
    throw new Error(`live claim estimate is missing ${name}`);
  }
  return BigInt(value);
}

/**
 * Builds the two-pass receiver claim. The first pass is unsigned and contains
 * a zeroed 141-byte authorization field; the private gateway signs the live
 * operation fields. The second pass signs the exact returned authorization.
 */
export async function buildReceiverClaim(options: ReceiverClaimBuildOptions): Promise<BuiltReceiverClaim> {
  const entryPoint = options.entryPoint ?? XLAYER_ENTRYPOINT_V07;
  const claimData = buildClaimCalldata(options.claim, options.code);
  const provisional = await buildOkxClaimUserOperation({
    executionRpcUrl: options.executionRpcUrl,
    entryPoint,
    factory: options.factory,
    implementation: options.implementation,
    signer: options.signer,
    salt: options.salt,
    escrow: options.escrow,
    claimFunctionSelector: options.claimFunctionSelector,
    claimData,
    gas: options.gas,
    paymaster: {
      address: options.paymaster,
      verificationGasLimit: options.paymasterVerificationGasLimit,
      postOpGasLimit: options.paymasterPostOpGasLimit,
      data: CLAIM_PAYMASTER_PLACEHOLDER,
    },
    validUntil: 0n,
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
  });
  const authorization = await options.relay.authorizeClaim({ ...provisional.rpcUserOperation, signature: "0x" });
  const final = await buildOkxClaimUserOperation({
    executionRpcUrl: options.executionRpcUrl,
    entryPoint,
    factory: options.factory,
    implementation: options.implementation,
    signer: options.signer,
    salt: options.salt,
    escrow: options.escrow,
    claimFunctionSelector: options.claimFunctionSelector,
    claimData,
    gas: options.gas,
    paymaster: {
      address: authorization.paymaster,
      verificationGasLimit: requireEstimateValue(authorization.paymasterVerificationGasLimit, "paymasterVerificationGasLimit"),
      postOpGasLimit: requireEstimateValue(authorization.paymasterPostOpGasLimit, "paymasterPostOpGasLimit"),
      data: authorization.paymasterData,
    },
    validUntil: requireEstimateValue(authorization.validUntil, "validUntil"),
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
  });
  return {
    account: final.account,
    deployed: final.deployed,
    claimData,
    authorization,
    userOperation: final,
  };
}

export function liveGasFromEstimate(estimate: UserOperationGasEstimate, gasFees: Pick<OkxClaimGas, "maxFeePerGas" | "maxPriorityFeePerGas">): OkxClaimGas {
  return {
    callGasLimit: requireEstimateValue(estimate.callGasLimit, "callGasLimit"),
    verificationGasLimit: requireEstimateValue(estimate.verificationGasLimit, "verificationGasLimit"),
    preVerificationGas: requireEstimateValue(estimate.preVerificationGas, "preVerificationGas"),
    maxFeePerGas: gasFees.maxFeePerGas,
    maxPriorityFeePerGas: gasFees.maxPriorityFeePerGas,
  };
}

function positiveEstimateValue(value: string | undefined, name: string): bigint {
  const result = requireEstimateValue(value, name);
  if (result <= 0n) throw new Error(`live claim estimate returned an empty ${name}`);
  return result;
}

function maxBigint(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

export function receiverClaimGasSeedFromLive(seed: ClaimGasSeed): ReceiverClaimGasSeed {
  return {
    gas: {
      callGasLimit: positiveEstimateValue(seed.callGasLimit, "callGasLimit"),
      verificationGasLimit: positiveEstimateValue(seed.verificationGasLimit, "verificationGasLimit"),
      preVerificationGas: positiveEstimateValue(seed.preVerificationGas, "preVerificationGas"),
      maxFeePerGas: positiveEstimateValue(seed.maxFeePerGas, "maxFeePerGas"),
      maxPriorityFeePerGas: positiveEstimateValue(seed.maxPriorityFeePerGas, "maxPriorityFeePerGas"),
    },
    paymasterVerificationGasLimit: positiveEstimateValue(seed.paymasterVerificationGasLimit, "paymasterVerificationGasLimit"),
    paymasterPostOpGasLimit: positiveEstimateValue(seed.paymasterPostOpGasLimit, "paymasterPostOpGasLimit"),
  };
}

/**
 * Authorizes and estimates the exact signed operation. If the live bundler
 * reports a larger limit, the operation is rebuilt with those returned fields
 * and re-authorized. No gas number is invented by the receiver flow.
 */
export async function prepareReceiverClaim(options: ReceiverClaimPreparationOptions): Promise<PreparedReceiverClaim> {
  const maxPasses = options.maxPasses ?? 3;
  if (!Number.isInteger(maxPasses) || maxPasses < 1 || maxPasses > 5) throw new Error("maxPasses must be between 1 and 5");
  let gas = options.gasSeed.gas;
  let paymasterVerificationGasLimit = options.gasSeed.paymasterVerificationGasLimit;
  let paymasterPostOpGasLimit = options.gasSeed.paymasterPostOpGasLimit;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const built = await buildReceiverClaim({
      ...options,
      gas,
      paymasterVerificationGasLimit,
      paymasterPostOpGasLimit,
    });
    const estimate = await options.relay.estimateClaim(built.userOperation.userOperation);
    const nextGas: OkxClaimGas = {
      callGasLimit: maxBigint(gas.callGasLimit, positiveEstimateValue(estimate.callGasLimit, "callGasLimit")),
      verificationGasLimit: maxBigint(gas.verificationGasLimit, positiveEstimateValue(estimate.verificationGasLimit, "verificationGasLimit")),
      preVerificationGas: maxBigint(gas.preVerificationGas, positiveEstimateValue(estimate.preVerificationGas, "preVerificationGas")),
      maxFeePerGas: gas.maxFeePerGas,
      maxPriorityFeePerGas: gas.maxPriorityFeePerGas,
    };
    const nextPaymasterVerificationGasLimit = estimate.paymasterVerificationGasLimit === undefined
      ? paymasterVerificationGasLimit
      : maxBigint(paymasterVerificationGasLimit, positiveEstimateValue(estimate.paymasterVerificationGasLimit, "paymasterVerificationGasLimit"));
    const nextPaymasterPostOpGasLimit = estimate.paymasterPostOpGasLimit === undefined
      ? paymasterPostOpGasLimit
      : maxBigint(paymasterPostOpGasLimit, positiveEstimateValue(estimate.paymasterPostOpGasLimit, "paymasterPostOpGasLimit"));
    const converged = nextGas.callGasLimit === gas.callGasLimit
      && nextGas.verificationGasLimit === gas.verificationGasLimit
      && nextGas.preVerificationGas === gas.preVerificationGas
      && nextPaymasterVerificationGasLimit === paymasterVerificationGasLimit
      && nextPaymasterPostOpGasLimit === paymasterPostOpGasLimit;
    if (converged) {
      return {
        ...built,
        estimate,
        gas: { gas, paymasterVerificationGasLimit, paymasterPostOpGasLimit },
      };
    }
    gas = nextGas;
    paymasterVerificationGasLimit = nextPaymasterVerificationGasLimit;
    paymasterPostOpGasLimit = nextPaymasterPostOpGasLimit;
  }
  throw new Error("live claim estimate did not converge");
}
