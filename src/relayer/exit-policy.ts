import { decodeAbiParameters, encodeAbiParameters, encodeFunctionData, keccak256, stringToBytes } from "viem";
import type { Address, Hex } from "./types.ts";
import { assertAddress, assertHex } from "./types.ts";

const CALLS_ABI = [{
  type: "tuple[]",
  name: "calls",
  components: [
    { name: "target", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
  ],
}] as const;

const ERC20_ABI = [{
  type: "function",
  name: "approve",
  stateMutability: "nonpayable",
  inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
  outputs: [{ type: "bool" }],
}, {
  type: "function",
  name: "transfer",
  stateMutability: "nonpayable",
  inputs: [{ name: "recipient", type: "address" }, { name: "amount", type: "uint256" }],
  outputs: [{ type: "bool" }],
}] as const;

const ROUTER_ABI = [{
  type: "function",
  name: "exactInput",
  stateMutability: "payable",
  inputs: [{ name: "params", type: "tuple", components: [
    { name: "path", type: "bytes" },
    { name: "recipient", type: "address" },
    { name: "deadline", type: "uint256" },
    { name: "amountIn", type: "uint256" },
    { name: "amountOutMinimum", type: "uint256" },
  ] }],
  outputs: [{ name: "amountOut", type: "uint256" }],
}] as const;

export const OKX_EXECUTE_USER_OP_SELECTOR = keccak256(stringToBytes(
  "executeUserOp((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes),bytes32)",
)).slice(0, 10).toLowerCase() as Hex;

export interface ExitCall {
  target: Address;
  value: bigint;
  data: Hex;
}

export function encodeOkxExitExecution(calls: readonly ExitCall[]): Hex {
  return `${OKX_EXECUTE_USER_OP_SELECTOR}${encodeAbiParameters(CALLS_ABI, [calls]).slice(2)}` as Hex;
}

export function buildWithdrawalCall(token: Address, recipient: Address, amount: bigint): ExitCall {
  assertAddress(token, "withdrawal token");
  assertAddress(recipient, "withdrawal recipient");
  if (amount <= 0n) throw new Error("withdrawal amount must be greater than zero");
  return {
    target: token,
    value: 0n,
    data: encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [recipient, amount] }),
  };
}

export function buildCashOutCalls(options: {
  inputToken: Address;
  router: Address;
  path: Hex;
  recipient: Address;
  amountIn: bigint;
  amountOutMinimum: bigint;
  deadline: bigint;
}): ExitCall[] {
  assertAddress(options.inputToken, "cash-out input token");
  assertAddress(options.router, "cash-out router");
  assertAddress(options.recipient, "cash-out recipient");
  assertHex(options.path, "cash-out path");
  if (options.amountIn <= 0n || options.amountOutMinimum <= 0n) throw new Error("cash-out amounts must be greater than zero");
  if (options.deadline <= 0n) throw new Error("cash-out deadline must be greater than zero");
  return [
    {
      target: options.inputToken,
      value: 0n,
      data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [options.router, options.amountIn] }),
    },
    {
      target: options.router,
      value: 0n,
      data: encodeFunctionData({
        abi: ROUTER_ABI,
        functionName: "exactInput",
        args: [{
          path: options.path,
          recipient: options.recipient,
          deadline: options.deadline,
          amountIn: options.amountIn,
          amountOutMinimum: options.amountOutMinimum,
        }],
      }),
    },
    {
      target: options.inputToken,
      value: 0n,
      data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [options.router, 0n] }),
    },
  ];
}

function callsFromCalldata(callData: Hex): readonly ExitCall[] {
  if (callData.slice(0, 10).toLowerCase() !== OKX_EXECUTE_USER_OP_SELECTOR) throw new Error("exit UserOperation must use OKX executeUserOp");
  try {
    return decodeAbiParameters(CALLS_ABI, `0x${callData.slice(10)}` as Hex)[0] as readonly ExitCall[];
  } catch {
    throw new Error("exit executeUserOp calldata is not a valid Call[] encoding");
  }
}

