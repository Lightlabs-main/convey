export type Address = `0x${string}`;
export type Hex = `0x${string}`;

export interface PackedUserOperation {
  sender: Address;
  nonce: bigint;
  initCode: Hex;
  callData: Hex;
  accountGasLimits: Hex;
  preVerificationGas: bigint;
  gasFees: Hex;
  paymasterAndData: Hex;
  signature: Hex;
}

/**
 * ERC-4337 v0.7 JSON-RPC representation. The RPC representation is expanded
 * while the EntryPoint ABI representation is packed.
 */
export interface RpcUserOperationV07 {
  sender: Address;
  nonce: Hex;
  factory?: Address;
  factoryData?: Hex;
  callData: Hex;
  callGasLimit: Hex;
  verificationGasLimit: Hex;
  preVerificationGas: Hex;
  maxFeePerGas: Hex;
  maxPriorityFeePerGas: Hex;
  paymaster?: Address;
  paymasterVerificationGasLimit?: Hex;
  paymasterPostOpGasLimit?: Hex;
  paymasterData?: Hex;
  signature: Hex;
}

export interface UserOperationReceipt {
  userOpHash: Hex;
  sender: Address;
  nonce: Hex;
  actualGasCost: Hex;
  actualGasUsed: Hex;
  success: boolean;
  reason?: Hex;
  receipt: {
    transactionHash: Hex;
    transactionIndex: Hex;
    blockHash: Hex;
    blockNumber: Hex;
    from: Address;
    to: Address;
    cumulativeGasUsed: Hex;
    gasUsed: Hex;
    status: Hex;
  };
}

export interface UserOperationGasEstimate {
  preVerificationGas: Hex;
  verificationGasLimit: Hex;
  callGasLimit: Hex;
  paymasterVerificationGasLimit?: Hex;
  paymasterPostOpGasLimit?: Hex;
}

export interface ClaimRelayAccepted {
  userOperationHash: Hex;
  status: "submitted";
}

export interface ClaimPaymasterAuthorizationResponse {
  paymaster: Address;
  paymasterVerificationGasLimit: Hex;
  paymasterPostOpGasLimit: Hex;
  paymasterData: Hex;
  maxCost: Hex;
  validAfter: Hex;
  validUntil: Hex;
  sponsorNonce: Hex;
}

export interface ClaimRelayStatus {
  userOperationHash: Hex;
  status: "pending" | "confirmed" | "failed";
  success?: boolean;
  transactionHash?: Hex;
  blockNumber?: Hex;
}

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const HEX_PATTERN = /^0x(?:[0-9a-fA-F]{2})*$/;
const QUANTITY_PATTERN = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;

export function isAddress(value: unknown): value is Address {
  return typeof value === "string" && ADDRESS_PATTERN.test(value);
}

export function isHex(value: unknown): value is Hex {
  return typeof value === "string" && HEX_PATTERN.test(value);
}

export function isQuantity(value: unknown): value is Hex {
  return typeof value === "string" && QUANTITY_PATTERN.test(value);
}

export function assertAddress(value: unknown, name: string): asserts value is Address {
  if (!isAddress(value)) throw new Error(`${name} must be a 20-byte address`);
}

export function assertHex(value: unknown, name: string): asserts value is Hex {
  if (!isHex(value)) throw new Error(`${name} must be an even-length hex byte string`);
}

export function assertQuantity(value: unknown, name: string): asserts value is Hex {
  if (!isQuantity(value)) throw new Error(`${name} must be a hex quantity`);
}

export function toQuantity(value: bigint, name: string): Hex {
  if (value < 0n) throw new Error(`${name} cannot be negative`);
  return `0x${value.toString(16)}` as Hex;
}

export function quantityToBigInt(value: unknown, name: string): bigint {
  assertQuantity(value, name);
  return BigInt(value);
}

function hexByteLength(value: Hex): number {
  return (value.length - 2) / 2;
}

function bytesSlice(value: Hex, start: number, end?: number): Hex {
  const clean = value.slice(2);
  return `0x${clean.slice(start * 2, end === undefined ? undefined : end * 2)}` as Hex;
}

function addressFromBytes(value: Hex, name: string): Address {
  if (hexByteLength(value) !== 20) throw new Error(`${name} must contain one address`);
  return value as Address;
}

function uint128FromBytes(value: Hex, name: string): bigint {
  if (hexByteLength(value) !== 16) throw new Error(`${name} must contain a uint128`);
  return BigInt(value);
}

function uint128ToHex(value: bigint, name: string): Hex {
  if (value < 0n || value > ((1n << 128n) - 1n)) {
    throw new Error(`${name} does not fit uint128`);
  }
  return `0x${value.toString(16).padStart(32, "0")}` as Hex;
}

function packUint128Pair(high: bigint, low: bigint, highName: string, lowName: string): Hex {
  return `0x${uint128ToHex(high, highName).slice(2)}${uint128ToHex(low, lowName).slice(2)}` as Hex;
}

