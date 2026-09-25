import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  encodeFunctionData,
  getAddress,
  isAddress,
  http,
  keccak256,
  parseEventLogs,
  parseUnits,
  stringToHex,
  type Address,
  type EIP1193Provider,
  type Hex,
} from "viem";
import { privateKeyToAddress } from "viem/accounts";

const XLAYER_CHAIN_ID = 196;
const ZERO_BYTES32 = `0x${"0".repeat(64)}` as Hex;

const REGISTRY_ABI = [
  {
    type: "function",
    name: "isGiftable",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "giftable", type: "bool" }],
  },
  {
    type: "function",
    name: "getAsset",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [
      {
        name: "entry",
        type: "tuple",
        components: [
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
        ],
      },
    ],
  },
] as const;

const ERC20_ABI = [
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "value", type: "string" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "value", type: "uint8" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "value", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "value", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "approved", type: "bool" }],
  },
] as const;

const CLAIM_PAYMASTER_ABI = [
  {
    type: "function",
    name: "minimumReserve",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "value", type: "uint256" }],
  },
] as const;

const ESCROW_ABI = [
  {
    type: "function",
    name: "createGift",
    stateMutability: "payable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "claimKey", type: "address" },
      { name: "codeHash", type: "bytes32" },
      { name: "expiry", type: "uint64" },
      { name: "noteHash", type: "bytes32" },
    ],
    outputs: [{ name: "giftId", type: "uint256" }],
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
          { name: "claimKey", type: "address" },
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
    name: "reclaim",
    stateMutability: "nonpayable",
    inputs: [{ name: "giftId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "event",
    name: "GiftCreated",
    anonymous: false,
    inputs: [
      { name: "giftId", type: "uint256", indexed: true },
      { name: "sender", type: "address", indexed: true },
      { name: "asset", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "claimKey", type: "address", indexed: false },
      { name: "codeHash", type: "bytes32", indexed: false },
      { name: "expiry", type: "uint64", indexed: false },
      { name: "noteHash", type: "bytes32", indexed: false },
    ],
  },
] as const;

type PublicClient = ReturnType<typeof createPublicClient>;
type WalletClient = ReturnType<typeof createWalletClient>;

export interface SenderDeployment {
  registry: Address;
  escrow: Address;
  claimPaymaster: Address;
  claimBaseUrl: string;
}

export interface SenderAsset {
  token: Address;
  symbol: string;
  decimals: number;
  kind: number;
  isWrapped: boolean;
  underlying: Address;
  valuation: number;
  valuationRef: Address;
  cashOutRoute: Address;
  certified: boolean;
  enabled: boolean;
  riskTag: string;
  balance: bigint;
  allowance: bigint;
}

export interface CreateGiftOptions {
  asset: Address;
  amount: string | bigint;
  note?: string;
  code?: string;
  expiry?: Date | number | bigint;
  claimReserveWei?: bigint;
  /** Pre-generated 32-byte link secret, for callers that must persist it before sending. */
  secret?: Hex;
}

export interface CreatedGift {
  giftId: bigint;
  sender: Address;
  asset: SenderAsset;
  amount: bigint;
  secret: Hex;
  claimKey: Address;
  codeHash: Hex;
  noteHash: Hex;
  expiry: bigint;
  claimReserveWei: bigint;
  approvalTransactions: Hex[];
  createTransaction: Hex;
  claimLink: string;
}

export interface SenderGift {
  sender: Address;
  asset: Address;
  amount: bigint;
  claimKey: Address;
  codeHash: Hex;
  expiry: bigint;
  noteHash: Hex;
  state: number;
}

export interface SenderFlowOptions {
  rpcUrl: string;
  provider: EIP1193Provider;
  deployment: SenderDeployment;
}

function assertAddressValue(value: string, name: string): asserts value is Address {
  if (!isAddress(value)) throw new Error(`${name} must be an EVM address`);
}

function bytesToHex(bytes: Uint8Array): Hex {
  return `0x${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}` as Hex;
}

export function randomSecret(): Hex {
  if (!globalThis.crypto?.getRandomValues) throw new Error("Web Crypto is required to create a gift secret");
  return bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

function hashText(value: string | undefined): Hex {
  return value === undefined || value.length === 0 ? ZERO_BYTES32 : keccak256(stringToHex(value));
}

function tupleValue(value: unknown, key: string, index: number): unknown {
  if (Array.isArray(value)) return value[index];
  if (value && typeof value === "object" && key in value) return (value as Record<string, unknown>)[key];
  throw new Error(`registry returned an invalid asset tuple (${key})`);
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`asset ${name} is not a string`);
  return value;
}

function requiredBigint(value: unknown, name: string): bigint {
  if (typeof value !== "bigint") throw new Error(`asset ${name} is not a bigint`);
  return value;
}

function requiredAddress(value: unknown, name: string): Address {
  if (typeof value !== "string" || !isAddress(value)) throw new Error(`asset ${name} is not an address`);
  return getAddress(value);
}

function requiredBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new Error(`asset ${name} is not a boolean`);
  return value;
}

