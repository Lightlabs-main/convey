/**
 * End-to-end mainnet proof of on-chain recurring gifts with ConveyRecurringGiftHook.
 *
 * A disposable OKX Smart Wallet (the sender) gets a second, non-admin "agent"
 * owner whose every execution must pass the hook: one asset, the Convey escrow
 * only, a per-gift cap, a native-reserve cap, a total budget and an expiry. The
 * agent sends two gifts, out-of-bounds attempts are shown to revert, and the
 * admin then revokes the agent.
 *
 * Every step checks chain state first, so the script is safe to resume. Run it
 * against a fork first (XLAYER_RPC_URL=http://127.0.0.1:8547). Writing to
 * mainnet additionally requires CONVEY_RECURRING_PROOF_CONFIRM=I_UNDERSTAND_MAINNET_WRITE.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  BaseError,
  decodeErrorResult,
  encodeDeployData,
  defineChain,
  encodeFunctionData,
  formatEther,
  formatUnits,
  http,
  keccak256,
  parseEventLogs,
  stringToHex,
  zeroHash,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount, privateKeyToAddress } from "viem/accounts";
import { buildClaimLink, randomSecret } from "../src/sender/index.ts";

const rpcUrl = process.env.XLAYER_RPC_URL?.trim() || "https://rpc.xlayer.tech";
const isMainnet = !/127\.0\.0\.1|localhost/u.test(rpcUrl);
const statePath = process.env.CONVEY_RECURRING_PROOF_STATE?.trim() || (isMainnet ? ".recurring-proof.mainnet.json" : ".recurring-proof.fork.json");
if (isMainnet && process.env.CONVEY_RECURRING_PROOF_CONFIRM !== "I_UNDERSTAND_MAINNET_WRITE") {
  throw new Error("Refusing mainnet writes without CONVEY_RECURRING_PROOF_CONFIRM=I_UNDERSTAND_MAINNET_WRITE");
}

function key(name: string): Hex {
  const value = process.env[name]?.trim();
  if (!value || !/^0x[0-9a-fA-F]{64}$/u.test(value)) throw new Error(`${name} must be a 32-byte private key`);
  return value as Hex;
}

const FACTORY = "0xdd3fea01cd550c9effc893f346690b9a649f35ef" as Address;
const ECDSA_VALIDATOR = "0x0000000000000000000000000000000000000001" as Address;
const ESCROW = "0xffd2DACE75dbC3bC3f2e10C6c7b011Aa4EC043cD" as Address;
const WNVDAX = "0xa8ddb5cd96b5222afe198316e9a57caa642850d5" as Address;
const ROUTER = "0x4f0c28f5926afda16bf2506d5d9e57ea190f9bca" as Address;
const QUOTER = "0xd1b797d92d87b688193a2b976efc8d577d204343" as Address;
// WOKB -(0.05%)-> USDT0 -(0.3%)-> wNVDAx
const SWAP_PATH = "0xe538905cf8410324e03a5a23c1c177a474d59b2b0001f4779ded0c9e1022225f8e0630b35a9b54be713736000bb8a8ddb5cd96b5222afe198316e9a57caa642850d5" as Hex;

const GIFT = 350_000_000_000_000n; // 0.00035 wNVDAx per gift
const BUDGET = 2n * GIFT; // two gifts
const RESERVE = 20_000_000_000_000n; // 0.00002 OKB claim reserve (paymaster minimum)
const SWAP_IN = 1_500_000_000_000_000n; // 0.0015 OKB
const ADMIN_FUNDING = 1_950_000_000_000_000n; // 0.00195 OKB from the funder
const WALLET_OKB = 3n * RESERVE; // two reserves plus margin
const AGENT_GAS = 20_000_000_000_000n; // 0.00002 OKB for the agent's own transactions
const HOOK_LIFETIME = 30n * 86_400n;

const chain = defineChain({ id: 196, name: "X Layer", nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const funder = privateKeyToAccount(key("SMART_ACCOUNT_OWNER_PRIVATE_KEY"));
const admin = privateKeyToAccount(key("RECURRING_ADMIN_PRIVATE_KEY"));
const agent = privateKeyToAccount(key("RECURRING_AGENT_PRIVATE_KEY"));
const clients = new Map([funder, admin, agent].map((account) => [account.address, createWalletClient({ account, chain, transport: http(rpcUrl) })]));
const nonces = new Map<Address, number>();

const WALLET_ABI = [
  { type: "function", name: "execute", stateMutability: "nonpayable", inputs: [{ name: "calls", type: "tuple[]", components: [{ name: "target", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }] }], outputs: [] },
  { type: "function", name: "addOwner", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }], outputs: [] },
  { type: "function", name: "removeOwner", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }], outputs: [] },
  { type: "function", name: "hasOwner", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }] },
  { type: "error", name: "InvalidCaller", inputs: [{ type: "address" }] },
  { type: "error", name: "NonAdminSelfCall", inputs: [] },
] as const;
const FACTORY_ABI = [
  { type: "function", name: "getAddress", stateMutability: "view", inputs: [{ name: "owners", type: "tuple[]", components: [{ name: "keyHash", type: "bytes32" }, { name: "validator", type: "address" }] }, { name: "salt", type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "createAccount", stateMutability: "payable", inputs: [{ name: "owners", type: "tuple[]", components: [{ name: "keyHash", type: "bytes32" }, { name: "validator", type: "address" }] }, { name: "salt", type: "uint256" }], outputs: [{ type: "address" }] },
] as const;
const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;
const ESCROW_ABI = [
  { type: "function", name: "createGift", stateMutability: "payable", inputs: [{ type: "address" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "uint64" }, { type: "bytes32" }], outputs: [{ type: "uint256" }] },
  { type: "event", name: "GiftCreated", inputs: [{ name: "giftId", type: "uint256", indexed: true }, { name: "sender", type: "address", indexed: true }, { name: "asset", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false }, { name: "claimKey", type: "address", indexed: false }, { name: "codeHash", type: "bytes32", indexed: false }, { name: "expiry", type: "uint64", indexed: false }, { name: "noteHash", type: "bytes32", indexed: false }] },
] as const;
const ROUTER_ABI = [{ type: "function", name: "exactInput", stateMutability: "payable", inputs: [{ name: "params", type: "tuple", components: [{ name: "path", type: "bytes" }, { name: "recipient", type: "address" }, { name: "amountIn", type: "uint256" }, { name: "amountOutMinimum", type: "uint256" }] }], outputs: [{ type: "uint256" }] }] as const;
const QUOTER_ABI = [{ type: "function", name: "quoteExactInput", stateMutability: "nonpayable", inputs: [{ type: "bytes" }, { type: "uint256" }], outputs: [{ type: "uint256" }, { type: "uint160[]" }, { type: "uint32[]" }, { type: "uint256" }] }] as const;

const hookArtifact = JSON.parse(readFileSync(new URL("../out/ConveyRecurringGiftHook.sol/ConveyRecurringGiftHook.json", import.meta.url), "utf8")) as { abi: Abi; bytecode: { object: Hex } };
const ERROR_ABI = [...WALLET_ABI.filter((item) => item.type === "error"), ...hookArtifact.abi.filter((item) => item.type === "error")] as Abi;

interface ProofState {
  salt: string;
  wallet?: Address;
  hook?: Address;
  expiresAt?: string;
  transactions: Record<string, Hex>;
  gifts: { giftId: string; claimLink: string; transaction: Hex }[];
  simulations: Record<string, string>;
}

const state: ProofState = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath, "utf8"))
  : { salt: BigInt(keccak256(stringToHex(`convey-recurring-${Date.now()}`))).toString().slice(0, 30), transactions: {}, gifts: [], simulations: {} };
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });

const keyHash = (address: Address) => keccak256(address);
const log = (message: string) => console.log(message);

async function send(from: Address, label: string, request: { to?: Address; data?: Hex; value?: bigint }): Promise<Hex> {
  const client = clients.get(from)!;
  const pending = await publicClient.getTransactionCount({ address: from, blockTag: "pending" });
  const nonce = Math.max(pending, nonces.get(from) ?? 0);
  const gas = await publicClient.estimateGas({ account: from, to: request.to, data: request.data, value: request.value });
  const gasPrice = await publicClient.getGasPrice();
  const hash = await client.sendTransaction({ ...request, nonce, gas: (gas * 13n) / 10n, gasPrice, chain });
  nonces.set(from, nonce + 1);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} reverted in ${hash}`);
  state.transactions[label] = hash;
  save();
  log(`  ✓ ${label}: ${hash}`);
  return hash;
}

function executeData(calls: { target: Address; value: bigint; data: Hex }[]): Hex {
  return encodeFunctionData({ abi: WALLET_ABI, functionName: "execute", args: [calls] });
}

/** Simulates a call that must revert with `expected`; any other outcome stops the proof. */
async function expectRevert(label: string, from: Address, to: Address, data: Hex, expected: string): Promise<void> {
  try {
    await publicClient.call({ account: from, to, data });
  } catch (error) {
    const withData = error instanceof BaseError ? error.walk((inner) => typeof (inner as { data?: unknown }).data === "string") : undefined;
    const raw = (withData as { data?: Hex } | undefined)?.data;
    let name = "unknown";
    if (raw) {
      try { name = decodeErrorResult({ abi: ERROR_ABI, data: raw }).errorName; } catch { name = raw.slice(0, 10); }
    }
    if (name !== expected) throw new Error(`${label}: expected ${expected}, got ${name}`);
    state.simulations[label] = `reverted with ${name}`;
    save();
    log(`  ✓ ${label}: reverted with ${name}`);
    return;
  }
  throw new Error(`${label}: expected a revert, but the call succeeded`);
}