export function assertExitExecutionCalldata(
  callData: unknown,
  sender: Address,
  allowedAssets: readonly Address[],
  router: Address,
  usdt0: Address,
): asserts callData is Hex {
  assertHex(callData, "userOperation.callData");
  assertAddress(sender, "exit sender");
  assertAddress(router, "exit router");
  assertAddress(usdt0, "exit USDT0");
  const calls = callsFromCalldata(callData);
  const allowed = new Set(allowedAssets.map((asset) => asset.toLowerCase()));
  if (calls.length === 1) {
    const [call] = calls;
    if (call.value !== 0n || (!allowed.has(call.target.toLowerCase()) && call.target.toLowerCase() !== usdt0.toLowerCase())) {
      throw new Error("withdrawal target is not an enabled asset or USDT0");
    }
    const [recipient, amount] = decodeTransfer(call.data);
    if (recipient === "0x0000000000000000000000000000000000000000" || amount === 0n) throw new Error("withdrawal is empty");
    if (recipient.toLowerCase() === sender.toLowerCase()) throw new Error("withdrawal recipient must differ from the receiver account");
    return;
  }
  if (calls.length !== 3) throw new Error("exit must contain one withdrawal call or three cash-out calls");
  const [approval, swap, reset] = calls;
  if (approval.value !== 0n || reset.value !== 0n || swap.value !== 0n) throw new Error("exit calls cannot transfer native currency");
  const [spender, amount] = decodeApprove(approval.data);
  const inputToken = approval.target;
  if (!allowed.has(inputToken.toLowerCase()) || spender.toLowerCase() !== router.toLowerCase() || amount === 0n) throw new Error("cash-out approval is not allowed");
  const [path, recipient, deadline, amountIn, amountOutMinimum] = decodeExactInput(swap.data);
  if (swap.target.toLowerCase() !== router.toLowerCase() || recipient.toLowerCase() !== sender.toLowerCase() || amountIn !== amount || amountOutMinimum === 0n) {
    throw new Error("cash-out swap parameters are not allowed");
  }
  if (deadline < BigInt(Math.floor(Date.now() / 1000)) || deadline > BigInt(Math.floor(Date.now() / 1000) + 300)) throw new Error("cash-out deadline is not live");
  validatePath(path, inputToken, usdt0);
  const [resetSpender, resetAmount] = decodeApprove(reset.data);
  if (reset.target.toLowerCase() !== inputToken.toLowerCase() || resetSpender.toLowerCase() !== router.toLowerCase() || resetAmount !== 0n) throw new Error("cash-out approval reset is not allowed");
}

function decodeApprove(data: Hex): [Address, bigint] {
  const [spender, amount] = decodeAbiParameters([{ type: "address" }, { type: "uint256" }], `0x${data.slice(10)}` as Hex);
  if (data.slice(0, 10).toLowerCase() !== "0x095ea7b3" || typeof spender !== "string" || typeof amount !== "bigint") throw new Error("invalid approve call");
  return [spender, amount];
}

function decodeTransfer(data: Hex): [Address, bigint] {
  const [recipient, amount] = decodeAbiParameters([{ type: "address" }, { type: "uint256" }], `0x${data.slice(10)}` as Hex);
  if (data.slice(0, 10).toLowerCase() !== "0xa9059cbb" || typeof recipient !== "string" || typeof amount !== "bigint") throw new Error("invalid transfer call");
  return [recipient, amount];
}

function decodeExactInput(data: Hex): [Hex, Address, bigint, bigint, bigint] {
  if (data.slice(0, 10).toLowerCase() !== "0xc04b8d59") throw new Error("invalid exactInput call");
  const [params] = decodeAbiParameters([{ type: "tuple", components: [
    { name: "path", type: "bytes" },
    { name: "recipient", type: "address" },
    { name: "deadline", type: "uint256" },
    { name: "amountIn", type: "uint256" },
    { name: "amountOutMinimum", type: "uint256" },
  ] }], `0x${data.slice(10)}` as Hex);
  if (!params || (typeof params !== "object")) throw new Error("invalid exactInput call");
  const tuple: unknown[] = Array.isArray(params)
    ? params
    : [
      (params as Record<string, unknown>).path,
      (params as Record<string, unknown>).recipient,
      (params as Record<string, unknown>).deadline,
      (params as Record<string, unknown>).amountIn,
      (params as Record<string, unknown>).amountOutMinimum,
    ];
  if (typeof tuple[0] !== "string" || typeof tuple[1] !== "string" || typeof tuple[2] !== "bigint" || typeof tuple[3] !== "bigint" || typeof tuple[4] !== "bigint") throw new Error("invalid exactInput arguments");
  return [tuple[0] as Hex, tuple[1] as Address, tuple[2], tuple[3], tuple[4]];
}

function validatePath(path: Hex, inputToken: Address, usdt0: Address): void {
  const bytes = (path.length - 2) / 2;
  if (bytes < 43 || (bytes - 20) % 23 !== 0) throw new Error("cash-out path is not a Uniswap V3 path");
  const first = `0x${path.slice(2, 42)}`.toLowerCase();
  const last = `0x${path.slice(-40)}`.toLowerCase();
  if (first !== inputToken.toLowerCase() || last !== usdt0.toLowerCase()) throw new Error("cash-out path endpoints are not allowed");
}