export function packAccountGasLimits(verificationGasLimit: bigint, callGasLimit: bigint): Hex {
  return packUint128Pair(verificationGasLimit, callGasLimit, "verificationGasLimit", "callGasLimit");
}

export function unpackAccountGasLimits(accountGasLimits: Hex): {
  verificationGasLimit: bigint;
  callGasLimit: bigint;
} {
  if (hexByteLength(accountGasLimits) !== 32) throw new Error("accountGasLimits must be bytes32");
  return {
    verificationGasLimit: uint128FromBytes(bytesSlice(accountGasLimits, 0, 16), "verificationGasLimit"),
    callGasLimit: uint128FromBytes(bytesSlice(accountGasLimits, 16, 32), "callGasLimit"),
  };
}

export function packGasFees(maxPriorityFeePerGas: bigint, maxFeePerGas: bigint): Hex {
  return packUint128Pair(maxPriorityFeePerGas, maxFeePerGas, "maxPriorityFeePerGas", "maxFeePerGas");
}

export function unpackGasFees(gasFees: Hex): {
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
} {
  if (hexByteLength(gasFees) !== 32) throw new Error("gasFees must be bytes32");
  return {
    maxPriorityFeePerGas: uint128FromBytes(bytesSlice(gasFees, 0, 16), "maxPriorityFeePerGas"),
    maxFeePerGas: uint128FromBytes(bytesSlice(gasFees, 16, 32), "maxFeePerGas"),
  };
}

export function packPaymasterAndData(
  paymaster: Address,
  paymasterVerificationGasLimit: bigint,
  paymasterPostOpGasLimit: bigint,
  paymasterData: Hex,
): Hex {
  assertAddress(paymaster, "paymaster");
  assertHex(paymasterData, "paymasterData");
  const verification = uint128ToHex(paymasterVerificationGasLimit, "paymasterVerificationGasLimit");
  const postOp = uint128ToHex(paymasterPostOpGasLimit, "paymasterPostOpGasLimit");
  return `0x${paymaster.slice(2)}${verification.slice(2)}${postOp.slice(2)}${paymasterData.slice(2)}` as Hex;
}

export function unpackPaymasterAndData(paymasterAndData: Hex): {
  paymaster: Address;
  paymasterVerificationGasLimit: bigint;
  paymasterPostOpGasLimit: bigint;
  paymasterData: Hex;
} | undefined {
  if (paymasterAndData === "0x") return undefined;
  if (hexByteLength(paymasterAndData) < 52) {
    throw new Error("paymasterAndData must contain address, two uint128 values, and optional data");
  }
  return {
    paymaster: addressFromBytes(bytesSlice(paymasterAndData, 0, 20), "paymaster"),
    paymasterVerificationGasLimit: uint128FromBytes(bytesSlice(paymasterAndData, 20, 36), "paymasterVerificationGasLimit"),
    paymasterPostOpGasLimit: uint128FromBytes(bytesSlice(paymasterAndData, 36, 52), "paymasterPostOpGasLimit"),
    paymasterData: bytesSlice(paymasterAndData, 52),
  };
}

export function splitInitCode(initCode: Hex): { factory: Address; factoryData: Hex } | undefined {
  if (initCode === "0x") return undefined;
  if (hexByteLength(initCode) < 20) throw new Error("initCode must start with a factory address");
  return {
    factory: addressFromBytes(bytesSlice(initCode, 0, 20), "factory"),
    factoryData: bytesSlice(initCode, 20),
  };
}

export function joinInitCode(factory: Address, factoryData: Hex): Hex {
  assertAddress(factory, "factory");
  assertHex(factoryData, "factoryData");
  return `0x${factory.slice(2)}${factoryData.slice(2)}` as Hex;
}

export function toRpcUserOperation(userOperation: PackedUserOperation): RpcUserOperationV07 {
  assertPackedUserOperation(userOperation);
  const gasLimits = unpackAccountGasLimits(userOperation.accountGasLimits);
  const gasFees = unpackGasFees(userOperation.gasFees);
  const initCode = splitInitCode(userOperation.initCode);
  const paymaster = unpackPaymasterAndData(userOperation.paymasterAndData);

  return {
    sender: userOperation.sender,
    nonce: toQuantity(userOperation.nonce, "nonce"),
    ...(initCode ?? {}),
    callData: userOperation.callData,
    callGasLimit: toQuantity(gasLimits.callGasLimit, "callGasLimit"),
    verificationGasLimit: toQuantity(gasLimits.verificationGasLimit, "verificationGasLimit"),
    preVerificationGas: toQuantity(userOperation.preVerificationGas, "preVerificationGas"),
    maxFeePerGas: toQuantity(gasFees.maxFeePerGas, "maxFeePerGas"),
    maxPriorityFeePerGas: toQuantity(gasFees.maxPriorityFeePerGas, "maxPriorityFeePerGas"),
    ...(paymaster
      ? {
          paymaster: paymaster.paymaster,
          paymasterVerificationGasLimit: toQuantity(paymaster.paymasterVerificationGasLimit, "paymasterVerificationGasLimit"),
          paymasterPostOpGasLimit: toQuantity(paymaster.paymasterPostOpGasLimit, "paymasterPostOpGasLimit"),
          paymasterData: paymaster.paymasterData,
        }
      : {}),
    signature: userOperation.signature,
  };
}