function requiredNumber(value: unknown, name: string): number {
  if (typeof value !== "number" && typeof value !== "bigint") throw new Error(`asset ${name} is not an integer`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`asset ${name} is not a valid integer`);
  return number;
}

function normaliseBaseUrl(value: string): string {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error("claimBaseUrl must use HTTPS; plain HTTP is only allowed on localhost");
  }
  return url.toString().replace(/\/$/u, "");
}

function expiryValue(value: CreateGiftOptions["expiry"]): bigint {
  if (value === undefined) return 0n;
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new Error("expiry date is invalid");
    return BigInt(Math.floor(value.getTime() / 1000));
  }
  const result = typeof value === "bigint" ? value : BigInt(value);
  if (result <= 0n || result >= (1n << 64n)) throw new Error("expiry must fit uint64 and be in the future");
  return result;
}

export function parseGiftAmount(value: string, decimals: number): bigint {
  const normalized = value.trim();
  if (!normalized) throw new Error("gift amount is required");
  const match = /^(\d+)(?:\.(\d+))?$/u.exec(normalized);
  if (!match || (match[2]?.length ?? 0) > decimals) {
    throw new Error(`gift amount must be a valid decimal with at most ${decimals} places`);
  }
  let parsed: bigint;
  try {
    parsed = parseUnits(normalized, decimals);
  } catch {
    throw new Error(`gift amount must be a valid decimal with at most ${decimals} places`);
  }
  if (parsed <= 0n) throw new Error("gift amount must be greater than zero");
  return parsed;
}

export function buildClaimLink(claimBaseUrl: string, secret: Hex, giftId?: bigint): string {
  if (!/^0x[0-9a-fA-F]{64}$/u.test(secret)) throw new Error("gift secret must contain exactly 32 bytes");
  const base = normaliseBaseUrl(claimBaseUrl);
  const url = new URL(`${base}/g/${secret.slice(2).toLowerCase()}`);
  if (giftId !== undefined) {
    if (giftId <= 0n) throw new Error("giftId must be greater than zero");
    url.searchParams.set("giftId", giftId.toString());
  }
  return url.toString();
}

function checkReceiptStatus(receipt: { status: string }, operation: string): void {
  if (receipt.status !== "success") throw new Error(`${operation} transaction reverted`);
}

export class ConnectedWalletSender {
  readonly publicClient: PublicClient;
  readonly walletClient: WalletClient;
  readonly deployment: SenderDeployment;
  private readonly claimBaseUrl: string;
  private sender?: Address;

  constructor(options: SenderFlowOptions) {
    if (!options.rpcUrl.trim()) throw new Error("rpcUrl is required");
    assertAddressValue(options.deployment.registry, "deployment.registry");
    assertAddressValue(options.deployment.escrow, "deployment.escrow");
    assertAddressValue(options.deployment.claimPaymaster, "deployment.claimPaymaster");
    this.deployment = {
      ...options.deployment,
      registry: getAddress(options.deployment.registry),
      escrow: getAddress(options.deployment.escrow),
      claimPaymaster: getAddress(options.deployment.claimPaymaster),
    };
    this.claimBaseUrl = normaliseBaseUrl(options.deployment.claimBaseUrl);
    const chain = defineChain({
      id: XLAYER_CHAIN_ID,
      name: "X Layer",
      nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
      rpcUrls: { default: { http: [options.rpcUrl] } },
    });
    this.publicClient = createPublicClient({ chain, transport: http(options.rpcUrl) });
    this.walletClient = createWalletClient({ chain, transport: custom(options.provider) });
  }

