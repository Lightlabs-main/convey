import {
  decodeAbiParameters,
  encodeAbiParameters,
  encodeFunctionData,
  hashMessage,
  keccak256,
  recoverAddress,
} from "viem";
import { XLAYER_CHAIN_ID, XLAYER_ENTRYPOINT_V07 } from "./config.ts";
import { assertClaimExecutionCalldata, encodeOkxClaimExecution, type ClaimCall } from "./claim-policy.ts";
import { encodeOkxExitExecution, type ExitCall } from "./exit-policy.ts";
import {
  signClaimPaymasterAuthorization,
  type ClaimPaymasterAuthorization,
  type ClaimPaymasterSponsorSigner,
} from "./claim-paymaster.ts";
import {
  signExitPaymasterAuthorization,
  type ExitPaymasterAuthorization,
  type ExitPaymasterSponsorSigner,
} from "./exit-paymaster.ts";
import { JsonRpcClient } from "./rpc.ts";
import type { Address, Hex, PackedUserOperation, RpcUserOperationV07 } from "./types.ts";
import {
  assertAddress,
  assertHex,
  fromRpcUserOperation,
  isHex,
  joinInitCode,
  packAccountGasLimits,
  packGasFees,
  packPaymasterAndData,
  toRpcUserOperation,
} from "./types.ts";

/** The built-in ECDSA validator in the deployed OKX Smart Wallet. */
export const OKX_ECDSA_VALIDATOR = "0x0000000000000000000000000000000000000001" as Address;

const FACTORY_ABI = [
  {
    type: "function",
    name: "getAddress",
    stateMutability: "view",
    inputs: [
      {
        name: "initialOwners",
        type: "tuple[]",
        components: [
          { name: "keyHash", type: "bytes32" },
          { name: "validator", type: "address" },
        ],
      },
      { name: "salt", type: "uint256" },
    ],
    outputs: [{ name: "account", type: "address" }],
  },
  {
    type: "function",
    name: "createAccount",
    stateMutability: "payable",
    inputs: [
      {
        name: "initialOwners",
        type: "tuple[]",
        components: [
          { name: "keyHash", type: "bytes32" },
          { name: "validator", type: "address" },
        ],
      },
      { name: "salt", type: "uint256" },
    ],
    outputs: [{ name: "account", type: "address" }],
  },
] as const;

const ENTRYPOINT_ABI = [
  {
    type: "function",
    name: "getNonce",
    stateMutability: "view",
    inputs: [
      { name: "sender", type: "address" },
      { name: "key", type: "uint192" },
    ],
    outputs: [{ name: "nonce", type: "uint256" }],
  },
  {
    type: "function",
    name: "getUserOpHash",
    stateMutability: "view",
    inputs: [
      {
        name: "userOp",
        type: "tuple",
        components: [
          { name: "sender", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "initCode", type: "bytes" },
          { name: "callData", type: "bytes" },
          { name: "accountGasLimits", type: "bytes32" },
          { name: "preVerificationGas", type: "uint256" },
          { name: "gasFees", type: "bytes32" },
          { name: "paymasterAndData", type: "bytes" },
          { name: "signature", type: "bytes" },
        ],
      },
    ],
    outputs: [{ name: "userOpHash", type: "bytes32" }],
  },
] as const;

interface InitialOwner {
  keyHash: Hex;
  validator: Address;
}

export interface OkxEcdsaMessageSigner {
  address: Address;
  signMessage(parameters: { message: { raw: Hex } }): Promise<Hex>;
}