export function fromRpcUserOperation(userOperation: RpcUserOperationV07): PackedUserOperation {
  assertRpcUserOperationV07(userOperation);
  const initCode = userOperation.factory
    ? joinInitCode(userOperation.factory, userOperation.factoryData ?? "0x")
    : "0x";
  const paymasterAndData = userOperation.paymaster
    ? packPaymasterAndData(
        userOperation.paymaster,
        BigInt(userOperation.paymasterVerificationGasLimit!),
        BigInt(userOperation.paymasterPostOpGasLimit!),
        userOperation.paymasterData ?? "0x",
      )
    : "0x";

  return {
    sender: userOperation.sender,
    nonce: BigInt(userOperation.nonce),
    initCode,
    callData: userOperation.callData,
    accountGasLimits: packAccountGasLimits(BigInt(userOperation.verificationGasLimit), BigInt(userOperation.callGasLimit)),
    preVerificationGas: BigInt(userOperation.preVerificationGas),
    gasFees: packGasFees(BigInt(userOperation.maxPriorityFeePerGas), BigInt(userOperation.maxFeePerGas)),
    paymasterAndData,
    signature: userOperation.signature,
  };
}

export function assertPackedUserOperation(value: unknown): asserts value is PackedUserOperation {
  if (!value || typeof value !== "object") throw new Error("userOperation must be an object");
  const operation = value as Record<string, unknown>;
  assertAddress(operation.sender, "userOperation.sender");
  if (typeof operation.nonce !== "bigint" || operation.nonce < 0n) throw new Error("userOperation.nonce must be a non-negative bigint");
  for (const field of ["initCode", "callData", "accountGasLimits", "gasFees", "paymasterAndData", "signature"]) {
    assertHex(operation[field], `userOperation.${field}`);
  }
  if (typeof operation.preVerificationGas !== "bigint" || operation.preVerificationGas < 0n) {
    throw new Error("userOperation.preVerificationGas must be a non-negative bigint");
  }
  if (hexByteLength(operation.accountGasLimits as Hex) !== 32) throw new Error("userOperation.accountGasLimits must be bytes32");
  if (hexByteLength(operation.gasFees as Hex) !== 32) throw new Error("userOperation.gasFees must be bytes32");
  splitInitCode(operation.initCode as Hex);
  unpackPaymasterAndData(operation.paymasterAndData as Hex);
}

export function assertRpcUserOperationV07(value: unknown): asserts value is RpcUserOperationV07 {
  if (!value || typeof value !== "object") throw new Error("userOperation must be an object");
  const operation = value as Record<string, unknown>;
  assertAddress(operation.sender, "userOperation.sender");
  for (const field of [
    "nonce",
    "callGasLimit",
    "verificationGasLimit",
    "preVerificationGas",
    "maxFeePerGas",
    "maxPriorityFeePerGas",
  ]) {
    assertQuantity(operation[field], `userOperation.${field}`);
  }
  for (const field of ["callData", "signature"]) {
    assertHex(operation[field], `userOperation.${field}`);
  }
  if (operation.factory !== undefined) {
    assertAddress(operation.factory, "userOperation.factory");
    if (operation.factoryData !== undefined) assertHex(operation.factoryData, "userOperation.factoryData");
  } else if (operation.factoryData !== undefined) {
    throw new Error("userOperation.factoryData cannot be supplied without factory");
  }
  if (operation.paymaster !== undefined) {
    assertAddress(operation.paymaster, "userOperation.paymaster");
    for (const field of ["paymasterVerificationGasLimit", "paymasterPostOpGasLimit"]) {
      assertQuantity(operation[field], `userOperation.${field}`);
    }
    if (operation.paymasterData !== undefined) assertHex(operation.paymasterData, "userOperation.paymasterData");
  } else if (operation.paymasterVerificationGasLimit !== undefined || operation.paymasterPostOpGasLimit !== undefined || operation.paymasterData !== undefined) {
    throw new Error("paymaster fields cannot be supplied without paymaster");
  }
}

export function assertSponsoredUserOperation(value: unknown): asserts value is RpcUserOperationV07 {
  assertRpcUserOperationV07(value);
  if (!value.paymaster) throw new Error("claim UserOperation must use the Convey paymaster");
  if (value.signature === "0x") throw new Error("claim UserOperation must contain a signature");
}

export function isUserOperationHash(value: unknown): value is Hex {
  return isHex(value) && value.length === 66;
}

export function assertUserOperationHash(value: unknown, name = "userOperationHash"): asserts value is Hex {
  if (!isUserOperationHash(value)) throw new Error(`${name} must be a 32-byte hex value`);
}
