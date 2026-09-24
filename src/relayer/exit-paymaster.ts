import { encodeAbiParameters, encodePacked, keccak256, stringToBytes } from "viem";
import type { Address, Hex, PackedUserOperation } from "./types.ts";
import { assertAddress, assertHex, packPaymasterAndData } from "./types.ts";
import { paymasterOperationFieldsHash } from "./claim-paymaster.ts";

export const EXIT_PAYMASTER_DATA_LENGTH = 141;
export const EXIT_PAYMASTER_NAME = "ConveyExitPaymaster";
export const EXIT_PAYMASTER_VERSION = "1";

const EIP712_DOMAIN_TYPEHASH = keccak256(stringToBytes(
  "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
));
const NAME_HASH = keccak256(stringToBytes(EXIT_PAYMASTER_NAME));
const VERSION_HASH = keccak256(stringToBytes(EXIT_PAYMASTER_VERSION));
const AUTHORIZATION_TYPEHASH = keccak256(stringToBytes(
  "ExitAuthorization(address entryPoint,address paymaster,bytes32 accountOperationHash,bytes32 actionHash,uint256 maxCost,uint128 paymasterVerificationGasLimit,uint128 paymasterPostOpGasLimit,uint48 validAfter,uint48 validUntil,uint256 sponsorNonce)",
));

export interface ExitPaymasterSponsorSigner {
  address: Address;
  sign(parameters: { hash: Hex }): Promise<Hex>;
}

export interface ExitPaymasterAuthorization {
  entryPoint: Address;
  paymaster: Address;
  actionHash: Hex;
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

export function exitPaymasterDomainSeparator(paymaster: Address): Hex {
  assertAddress(paymaster, "paymaster");
  return keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
    [EIP712_DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, 196n, paymaster],
  )) as Hex;
}

export function exitPaymasterActionHash(callData: Hex): Hex {
  assertHex(callData, "exit callData");
  return keccak256(callData) as Hex;
}

export function exitPaymasterAuthorizationDigest(
  operation: PackedUserOperation,
  authorization: ExitPaymasterAuthorization,
): Hex {
  assertAddress(authorization.entryPoint, "entryPoint");
  assertAddress(authorization.paymaster, "paymaster");
  assertBytes32(authorization.actionHash, "actionHash");
  assertUint(authorization.maxCost, 256, "maxCost");
  if (authorization.maxCost === 0n) throw new Error("maxCost must be greater than zero");
  assertUint(authorization.paymasterVerificationGasLimit, 128, "paymasterVerificationGasLimit");
  assertUint(authorization.paymasterPostOpGasLimit, 128, "paymasterPostOpGasLimit");
  assertUint(authorization.validAfter, 48, "validAfter");
  assertUint(authorization.validUntil, 48, "validUntil");
  if (authorization.validUntil <= authorization.validAfter) throw new Error("validUntil must be after validAfter");
  if (authorization.validUntil - authorization.validAfter > 300n) throw new Error("authorization window exceeds 300 seconds");
  assertUint(authorization.sponsorNonce, 256, "sponsorNonce");
  const operationFieldsHash = paymasterOperationFieldsHash(operation);
  const structHash = keccak256(encodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "address" },
      { type: "address" },
      { type: "bytes32" },
      { type: "bytes32" },
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
      authorization.actionHash,
      authorization.maxCost,
      authorization.paymasterVerificationGasLimit,
      authorization.paymasterPostOpGasLimit,
      Number(authorization.validAfter),
      Number(authorization.validUntil),
      authorization.sponsorNonce,
    ],
  ));
  return keccak256(`0x1901${exitPaymasterDomainSeparator(authorization.paymaster).slice(2)}${structHash.slice(2)}` as Hex) as Hex;
}

export function encodeExitPaymasterData(
  authorization: ExitPaymasterAuthorization,
  signature: Hex,
): Hex {
  assertSignature(signature);
  assertBytes32(authorization.actionHash, "actionHash");
  assertUint(authorization.validAfter, 48, "validAfter");
  assertUint(authorization.validUntil, 48, "validUntil");
  assertUint(authorization.sponsorNonce, 256, "sponsorNonce");
  const data = encodePacked(
    ["bytes32", "uint48", "uint48", "uint256", "bytes"],
    [authorization.actionHash, Number(authorization.validAfter), Number(authorization.validUntil), authorization.sponsorNonce, signature],
  ) as Hex;
  if ((data.length - 2) / 2 !== EXIT_PAYMASTER_DATA_LENGTH) throw new Error("encoded exit paymaster data has the wrong length");
  return data;
}

export function encodeExitPaymasterAndData(
  authorization: ExitPaymasterAuthorization,
  signature: Hex,
): Hex {
  return packPaymasterAndData(
    authorization.paymaster,
    authorization.paymasterVerificationGasLimit,
    authorization.paymasterPostOpGasLimit,
    encodeExitPaymasterData(authorization, signature),
  );
}

export async function signExitPaymasterAuthorization(
  operation: PackedUserOperation,
  authorization: ExitPaymasterAuthorization,
  signer: ExitPaymasterSponsorSigner,
): Promise<{ digest: Hex; signature: Hex; paymasterAndData: Hex }> {
  assertAddress(signer.address, "sponsor signer address");
  const digest = exitPaymasterAuthorizationDigest(operation, authorization);
  const signature = await signer.sign({ hash: digest });
  assertSignature(signature);
  return { digest, signature, paymasterAndData: encodeExitPaymasterAndData(authorization, signature) };
}