export interface OkxClaimGas {
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export interface OkxClaimPaymaster {
  address: Address;
  verificationGasLimit: bigint;
  postOpGasLimit: bigint;
  /** Opaque pre-signed data for callers that sign sponsorship separately. */
  data?: Hex;
  /** Convey claim authorization signed over the operation fields. */
  authorization?: {
    giftId: bigint;
    maxCost: bigint;
    validAfter: bigint;
    validUntil: bigint;
    sponsorNonce: bigint;
    signer: ClaimPaymasterSponsorSigner;
  };
}

export interface BuildOkxClaimUserOperationOptions {
  /** HTTPS X Layer execution RPC; this is a read-only dependency. */
  executionRpcUrl: string;
  entryPoint: Address;
  factory: Address;
  implementation: Address;
  signer: OkxEcdsaMessageSigner;
  salt: bigint;
  escrow: Address;
  claimFunctionSelector: Hex;
  claimData: Hex;
  gas: OkxClaimGas;
  paymaster: OkxClaimPaymaster;
  /** Set this when the caller already reserved a specific EntryPoint nonce. */
  nonce?: bigint;
  /** EntryPoint nonce key used when nonce is not supplied. */
  nonceKey?: bigint;
  /** OKX uses zero for no account-signature expiry. The escrow owns gift expiry. */
  validUntil?: bigint;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface BuiltOkxClaimUserOperation {
  account: Address;
  deployed: boolean;
  owner: Address;
  keyHash: Hex;
  validUntil: bigint;
  /** The hash signed by the owner after OKX's EIP-191 wrapping. */
  ownerMessageHash: Hex;
  userOpHash: Hex;
  userOperation: PackedUserOperation;
  rpcUserOperation: RpcUserOperationV07;
  claimPaymasterDigest?: Hex;
  claimPaymasterSignature?: Hex;
}

export interface OkxExitPaymaster {
  address: Address;
  verificationGasLimit: bigint;
  postOpGasLimit: bigint;
  data?: Hex;
  authorization?: {
    actionHash: Hex;
    maxCost: bigint;
    validAfter: bigint;
    validUntil: bigint;
    sponsorNonce: bigint;
    signer: ExitPaymasterSponsorSigner;
  };
}

export interface BuildOkxExitUserOperationOptions {
  executionRpcUrl: string;
  entryPoint: Address;
  factory: Address;
  implementation: Address;
  signer: OkxEcdsaMessageSigner;
  salt: bigint;
  calls: readonly ExitCall[];
  gas: OkxClaimGas;
  paymaster: OkxExitPaymaster;
  nonce?: bigint;
  nonceKey?: bigint;
  validUntil?: bigint;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface BuiltOkxExitUserOperation {
  account: Address;
  deployed: boolean;
  owner: Address;
  keyHash: Hex;
  validUntil: bigint;
  ownerMessageHash: Hex;
  userOpHash: Hex;
  userOperation: PackedUserOperation;
  rpcUserOperation: RpcUserOperationV07;
  exitPaymasterDigest?: Hex;
  exitPaymasterSignature?: Hex;
}

function byteLength(value: Hex): number {
  return (value.length - 2) / 2;
}

function assertNonNegative(value: bigint, name: string): void {
  if (typeof value !== "bigint" || value < 0n) throw new Error(`${name} must be a non-negative bigint`);
}

function assertPositive(value: bigint, name: string): void {
  assertNonNegative(value, name);
  if (value === 0n) throw new Error(`${name} must be greater than zero for a real UserOperation`);
}

function fixedHex(value: bigint, bytes: number, name: string): Hex {
  assertNonNegative(value, name);
  const maximum = 1n << BigInt(bytes * 8);
  if (value >= maximum) throw new Error(`${name} does not fit ${bytes} bytes`);
  return `0x${value.toString(16).padStart(bytes * 2, "0")}` as Hex;
}

function bytes32(value: unknown, name: string): Hex {
  assertHex(value, name);
  if (byteLength(value) !== 32) throw new Error(`${name} must be bytes32`);
  return value;
}

function decodeAddress(value: Hex, name: string): Address {
  const [decoded] = decodeAbiParameters([{ type: "address" }], value);
  assertAddress(decoded, name);
  return decoded;
}

function decodeUint256(value: Hex, name: string): bigint {
  const [decoded] = decodeAbiParameters([{ type: "uint256" }], value);
  if (typeof decoded !== "bigint") throw new Error(`${name} did not decode as uint256`);
  return decoded;
}

async function ethCall(rpc: JsonRpcClient, to: Address, data: Hex): Promise<Hex> {
  const value = await rpc.request<unknown>("eth_call", [{ to, data }, "latest"]);
  if (!isHex(value)) throw new Error("execution RPC returned an invalid eth_call result");
  return value;
}

export function okxOwnerKeyHash(owner: Address): Hex {
  assertAddress(owner, "owner");
  return keccak256(owner) as Hex;
}

/**
 * Encodes the exact signature envelope consumed by SmartWallet.validateUserOp:
 * keyHash (32 bytes) || validUntil (6 bytes) || ECDSA signature (65 bytes).
 */
export function encodeOkxOwnerSignature(keyHash: Hex, validUntil: bigint, signature: Hex): Hex {
  bytes32(keyHash, "keyHash");
  assertHex(signature, "signature");
  if (byteLength(signature) !== 65) throw new Error("OKX ECDSA signature must be 65 bytes");
  const encodedValidUntil = fixedHex(validUntil, 6, "validUntil");
  return `0x${keyHash.slice(2)}${encodedValidUntil.slice(2)}${signature.slice(2)}` as Hex;
}

export function encodeOkxFactoryInitCode(factory: Address, initialOwners: readonly InitialOwner[], salt: bigint): Hex {
  assertAddress(factory, "factory");
  assertNonNegative(salt, "salt");
  if (initialOwners.length === 0) throw new Error("OKX Smart Wallet requires at least one initial owner");
  for (const owner of initialOwners) {
    bytes32(owner.keyHash, "initialOwner.keyHash");
    assertAddress(owner.validator, "initialOwner.validator");
  }
  const factoryData = encodeFunctionData({
    abi: FACTORY_ABI,
    functionName: "createAccount",
    args: [initialOwners, salt],
  });
  return joinInitCode(factory, factoryData);
}

function ownerMessagePrehash(userOpHash: Hex, validUntil: bigint, implementation: Address): Hex {
  bytes32(userOpHash, "userOpHash");
  assertAddress(implementation, "implementation");
  fixedHex(validUntil, 6, "validUntil");
  // SmartWallet uses keccak256(abi.encode(userOpHash, validUntil, IMPLEMENTATION))
  // and then OpenZeppelin's toEthSignedMessageHash(bytes32). The latter is
  // applied by signMessage({ message: { raw } }) below.
  return keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "uint48" }, { type: "address" }],
    [userOpHash, Number(validUntil), implementation],
  )) as Hex;
}

