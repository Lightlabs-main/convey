import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ENTRY_POINT = "0x0000000071727de22e5e9d8baf0edac6f37da032" as Address;
const CHAIN_ID = 196;
const PAYMASTER_ABI = [
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "entryPoint", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
  { type: "function", name: "addStake", stateMutability: "payable", inputs: [{ name: "unstakeDelaySec", type: "uint32" }], outputs: [] },
] as const;
const ENTRY_POINT_ABI = [{ type: "function", name: "getDepositInfo", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "info", type: "tuple", components: [{ name: "deposit", type: "uint256" }, { name: "staked", type: "bool" }, { name: "stake", type: "uint112" }, { name: "unstakeDelaySec", type: "uint32" }, { name: "withdrawTime", type: "uint48" }] }] }] as const;
function required(name: string): string { const value = process.env[name]?.trim(); if (!value) throw new Error(`${name} is required`); return value; }
function uint(name: string, bits = 256): bigint { let value: bigint; try { value = BigInt(required(name)); } catch { throw new Error(`${name} must be an integer`); } if (value <= 0n || value >= (1n << BigInt(bits))) throw new Error(`${name} must be a positive uint${bits}`); return value; }
const rpcUrl = required("XLAYER_RPC_URL");
const paymaster = required("CONVEY_EXIT_PAYMASTER_ADDRESS") as Address;
const owner = privateKeyToAccount(required("DEPLOYER_PRIVATE_KEY") as Hex);
const targetDeposit = uint("EXIT_PAYMASTER_DEPOSIT_WEI");
const targetStake = uint("EXIT_PAYMASTER_STAKE_WEI");
const delay = uint("EXIT_PAYMASTER_STAKE_UNSTAKE_DELAY_SEC", 32);
const chain = { id: CHAIN_ID, name: "X Layer", nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } } as const;
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account: owner, chain, transport: http(rpcUrl) });
const [chainId, configuredOwner, configuredEntryPoint, info] = await Promise.all([
  publicClient.getChainId(),
  publicClient.readContract({ address: paymaster, abi: PAYMASTER_ABI, functionName: "owner" }),
  publicClient.readContract({ address: paymaster, abi: PAYMASTER_ABI, functionName: "entryPoint" }),
  publicClient.readContract({ address: ENTRY_POINT, abi: ENTRY_POINT_ABI, functionName: "getDepositInfo", args: [paymaster] }),
]);
if (chainId !== CHAIN_ID) throw new Error(`execution RPC returned chain ${chainId}, expected ${CHAIN_ID}`);
if (configuredOwner.toLowerCase() !== owner.address.toLowerCase()) throw new Error("DEPLOYER_PRIVATE_KEY is not the exit paymaster owner");
if (configuredEntryPoint.toLowerCase() !== ENTRY_POINT.toLowerCase()) throw new Error("exit paymaster uses an unexpected EntryPoint");
let depositTransactionHash: Hex | undefined;
if (info.deposit < targetDeposit) { depositTransactionHash = await walletClient.writeContract({ address: paymaster, abi: PAYMASTER_ABI, functionName: "deposit", value: targetDeposit - info.deposit }); await publicClient.waitForTransactionReceipt({ hash: depositTransactionHash }); }
let stakeTransactionHash: Hex | undefined;
if (!info.staked || info.stake < targetStake) { stakeTransactionHash = await walletClient.writeContract({ address: paymaster, abi: PAYMASTER_ABI, functionName: "addStake", args: [Number(delay)], value: info.stake >= targetStake ? 0n : targetStake - info.stake }); await publicClient.waitForTransactionReceipt({ hash: stakeTransactionHash }); }
const finalInfo = await publicClient.readContract({ address: ENTRY_POINT, abi: ENTRY_POINT_ABI, functionName: "getDepositInfo", args: [paymaster] });
if (finalInfo.deposit < targetDeposit || !finalInfo.staked || finalInfo.stake < targetStake) throw new Error("exit paymaster deposit or stake did not reach target");
console.log(JSON.stringify({ chainId, paymaster, depositWei: finalInfo.deposit.toString(), stakeWei: finalInfo.stake.toString(), staked: finalInfo.staked, depositTransactionHash, stakeTransactionHash }, null, 2));
