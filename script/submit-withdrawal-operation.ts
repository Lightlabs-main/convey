import { buildReceiverWithdrawalCall, prepareReceiverExit, readReceiverTokenBalance, receiverClaimGasSeedFromLive } from "../src/receiver/flow.ts";
import { receiverSignerFromPrivateKey } from "../src/receiver/signer.ts";
import { ConveyRelayerClient } from "../src/relayer/client.ts";
import { resolveBundlerExecutionRpcUrl } from "./rpc-config.ts";
import type { Address, Hex } from "../src/relayer/types.ts";

const RECEIVER = "0x63B2A84d47cb07fb18EE72Ec386893506Fd963db" as Address;
const RECEIVER_OWNER = "0xDd0B74DC63cc0f309F3e400dCf04E11C5a10400f" as Address;
const PUBLIC_RELAY = "https://convey.13-62-181-128.sslip.io/api/relay";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function address(name: string): Address {
  const value = required(name);
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${name} must be a 20-byte address`);
  return value as Address;
}

function amount(): bigint {
  let value: bigint;
  try {
    value = BigInt(required("WITHDRAWAL_AMOUNT"));
  } catch {
    throw new Error("WITHDRAWAL_AMOUNT must be a positive base-unit integer");
  }
  if (value <= 0n) throw new Error("WITHDRAWAL_AMOUNT must be greater than zero");
  return value;
}

function writeEnabled(): boolean {
  return process.argv.includes("--confirm") && process.env.CONVEY_WITHDRAW_CONFIRM === "I_UNDERSTAND_MAINNET_WRITE";
}

const executionRpcUrl = resolveBundlerExecutionRpcUrl();
const token = address("WITHDRAWAL_TOKEN");
const recipient = address("WITHDRAWAL_RECIPIENT");
const withdrawalAmount = amount();
if (recipient.toLowerCase() === RECEIVER.toLowerCase()) throw new Error("WITHDRAWAL_RECIPIENT must differ from the receiver account");
const signer = receiverSignerFromPrivateKey(required("SMART_ACCOUNT_OWNER_PRIVATE_KEY") as Hex);
if (signer.address.toLowerCase() !== RECEIVER_OWNER.toLowerCase()) throw new Error("SMART_ACCOUNT_OWNER_PRIVATE_KEY is not the deployed receiver owner key");
const relay = new ConveyRelayerClient({
  relayUrl: process.env.CONVEY_PUBLIC_RELAY_URL?.trim() || PUBLIC_RELAY,
  entryPoint: address("NEXT_PUBLIC_CONVEY_ENTRYPOINT_ADDRESS"),
  chainId: 196,
  timeoutMs: 30_000,
});
const balance = await readReceiverTokenBalance(executionRpcUrl, token, RECEIVER);
if (withdrawalAmount > balance) throw new Error(`withdrawal amount exceeds the live token balance (${balance.toString()} base units)`);
const calls = buildReceiverWithdrawalCall(token, recipient, withdrawalAmount);
const seed = receiverClaimGasSeedFromLive(await relay.claimGasSeed());
const prepared = await prepareReceiverExit({
  calls,
  executionRpcUrl,
  entryPoint: address("NEXT_PUBLIC_CONVEY_ENTRYPOINT_ADDRESS"),
  factory: address("NEXT_PUBLIC_CONVEY_SMART_WALLET_FACTORY"),
  implementation: address("NEXT_PUBLIC_CONVEY_SMART_WALLET_IMPLEMENTATION"),
  paymaster: address("NEXT_PUBLIC_CONVEY_EXIT_PAYMASTER_ADDRESS"),
  signer,
  salt: BigInt(required("NEXT_PUBLIC_CONVEY_RECEIVER_SALT")),
  gasSeed: seed,
  relay,
  timeoutMs: 30_000,
});

const summary = {
  checkedAt: new Date().toISOString(),
  receiver: RECEIVER,
  token,
  recipient,
  liveBalance: balance.toString(),
  withdrawalAmount: withdrawalAmount.toString(),
  preparedAccount: prepared.account,
  liveEstimatePrepared: true,
  writeEnabled: writeEnabled(),
};
if (!writeEnabled()) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

const accepted = await relay.submitExit(prepared.userOperation.userOperation, {
  idempotencyKey: `withdraw-${RECEIVER.toLowerCase()}-${token.toLowerCase()}-${recipient.toLowerCase()}-${withdrawalAmount.toString()}`,
});
const result = await relay.waitForExit(accepted.userOperationHash, { timeoutMs: 180_000, pollMs: 1_000 });
console.log(JSON.stringify({ ...summary, userOperationHash: accepted.userOperationHash, result }, null, 2));
if (result.status !== "confirmed" || result.success !== true) throw new Error("gasless withdrawal was included but did not succeed");