/** Returns the EIP-191 digest that the OKX owner validator recovers. */
export function okxOwnerSigningDigest(
  userOpHash: Hex,
  validUntil: bigint,
  implementation: Address,
): Hex {
  return hashMessage({ raw: ownerMessagePrehash(userOpHash, validUntil, implementation) }) as Hex;
}

function claimCall(escrow: Address, claimData: Hex): ClaimCall {
  assertAddress(escrow, "escrow");
  assertHex(claimData, "claimData");
  if (byteLength(claimData) < 4) throw new Error("claimData must include a function selector");
  return { target: escrow, value: 0n, data: claimData };
}

function validateOptions(options: BuildOkxClaimUserOperationOptions): void {
  if (options.entryPoint.toLowerCase() !== XLAYER_ENTRYPOINT_V07) {
    throw new Error(`entryPoint must be the verified X Layer v0.7 EntryPoint ${XLAYER_ENTRYPOINT_V07}`);
  }
  assertAddress(options.entryPoint, "entryPoint");
  assertAddress(options.factory, "factory");
  assertAddress(options.implementation, "implementation");
  assertAddress(options.signer.address, "signer.address");
  assertAddress(options.paymaster.address, "paymaster.address");
  assertNonNegative(options.salt, "salt");
  if (options.nonce !== undefined) assertNonNegative(options.nonce, "nonce");
  const nonceKey = options.nonceKey ?? 0n;
  if (options.nonce === undefined) {
    assertNonNegative(nonceKey, "nonceKey");
    if (nonceKey >= (1n << 192n)) throw new Error("nonceKey does not fit uint192");
  }
  assertHex(options.claimFunctionSelector, "claimFunctionSelector");
  if (options.claimFunctionSelector.length !== 10) throw new Error("claimFunctionSelector must be a bytes4 selector");
  assertHex(options.claimData, "claimData");
  for (const [name, value] of Object.entries(options.gas)) assertPositive(value, `gas.${name}`);
  assertPositive(options.paymaster.verificationGasLimit, "paymaster.verificationGasLimit");
  assertPositive(options.paymaster.postOpGasLimit, "paymaster.postOpGasLimit");
  if (options.paymaster.data !== undefined) assertHex(options.paymaster.data, "paymaster.data");
  if (!options.paymaster.data && !options.paymaster.authorization) {
    throw new Error("paymaster.data or paymaster.authorization is required");
  }
  if (options.validUntil !== undefined) fixedHex(options.validUntil, 6, "validUntil");
}