  async connect(): Promise<Address> {
    const chainId = await this.walletClient.getChainId();
    if (chainId !== XLAYER_CHAIN_ID) {
      throw new Error(`connected wallet is on chain ${chainId}; switch it to X Layer chain ${XLAYER_CHAIN_ID}`);
    }
    const accounts = await this.walletClient.requestAddresses();
    const [sender] = accounts;
    if (!sender) throw new Error("connected wallet returned no account");
    this.sender = getAddress(sender);
    return this.sender;
  }

  connectedAddress(): Address {
    if (!this.sender) throw new Error("connect an existing wallet before sending");
    return this.sender;
  }

  async readAsset(token: Address): Promise<SenderAsset> {
    assertAddressValue(token, "asset");
    const address = getAddress(token);
    const sender = this.connectedAddress();
    const [giftable, entry, symbol, decimals, balance, allowance] = await Promise.all([
      this.publicClient.readContract({ address: this.deployment.registry, abi: REGISTRY_ABI, functionName: "isGiftable", args: [address] }),
      this.publicClient.readContract({ address: this.deployment.registry, abi: REGISTRY_ABI, functionName: "getAsset", args: [address] }),
      this.publicClient.readContract({ address, abi: ERC20_ABI, functionName: "symbol" }),
      this.publicClient.readContract({ address, abi: ERC20_ABI, functionName: "decimals" }),
      this.publicClient.readContract({ address, abi: ERC20_ABI, functionName: "balanceOf", args: [sender] }),
      this.publicClient.readContract({ address, abi: ERC20_ABI, functionName: "allowance", args: [sender, this.deployment.escrow] }),
    ]);
    if (giftable !== true) throw new Error("asset is not certified and enabled in the live Convey registry");
    const tuple = entry as unknown;
    const asset: SenderAsset = {
      token: requiredAddress(tupleValue(tuple, "token", 0), "token"),
      symbol: requiredString(symbol, "symbol"),
      decimals: requiredNumber(decimals, "decimals"),
      kind: requiredNumber(tupleValue(tuple, "kind", 1), "kind"),
      isWrapped: requiredBoolean(tupleValue(tuple, "isWrapped", 3), "isWrapped"),
      underlying: requiredAddress(tupleValue(tuple, "underlying", 4), "underlying"),
      valuation: requiredNumber(tupleValue(tuple, "valuation", 5), "valuation"),
      valuationRef: requiredAddress(tupleValue(tuple, "valuationRef", 6), "valuationRef"),
      cashOutRoute: requiredAddress(tupleValue(tuple, "cashOutRoute", 7), "cashOutRoute"),
      certified: requiredBoolean(tupleValue(tuple, "certified", 8), "certified"),
      enabled: requiredBoolean(tupleValue(tuple, "enabled", 9), "enabled"),
      riskTag: requiredString(tupleValue(tuple, "riskTag", 10), "riskTag"),
      balance: requiredBigint(balance, "balance"),
      allowance: requiredBigint(allowance, "allowance"),
    };
    if (asset.token.toLowerCase() !== address.toLowerCase()) throw new Error("registry returned a different asset address");
    if (!asset.certified || !asset.enabled) throw new Error("asset is not certified and enabled in the live Convey registry");
    if (asset.decimals !== Number(decimals)) throw new Error("registry and token decimals do not match");
    return asset;
  }

  async readClaimReserve(): Promise<bigint> {
    const reserve = await this.publicClient.readContract({
      address: this.deployment.claimPaymaster,
      abi: CLAIM_PAYMASTER_ABI,
      functionName: "minimumReserve",
    });
    if (typeof reserve !== "bigint" || reserve <= 0n) throw new Error("live claim paymaster returned an invalid reserve");
    return reserve;
  }

  async readGift(giftId: bigint): Promise<SenderGift> {
    if (giftId <= 0n) throw new Error("giftId must be greater than zero");
    const value = await this.publicClient.readContract({ address: this.deployment.escrow, abi: ESCROW_ABI, functionName: "getGift", args: [giftId] });
    const tuple = value as unknown;
    return {
      sender: requiredAddress(tupleValue(tuple, "sender", 0), "sender"),
      asset: requiredAddress(tupleValue(tuple, "asset", 1), "asset"),
      amount: requiredBigint(tupleValue(tuple, "amount", 2), "amount"),
      claimKey: requiredAddress(tupleValue(tuple, "claimKey", 3), "claim key"),
      codeHash: tupleValue(tuple, "codeHash", 4) as Hex,
      expiry: requiredBigint(tupleValue(tuple, "expiry", 5), "expiry"),
      noteHash: tupleValue(tuple, "noteHash", 6) as Hex,
      state: requiredNumber(tupleValue(tuple, "state", 7), "state"),
    };
  }