function giftCall(amount: bigint, claimKey: Address, expiry: bigint): { target: Address; value: bigint; data: Hex } {
  return {
    target: ESCROW,
    value: RESERVE,
    data: encodeFunctionData({ abi: ESCROW_ABI, functionName: "createGift", args: [WNVDAX, amount, claimKey, zeroHash, expiry, keccak256(stringToHex("Convey recurring gift"))] }),
  };
}

log(`Network: ${isMainnet ? "X Layer MAINNET" : `fork ${rpcUrl}`} · state ${statePath}`);
const chainId = await publicClient.getChainId();
if (chainId !== 196) throw new Error(`expected chain 196, got ${chainId}`);
log(`Funder ${funder.address} · admin ${admin.address} · agent ${agent.address}`);

// 1. Fund the admin and create the disposable sender wallet.
// Funding happens only until the agent is authorized; afterwards balances drop by design.
const setUp = Boolean(state.transactions["add agent owner + approve budget"]);
log("\n1. Disposable sender wallet");
if (!setUp && !state.transactions["fund admin"] && (await publicClient.getBalance({ address: admin.address })) < ADMIN_FUNDING / 2n) {
  await send(funder.address, "fund admin", { to: admin.address, value: ADMIN_FUNDING });
}
const owners = [{ keyHash: keyHash(admin.address), validator: ECDSA_VALIDATOR }];
const wallet = await publicClient.readContract({ address: FACTORY, abi: FACTORY_ABI, functionName: "getAddress", args: [owners, BigInt(state.salt)] });
state.wallet = wallet;
save();
if (!(await publicClient.getCode({ address: wallet }))) {
  await send(admin.address, "create wallet", { to: FACTORY, data: encodeFunctionData({ abi: FACTORY_ABI, functionName: "createAccount", args: [owners, BigInt(state.salt)] }) });
}
log(`  wallet ${wallet}`);