/**
 * Builds and signs a real OKX Smart Wallet v0.7 claim operation.
 *
 * It reads chain ID, EntryPoint nonce, counterfactual account address, and
 * deployment state from the supplied execution RPC. It deliberately requires
 * caller-supplied gas and paymaster data: no fee, price, sponsorship, or claim
 * operation is fabricated here.
 */
export async function buildOkxClaimUserOperation(
  options: BuildOkxClaimUserOperationOptions,
): Promise<BuiltOkxClaimUserOperation> {
  validateOptions(options);
  const rpc = new JsonRpcClient(options.executionRpcUrl, {
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
  });

  const chainIdHex = await rpc.request<unknown>("eth_chainId");
  if (!isHex(chainIdHex) || Number(BigInt(chainIdHex)) !== XLAYER_CHAIN_ID) {
    throw new Error(`execution RPC must be X Layer chain ${XLAYER_CHAIN_ID}`);
  }
  const entryPointCode = await rpc.request<unknown>("eth_getCode", [options.entryPoint, "latest"]);
  if (!isHex(entryPointCode) || entryPointCode === "0x") throw new Error("configured EntryPoint has no deployed bytecode");
  const [factoryCode, implementationCode] = await Promise.all([
    rpc.request<unknown>("eth_getCode", [options.factory, "latest"]),
    rpc.request<unknown>("eth_getCode", [options.implementation, "latest"]),
  ]);
  if (!isHex(factoryCode) || factoryCode === "0x") throw new Error("configured OKX factory has no deployed bytecode");
  if (!isHex(implementationCode) || implementationCode === "0x") throw new Error("configured OKX implementation has no deployed bytecode");

  const keyHash = okxOwnerKeyHash(options.signer.address);
  const initialOwners: InitialOwner[] = [{ keyHash, validator: OKX_ECDSA_VALIDATOR }];
  const getAddressData = encodeFunctionData({
    abi: FACTORY_ABI,
    functionName: "getAddress",
    args: [initialOwners, options.salt],
  });
  const account = decodeAddress(await ethCall(rpc, options.factory, getAddressData), "counterfactual account");
  const accountCode = await rpc.request<unknown>("eth_getCode", [account, "latest"]);
  if (!isHex(accountCode)) throw new Error("execution RPC returned invalid account bytecode");
  const deployed = accountCode !== "0x";
  const initCode = deployed ? "0x" as Hex : encodeOkxFactoryInitCode(options.factory, initialOwners, options.salt);

  const nonce = options.nonce ?? decodeUint256(
    await ethCall(
      rpc,
      options.entryPoint,
      encodeFunctionData({
        abi: ENTRYPOINT_ABI,
        functionName: "getNonce",
        args: [account, options.nonceKey ?? 0n],
      }),
    ),
    "EntryPoint nonce",
  );
  const callData = encodeOkxClaimExecution([claimCall(options.escrow, options.claimData)]);
  assertClaimExecutionCalldata(callData, options.escrow, options.claimFunctionSelector);

  const placeholderPaymasterData = options.paymaster.authorization
    ? `0x${"00".repeat(141)}` as Hex
    : options.paymaster.data!;
  let paymasterAndData = packPaymasterAndData(
    options.paymaster.address,
    options.paymaster.verificationGasLimit,
    options.paymaster.postOpGasLimit,
    placeholderPaymasterData,
  );
  let unsignedOperation: PackedUserOperation = {
    sender: account,
    nonce,
    initCode,
    callData,
    accountGasLimits: packAccountGasLimits(options.gas.verificationGasLimit, options.gas.callGasLimit),
    preVerificationGas: options.gas.preVerificationGas,
    gasFees: packGasFees(options.gas.maxPriorityFeePerGas, options.gas.maxFeePerGas),
    paymasterAndData,
    signature: "0x",
  };

  let claimPaymasterDigest: Hex | undefined;
  let claimPaymasterSignature: Hex | undefined;
  if (options.paymaster.authorization) {
    const authorization: ClaimPaymasterAuthorization = {
      entryPoint: options.entryPoint,
      paymaster: options.paymaster.address,
      giftId: options.paymaster.authorization.giftId,
      maxCost: options.paymaster.authorization.maxCost,
      paymasterVerificationGasLimit: options.paymaster.verificationGasLimit,
      paymasterPostOpGasLimit: options.paymaster.postOpGasLimit,
      validAfter: options.paymaster.authorization.validAfter,
      validUntil: options.paymaster.authorization.validUntil,
      sponsorNonce: options.paymaster.authorization.sponsorNonce,
    };
    const sponsorship = await signClaimPaymasterAuthorization(
      unsignedOperation,
      authorization,
      options.paymaster.authorization.signer,
    );
    claimPaymasterDigest = sponsorship.digest;
    claimPaymasterSignature = sponsorship.signature;
    paymasterAndData = sponsorship.paymasterAndData;
    unsignedOperation = { ...unsignedOperation, paymasterAndData };
  }

  // Convert through the checked codec so packed fields cannot silently drift
  // from the JSON-RPC v0.7 representation sent to Convey's private gateway.
  toRpcUserOperation(unsignedOperation);
  const hashCallData = encodeFunctionData({
    abi: ENTRYPOINT_ABI,
    functionName: "getUserOpHash",
    args: [{
      sender: unsignedOperation.sender,
      nonce: unsignedOperation.nonce,
      initCode: unsignedOperation.initCode,
      callData: unsignedOperation.callData,
      accountGasLimits: unsignedOperation.accountGasLimits,
      preVerificationGas: unsignedOperation.preVerificationGas,
      gasFees: unsignedOperation.gasFees,
      paymasterAndData: unsignedOperation.paymasterAndData,
      signature: unsignedOperation.signature,
    }],
  });
  const userOpHash = decodeAbiParameters(
    [{ type: "bytes32" }],
    await ethCall(rpc, options.entryPoint, hashCallData),
  )[0] as Hex;
  const validUntil = options.validUntil ?? 0n;
  const ownerPrehash = ownerMessagePrehash(userOpHash, validUntil, options.implementation);
  const ownerSigningDigest = okxOwnerSigningDigest(
    userOpHash,
    validUntil,
    options.implementation,
  );
  const rawSignature = await options.signer.signMessage({ message: { raw: ownerPrehash } });
  const recoveredOwner = await recoverAddress({ hash: ownerSigningDigest, signature: rawSignature });
  if (recoveredOwner.toLowerCase() !== options.signer.address.toLowerCase()) {
    throw new Error("owner signer returned a signature for a different address");
  }
  const signature = encodeOkxOwnerSignature(keyHash, validUntil, rawSignature);
  const userOperation: PackedUserOperation = { ...unsignedOperation, signature };
  const rpcUserOperation = toRpcUserOperation(userOperation);

  // Keep this conversion in the function so an accidental future change to
  // the signed fields cannot return an operation different from the hashed one.
  if (fromRpcUserOperation(rpcUserOperation).signature !== signature) {
    throw new Error("signed UserOperation failed v0.7 codec round-trip");
  }
  return {
    account,
    deployed,
    owner: options.signer.address,
    keyHash,
    validUntil,
    ownerMessageHash: ownerSigningDigest,
    userOpHash,
    userOperation,
    rpcUserOperation,
    claimPaymasterDigest,
    claimPaymasterSignature,
  };
}