  async createGift(options: CreateGiftOptions): Promise<CreatedGift> {
    const sender = this.connectedAddress();
    const asset = await this.readAsset(options.asset);
    const amount = typeof options.amount === "bigint" ? options.amount : parseGiftAmount(options.amount, asset.decimals);
    if (amount <= 0n) throw new Error("gift amount must be greater than zero");
    if (amount > asset.balance) throw new Error(`insufficient ${asset.symbol} balance for this gift`);
    const reserve = options.claimReserveWei ?? await this.readClaimReserve();
    if (reserve <= 0n) throw new Error("claim reserve must be greater than zero");
    const expiry = expiryValue(options.expiry);
    if (expiry !== 0n) {
      const block = await this.publicClient.getBlock();
      if (expiry <= block.timestamp) throw new Error("expiry must be in the future on X Layer");
    }
    if (options.secret !== undefined && !/^0x[0-9a-fA-F]{64}$/u.test(options.secret)) throw new Error("gift secret must be 32 bytes");
    const secret = options.secret ?? randomSecret();
    // The link secret is a one-time key; only its address goes on chain.
    const claimKey = privateKeyToAddress(secret);
    const codeBytes = options.code === undefined ? "0x" : stringToHex(options.code);
    const codeHash = codeBytes === "0x" ? ZERO_BYTES32 : keccak256(codeBytes);
    const noteHash = hashText(options.note);
    const approvalTransactions: Hex[] = [];
    let allowance = asset.allowance;
    if (allowance > amount) {
      approvalTransactions.push(await this.approve(asset.token, 0n));
      allowance = 0n;
    }
    if (allowance < amount) approvalTransactions.push(await this.approve(asset.token, amount));

    const createTransaction = await this.walletClient.writeContract({
      chain: null,
      account: sender,
      address: this.deployment.escrow,
      abi: ESCROW_ABI,
      functionName: "createGift",
      args: [asset.token, amount, claimKey, codeHash, expiry, noteHash],
      value: reserve,
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: createTransaction });
    checkReceiptStatus(receipt, "createGift");
    const events = parseEventLogs({ abi: ESCROW_ABI, eventName: "GiftCreated", logs: receipt.logs, strict: true });
    if (events.length !== 1) throw new Error("createGift succeeded without exactly one GiftCreated event");
    const giftId = events[0].args.giftId;
    return {
      giftId,
      sender,
      asset,
      amount,
      secret,
      claimKey,
      codeHash,
      noteHash,
      expiry,
      claimReserveWei: reserve,
      approvalTransactions,
      createTransaction,
      claimLink: buildClaimLink(this.claimBaseUrl, secret, giftId),
    };
  }

  async reclaimGift(giftId: bigint): Promise<Hex> {
    const sender = this.connectedAddress();
    const gift = await this.readGift(giftId);
    if (gift.sender.toLowerCase() !== sender.toLowerCase()) throw new Error("only the gift sender can reclaim this gift");
    if (gift.state !== 0) throw new Error("only an open gift can be reclaimed");
    const transaction = await this.walletClient.writeContract({
      chain: null,
      account: sender,
      address: this.deployment.escrow,
      abi: ESCROW_ABI,
      functionName: "reclaim",
      args: [giftId],
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: transaction });
    checkReceiptStatus(receipt, "reclaim");
    return transaction;
  }

  private async approve(token: Address, amount: bigint): Promise<Hex> {
    const transaction = await this.walletClient.writeContract({
      chain: null,
      account: this.connectedAddress(),
      address: token,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [this.deployment.escrow, amount],
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: transaction });
    checkReceiptStatus(receipt, "approve");
    return transaction;
  }
}

export function createConnectedWalletSender(options: SenderFlowOptions): ConnectedWalletSender {
  return new ConnectedWalletSender(options);
}

export function encodeCreateGiftCall(options: {
  asset: Address;
  amount: bigint;
  claimKey: Address;
  codeHash: Hex;
  expiry: bigint;
  noteHash: Hex;
}): Hex {
  return encodeFunctionData({
    abi: ESCROW_ABI,
    functionName: "createGift",
    args: [options.asset, options.amount, options.claimKey, options.codeHash, options.expiry, options.noteHash],
  });
}