// 2. Give the wallet wNVDAx and OKB for claim reserves, and the agent gas.
log("\n2. Funding");
if (!setUp && (await publicClient.readContract({ address: WNVDAX, abi: ERC20_ABI, functionName: "balanceOf", args: [wallet] })) < BUDGET) {
  const [quote] = await publicClient.simulateContract({ address: QUOTER, abi: QUOTER_ABI, functionName: "quoteExactInput", args: [SWAP_PATH, SWAP_IN] }).then((r) => r.result);
  if (quote < BUDGET) throw new Error(`swap would return ${formatUnits(quote, 18)} wNVDAx, below the ${formatUnits(BUDGET, 18)} budget`);
  await send(admin.address, "swap OKB to wNVDAx", {
    to: ROUTER,
    value: SWAP_IN,
    data: encodeFunctionData({ abi: ROUTER_ABI, functionName: "exactInput", args: [{ path: SWAP_PATH, recipient: wallet, amountIn: SWAP_IN, amountOutMinimum: (quote * 97n) / 100n }] }),
  });
}
if (!setUp && (await publicClient.getBalance({ address: wallet })) < WALLET_OKB) await send(admin.address, "fund wallet reserves", { to: wallet, value: WALLET_OKB });
if (!setUp && (await publicClient.getBalance({ address: agent.address })) < AGENT_GAS / 2n) await send(admin.address, "fund agent gas", { to: agent.address, value: AGENT_GAS });
log(`  wallet holds ${formatUnits(await publicClient.readContract({ address: WNVDAX, abi: ERC20_ABI, functionName: "balanceOf", args: [wallet] }), 18)} wNVDAx, ${formatEther(await publicClient.getBalance({ address: wallet }))} OKB`);

// 3. Deploy the hook bound to this wallet.
log("\n3. Recurring hook");
if (!state.hook) {
  const block = await publicClient.getBlock();
  const expiresAt = block.timestamp + HOOK_LIFETIME;
  const deployData = encodeDeployData({ abi: hookArtifact.abi, bytecode: hookArtifact.bytecode.object, args: [wallet, ESCROW, WNVDAX, GIFT, RESERVE, BUDGET, expiresAt] });
  const hash = await send(admin.address, "deploy hook", { data: deployData });
  const receipt = await publicClient.getTransactionReceipt({ hash });
  state.hook = receipt.contractAddress!;
  state.expiresAt = expiresAt.toString();
  save();
}
const hook = state.hook!;
const expiresAt = BigInt(state.expiresAt!);
log(`  hook ${hook} · per gift ${formatUnits(GIFT, 18)} · budget ${formatUnits(BUDGET, 18)} wNVDAx · expires ${new Date(Number(expiresAt) * 1000).toISOString()}`);