/** Builds the same live OKX v0.7 account operation shape for an exit action. */
export async function buildOkxExitUserOperation(
  options: BuildOkxExitUserOperationOptions,
): Promise<BuiltOkxExitUserOperation> {
  if (options.entryPoint.toLowerCase() !== XLAYER_ENTRYPOINT_V07) throw new Error(`entryPoint must be the verified X Layer v0.7 EntryPoint ${XLAYER_ENTRYPOINT_V07}`);
  assertAddress(options.entryPoint, "entryPoint");
  assertAddress(options.factory, "factory");
  assertAddress(options.implementation, "implementation");
  assertAddress(options.signer.address, "signer.address");
  assertAddress(options.paymaster.address, "paymaster.address");
  assertNonNegative(options.salt, "salt");
  if (options.nonce !== undefined) assertNonNegative(options.nonce, "nonce");
  const nonceKey = options.nonceKey ?? 0n;
  if (options.nonce === undefined && (nonceKey < 0n || nonceKey >= (1n << 192n))) throw new Error("nonceKey does not fit uint192");
  if (options.calls.length === 0) throw new Error("exit requires at least one account call");
  for (const [name, value] of Object.entries(options.gas)) assertPositive(value, `gas.${name}`);
  assertPositive(options.paymaster.verificationGasLimit, "paymaster.verificationGasLimit");
  assertPositive(options.paymaster.postOpGasLimit, "paymaster.postOpGasLimit");
  if (options.paymaster.data !== undefined) assertHex(options.paymaster.data, "paymaster.data");
  if (!options.paymaster.data && !options.paymaster.authorization) throw new Error("paymaster.data or paymaster.authorization is required");
  if (options.validUntil !== undefined) fixedHex(options.validUntil, 6, "validUntil");

  const rpc = new JsonRpcClient(options.executionRpcUrl, { timeoutMs: options.timeoutMs, fetchImpl: options.fetchImpl });
  const chainIdHex = await rpc.request<unknown>("eth_chainId");
  if (!isHex(chainIdHex) || Number(BigInt(chainIdHex)) !== XLAYER_CHAIN_ID) throw new Error(`execution RPC must be X Layer chain ${XLAYER_CHAIN_ID}`);
  const entryPointCode = await rpc.request<unknown>("eth_getCode", [options.entryPoint, "latest"]);
  if (!isHex(entryPointCode) || entryPointCode === "0x") throw new Error("configured EntryPoint has no deployed bytecode");
  const [factoryCode, implementationCode] = await Promise.all([
    rpc.request<unknown>("eth_getCode", [options.factory, "latest"]),
    rpc.request<unknown>("eth_getCode", [options.implementation, "latest"]),
  ]);
  if (!isHex(factoryCode) || factoryCode === "0x") throw new Error("configured OKX factory has no deployed bytecode");
  if (!isHex(implementationCode) || implementationCode === "0x") throw new Error("configured OKX implementation has no deployed bytecode");

  const keyHash = okxOwnerKeyHash(options.signer.address);
  const initialOwners: InitialOwner[] = [{ keyHash, validator: OKX_ECDSA_VALIDATOR }];
  const getAddressData = encodeFunctionData({ abi: FACTORY_ABI, functionName: "getAddress", args: [initialOwners, options.salt] });
  const account = decodeAddress(await ethCall(rpc, options.factory, getAddressData), "counterfactual account");
  const accountCode = await rpc.request<unknown>("eth_getCode", [account, "latest"]);
  if (!isHex(accountCode)) throw new Error("execution RPC returned invalid account bytecode");
  const deployed = accountCode !== "0x";
  const initCode = deployed ? "0x" as Hex : encodeOkxFactoryInitCode(options.factory, initialOwners, options.salt);
  const nonce = options.nonce ?? decodeUint256(await ethCall(rpc, options.entryPoint, encodeFunctionData({
    abi: ENTRYPOINT_ABI,
    functionName: "getNonce",
    args: [account, nonceKey],
  })), "EntryPoint nonce");
  const callData = encodeOkxExitExecution(options.calls);
  const placeholderPaymasterData = options.paymaster.authorization ? `0x${"00".repeat(141)}` as Hex : options.paymaster.data!;
  let paymasterAndData = packPaymasterAndData(options.paymaster.address, options.paymaster.verificationGasLimit, options.paymaster.postOpGasLimit, placeholderPaymasterData);
  let unsignedOperation: PackedUserOperation = {
    sender: account,
    nonce,
    initCode,
    callData,
    accountGasLimits: packAccountGasLimits(options.gas.verificationGasLimit, options.gas.callGasLimit),
    preVerificationGas: options.gas.preVerificationGas,
    gasFees: packGasFees(options.gas.maxPriorityFeePerGas, options.gas.maxFeePerGas),
    paymasterAndData,
    signature: "0x",
  };
  let exitPaymasterDigest: Hex | undefined;
  let exitPaymasterSignature: Hex | undefined;
  if (options.paymaster.authorization) {
    const authorization: ExitPaymasterAuthorization = {
      entryPoint: options.entryPoint,
      paymaster: options.paymaster.address,
      actionHash: options.paymaster.authorization.actionHash,
      maxCost: options.paymaster.authorization.maxCost,
      paymasterVerificationGasLimit: options.paymaster.verificationGasLimit,
      paymasterPostOpGasLimit: options.paymaster.postOpGasLimit,
      validAfter: options.paymaster.authorization.validAfter,
      validUntil: options.paymaster.authorization.validUntil,
      sponsorNonce: options.paymaster.authorization.sponsorNonce,
    };
    const sponsorship = await signExitPaymasterAuthorization(unsignedOperation, authorization, options.paymaster.authorization.signer);
    exitPaymasterDigest = sponsorship.digest;
    exitPaymasterSignature = sponsorship.signature;
    paymasterAndData = sponsorship.paymasterAndData;
    unsignedOperation = { ...unsignedOperation, paymasterAndData };
  }
  toRpcUserOperation(unsignedOperation);
  const hashCallData = encodeFunctionData({
    abi: ENTRYPOINT_ABI,
    functionName: "getUserOpHash",
    args: [{
      sender: unsignedOperation.sender,
      nonce: unsignedOperation.nonce,
      initCode: unsignedOperation.initCode,
      callData: unsignedOperation.callData,
      accountGasLimits: unsignedOperation.accountGasLimits,
      preVerificationGas: unsignedOperation.preVerificationGas,
      gasFees: unsignedOperation.gasFees,
      paymasterAndData: unsignedOperation.paymasterAndData,
      signature: unsignedOperation.signature,
    }],
  });
  const userOpHash = decodeAbiParameters([{ type: "bytes32" }], await ethCall(rpc, options.entryPoint, hashCallData))[0] as Hex;
  const validUntil = options.validUntil ?? 0n;
  const ownerSigningDigest = okxOwnerSigningDigest(userOpHash, validUntil, options.implementation);
  const rawSignature = await options.signer.signMessage({ message: { raw: ownerMessagePrehash(userOpHash, validUntil, options.implementation) } });
  const recoveredOwner = await recoverAddress({ hash: ownerSigningDigest, signature: rawSignature });
  if (recoveredOwner.toLowerCase() !== options.signer.address.toLowerCase()) throw new Error("owner signer returned a signature for a different address");
  const signature = encodeOkxOwnerSignature(keyHash, validUntil, rawSignature);
  const userOperation: PackedUserOperation = { ...unsignedOperation, signature };
  const rpcUserOperation = toRpcUserOperation(userOperation);
  if (fromRpcUserOperation(rpcUserOperation).signature !== signature) throw new Error("signed UserOperation failed v0.7 codec round-trip");
  return {
    account,
    deployed,
    owner: options.signer.address,
    keyHash,
    validUntil,
    ownerMessageHash: ownerSigningDigest,
    userOpHash,
    userOperation,
    rpcUserOperation,
    exitPaymasterDigest,
    exitPaymasterSignature,
  };
}
