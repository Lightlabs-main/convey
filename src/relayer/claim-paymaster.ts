import {
  encodeAbiParameters,
  encodePacked,
  keccak256,
  stringToBytes,
} from "viem";
import type { Address, Hex, PackedUserOperation } from "./types.ts";
import { assertAddress, assertHex, packPaymasterAndData } from "./types.ts";

export const CLAIM_PAYMASTER_DATA_LENGTH = 141;
export const CLAIM_PAYMASTER_NAME = "ConveyClaimPaymaster";
export const CLAIM_PAYMASTER_VERSION = "1";

const EIP712_DOMAIN_TYPEHASH = keccak256(stringToBytes(
  "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
));
const NAME_HASH = keccak256(stringToBytes(CLAIM_PAYMASTER_NAME));
const VERSION_HASH = keccak256(stringToBytes(CLAIM_PAYMASTER_VERSION));
const AUTHORIZATION_TYPEHASH = keccak256(stringToBytes(
  "ClaimAuthorization(address entryPoint,address paymaster,bytes32 accountOperationHash,uint256 giftId,uint256 maxCost,uint128 paymasterVerificationGasLimit,uint128 paymasterPostOpGasLimit,uint48 validAfter,uint48 validUntil,uint256 sponsorNonce)",
));

export interface ClaimPaymasterSponsorSigner {
  address: Address;
  sign(parameters: { hash: Hex }): Promise<Hex>;
}

export interface ClaimPaymasterAuthorization {
  entryPoint: Address;
  paymaster: Address;
  giftId: bigint;
  maxCost: bigint;
  paymasterVerificationGasLimit: bigint;
  paymasterPostOpGasLimit: bigint;
  validAfter: bigint;
  validUntil: bigint;
  sponsorNonce: bigint;
}

function assertUint(value: bigint, bits: number, name: string): void {
  if (typeof value !== "bigint" || value < 0n || value >= (1n << BigInt(bits))) {
    throw new Error(`${name} must fit uint${bits}`);
  }
}

function assertBytes32(value: Hex, name: string): void {
  assertHex(value, name);
  if (value.length !== 66) throw new Error(`${name} must be bytes32`);
}

function assertSignature(signature: Hex): void {
  assertHex(signature, "sponsor signature");
  if (signature.length !== 132) throw new Error("sponsor signature must be 65 bytes");
}

/**
 * Hashes only the operation fields covered by Convey's claim authorization.
 * The paymaster data is excluded because it contains the authorization
 * signature itself; including it would make signing circular.
 */
export function claimPaymasterOperationFieldsHash(operation: PackedUserOperation): Hex {
  assertAddress(operation.sender, "userOperation.sender");
  assertHex(operation.initCode, "userOperation.initCode");
  assertHex(operation.callData, "userOperation.callData");
  assertHex(operation.accountGasLimits, "userOperation.accountGasLimits");
  assertHex(operation.gasFees, "userOperation.gasFees");
  assertUint(operation.nonce, 256, "userOperation.nonce");
  assertUint(operation.preVerificationGas, 256, "userOperation.preVerificationGas");
  assertBytes32(operation.accountGasLimits, "userOperation.accountGasLimits");
  assertBytes32(operation.gasFees, "userOperation.gasFees");
  return keccak256(encodeAbiParameters(
    [
      { type: "address" },
      { type: "uint256" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "uint256" },
      { type: "bytes32" },
    ],
    [
      operation.sender,
      operation.nonce,
      keccak256(operation.initCode),
      keccak256(operation.callData),
      operation.accountGasLimits,
      operation.preVerificationGas,
      operation.gasFees,
    ],
  )) as Hex;
}

export function claimPaymasterDomainSeparator(paymaster: Address): Hex {
  assertAddress(paymaster, "paymaster");
  return keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
    [EIP712_DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, 196n, paymaster],
  )) as Hex;
}

export function claimPaymasterAuthorizationDigest(
  operation: PackedUserOperation,
  authorization: ClaimPaymasterAuthorization,
): Hex {
  assertAddress(authorization.entryPoint, "entryPoint");
  assertAddress(authorization.paymaster, "paymaster");
  assertUint(authorization.giftId, 256, "giftId");
  assertUint(authorization.maxCost, 256, "maxCost");
  if (authorization.maxCost === 0n) throw new Error("maxCost must be greater than zero");
  assertUint(authorization.paymasterVerificationGasLimit, 128, "paymasterVerificationGasLimit");
  assertUint(authorization.paymasterPostOpGasLimit, 128, "paymasterPostOpGasLimit");
  assertUint(authorization.validAfter, 48, "validAfter");
  assertUint(authorization.validUntil, 48, "validUntil");
  if (authorization.validUntil <= authorization.validAfter) throw new Error("validUntil must be after validAfter");
  if (authorization.validUntil - authorization.validAfter > 300n) throw new Error("authorization window exceeds 300 seconds");
  assertUint(authorization.sponsorNonce, 256, "sponsorNonce");

  const operationFieldsHash = claimPaymasterOperationFieldsHash(operation);
  const structHash = keccak256(encodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "address" },
      { type: "address" },
      { type: "bytes32" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint128" },
      { type: "uint128" },
      { type: "uint48" },
      { type: "uint48" },
      { type: "uint256" },
    ],
    [
      AUTHORIZATION_TYPEHASH,
      authorization.entryPoint,
      authorization.paymaster,
      operationFieldsHash,
      authorization.giftId,
      authorization.maxCost,
      authorization.paymasterVerificationGasLimit,
      authorization.paymasterPostOpGasLimit,
      Number(authorization.validAfter),
      Number(authorization.validUntil),
      authorization.sponsorNonce,
    ],
  ));
  return keccak256(`0x1901${claimPaymasterDomainSeparator(authorization.paymaster).slice(2)}${structHash.slice(2)}`) as Hex;
}

export function encodeClaimPaymasterData(
  authorization: ClaimPaymasterAuthorization,
  signature: Hex,
): Hex {
  assertSignature(signature);
  assertUint(authorization.giftId, 256, "giftId");
  assertUint(authorization.validAfter, 48, "validAfter");
  assertUint(authorization.validUntil, 48, "validUntil");
  assertUint(authorization.sponsorNonce, 256, "sponsorNonce");
  const data = encodePacked(
    ["uint256", "uint48", "uint48", "uint256", "bytes"],
    [authorization.giftId, Number(authorization.validAfter), Number(authorization.validUntil), authorization.sponsorNonce, signature],
  ) as Hex;
  if ((data.length - 2) / 2 !== CLAIM_PAYMASTER_DATA_LENGTH) throw new Error("encoded claim paymaster data has the wrong length");
  return data;
}

export function encodeClaimPaymasterAndData(
  authorization: ClaimPaymasterAuthorization,
  signature: Hex,
): Hex {
  return packPaymasterAndData(
    authorization.paymaster,
    authorization.paymasterVerificationGasLimit,
    authorization.paymasterPostOpGasLimit,
    encodeClaimPaymasterData(authorization, signature),
  );
}

export async function signClaimPaymasterAuthorization(
  operation: PackedUserOperation,
  authorization: ClaimPaymasterAuthorization,
  signer: ClaimPaymasterSponsorSigner,
): Promise<{ digest: Hex; signature: Hex; paymasterAndData: Hex }> {
  assertAddress(signer.address, "sponsor signer address");
  const digest = claimPaymasterAuthorizationDigest(operation, authorization);
  const signature = await signer.sign({ hash: digest });
  assertSignature(signature);
  return { digest, signature, paymasterAndData: encodeClaimPaymasterAndData(authorization, signature) };
}