// 4. Admin authorizes the agent: a non-admin owner bound to the hook, plus a bounded allowance.
log("\n4. Admin authorizes the agent");
const agentKeyHash = keyHash(agent.address);
if (!(await publicClient.readContract({ address: wallet, abi: WALLET_ABI, functionName: "hasOwner", args: [agentKeyHash] })) && !state.transactions["revoke agent"]) {
  const settings = (expiresAt << 160n) | BigInt(hook); // isAdmin = false
  await send(admin.address, "add agent owner + approve budget", {
    to: wallet,
    data: executeData([
      { target: wallet, value: 0n, data: encodeFunctionData({ abi: WALLET_ABI, functionName: "addOwner", args: [agentKeyHash, ECDSA_VALIDATOR, settings] }) },
      { target: WNVDAX, value: 0n, data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [ESCROW, BUDGET] }) },
    ]),
  });
}

const giftExpiry = expiresAt - 3600n;
if (!state.transactions["revoke agent"]) {
  // 5. Out-of-bounds attempts by the agent must revert.
  log("\n5. The hook rejects out-of-bounds agent calls (simulated)");
  const outsider = privateKeyToAddress(randomSecret());
  await expectRevert("agent tries to remove the admin", agent.address, wallet, executeData([{ target: wallet, value: 0n, data: encodeFunctionData({ abi: WALLET_ABI, functionName: "removeOwner", args: [keyHash(admin.address)] }) }]), "InvalidTarget");
  await expectRevert("agent transfers tokens out", agent.address, wallet, executeData([{ target: WNVDAX, value: 0n, data: encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [agent.address, GIFT] }) }]), "InvalidTarget");
  await expectRevert("agent gift above per-gift cap", agent.address, wallet, executeData([giftCall(GIFT + 1n, outsider, giftExpiry)]), "InvalidGiftAmount");
  await expectRevert("agent gift with oversized reserve", agent.address, wallet, executeData([{ ...giftCall(GIFT, outsider, giftExpiry), value: RESERVE + 1n }]), "InvalidNativeReserve");

  // 6. Two in-bounds recurring gifts by the agent.
  log("\n6. The agent sends recurring gifts within the budget");
  for (let index = state.gifts.length; index < 2; index += 1) {
    const secret = randomSecret();
    const hash = await send(agent.address, `agent gift ${index + 1}`, { to: wallet, data: executeData([giftCall(GIFT, privateKeyToAddress(secret), giftExpiry)]) });
    const receipt = await publicClient.getTransactionReceipt({ hash });
    const [created] = parseEventLogs({ abi: ESCROW_ABI, eventName: "GiftCreated", logs: receipt.logs });
    if (!created || created.args.sender.toLowerCase() !== wallet.toLowerCase()) throw new Error("gift was not created by the sender wallet");
    state.gifts.push({ giftId: created.args.giftId.toString(), claimLink: buildClaimLink("https://conveyapp.site", secret, created.args.giftId), transaction: hash });
    save();
    log(`    gift ${created.args.giftId} created`);
  }
  await expectRevert("agent gift beyond total budget", agent.address, wallet, executeData([giftCall(GIFT, privateKeyToAddress(randomSecret()), giftExpiry)]), "BudgetExceeded");

  // 7. Admin revokes the agent; its next call must fail.
  log("\n7. Admin revokes the agent");
  await send(admin.address, "revoke agent", { to: wallet, data: executeData([{ target: wallet, value: 0n, data: encodeFunctionData({ abi: WALLET_ABI, functionName: "removeOwner", args: [agentKeyHash] }) }]) });
}
await expectRevert("revoked agent tries again", agent.address, wallet, executeData([giftCall(1n, privateKeyToAddress(randomSecret()), giftExpiry)]), "InvalidCaller");

log(`\nDone. Hook spent ${formatUnits(await publicClient.readContract({ address: hook, abi: hookArtifact.abi, functionName: "spent" }) as bigint, 18)} of ${formatUnits(BUDGET, 18)} wNVDAx. Gifts: ${state.gifts.map((gift) => gift.giftId).join(", ")}.`);
log(`State (includes claim links) saved to ${statePath}`);
