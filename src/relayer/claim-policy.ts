import { decodeAbiParameters, encodeAbiParameters, keccak256, stringToBytes } from "viem";
import type { Address, Hex } from "./types.ts";
import { assertAddress, assertHex } from "./types.ts";

const CALLS_ABI = [
  {
    type: "tuple[]",
    name: "calls",
    components: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
  },
] as const;

const EXECUTE_USER_OP_SIGNATURE = "executeUserOp((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes),bytes32)";
export const OKX_EXECUTE_USER_OP_SELECTOR = keccak256(stringToBytes(EXECUTE_USER_OP_SIGNATURE)).slice(0, 10).toLowerCase() as Hex;

export interface ClaimCall {
  target: Address;
  value: bigint;
  data: Hex;
}

export interface DecodedClaimCall {
  giftId: bigint;
  secret: Hex;
  code: Hex;
}

export function encodeOkxClaimExecution(calls: readonly ClaimCall[]): Hex {
  return `${OKX_EXECUTE_USER_OP_SELECTOR}${encodeAbiParameters(CALLS_ABI, [calls]).slice(2)}` as Hex;
}

export function assertClaimExecutionCalldata(
  callData: unknown,
  claimEscrow: Address,
  claimFunctionSelector: Hex,
): asserts callData is Hex {
  assertHex(callData, "userOperation.callData");
  assertAddress(claimEscrow, "claimEscrow");
  if (!/^0x[0-9a-fA-F]{8}$/.test(claimFunctionSelector)) throw new Error("claimFunctionSelector must be a bytes4 value");
  if (callData.slice(0, 10).toLowerCase() !== OKX_EXECUTE_USER_OP_SELECTOR) throw new Error("claim UserOperation must use OKX executeUserOp");

  let calls: readonly ClaimCall[];
  try {
    [calls] = decodeAbiParameters(CALLS_ABI, `0x${callData.slice(10)}` as Hex) as unknown as [readonly ClaimCall[]];
  } catch {
    throw new Error("claim executeUserOp calldata is not a valid Call[] encoding");
  }
  if (calls.length !== 1) throw new Error("claim UserOperation must contain exactly one call");
  const [call] = calls;
  if (call.target.toLowerCase() !== claimEscrow.toLowerCase()) throw new Error("claim target is not the configured escrow");
  if (call.value !== 0n) throw new Error("claim call cannot transfer native currency");
  if (call.data.length < 10 || call.data.slice(0, 10).toLowerCase() !== claimFunctionSelector.toLowerCase()) {
    throw new Error("claim target call is not the configured claim function");
  }
}

/**
 * Decodes the already policy-checked escrow call without retaining the
 * bearer secret. Callers should use the returned giftId for authorization and
 * discard the secret/code fields immediately.
 */
export function decodeClaimExecutionCalldata(
  callData: Hex,
  claimEscrow: Address,
  claimFunctionSelector: Hex,
): DecodedClaimCall {
  assertClaimExecutionCalldata(callData, claimEscrow, claimFunctionSelector);
  let calls: readonly ClaimCall[];
  try {
    [calls] = decodeAbiParameters(CALLS_ABI, `0x${callData.slice(10)}` as Hex) as unknown as [readonly ClaimCall[]];
    const [giftId, secret, code] = decodeAbiParameters(
      [{ type: "uint256" }, { type: "bytes" }, { type: "bytes" }],
      `0x${calls[0].data.slice(10)}` as Hex,
    );
    if (typeof giftId !== "bigint" || typeof secret !== "string" || typeof code !== "string") {
      throw new Error("claim arguments have the wrong types");
    }
    return { giftId, secret: secret as Hex, code: code as Hex };
  } catch {
    throw new Error("claim target call arguments are not valid");
  }
}
