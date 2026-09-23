import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";
import { createPublicClient, encodeAbiParameters, encodePacked, http, keccak256, recoverAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { encodeOkxClaimExecution } from "../src/relayer/claim-policy.ts";
import {
  encodeOkxFactoryInitCode,
  encodeOkxOwnerSignature,
  okxOwnerKeyHash,
  okxOwnerSigningDigest,
  OKX_ECDSA_VALIDATOR,
} from "../src/relayer/okx.ts";
import {
  packAccountGasLimits,
  packGasFees,
  packPaymasterAndData,
  toRpcUserOperation,
  type PackedUserOperation,
} from "../src/relayer/types.ts";

const CHAIN_ID = 196;
const ENTRY_POINT = "0x0000000071727de22e5e9d8baf0edac6f37da032" as Address;
const OKX_SMART_WALLET_FACTORY = "0xdd3fea01cd550c9effc893f346690b9a649f35ef" as Address;
const OKX_SMART_WALLET_IMPLEMENTATION = "0xe40ccb2d94975c51bff0c004efdfd9b3a5796fa4" as Address;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const ZERO = "0x" as Hex;

const factoryAbi = [
  {
    type: "function",
    name: "getAddress",
    stateMutability: "view",
    inputs: [
      { name: "initialOwners", type: "tuple[]", components: [
        { name: "keyHash", type: "bytes32" }, { name: "validator", type: "address" },
      ] },
      { name: "salt", type: "uint256" },
    ],
    outputs: [{ name: "account", type: "address" }],
  },
] as const;

const implementationAbi = [{
  type: "function",
  name: "entryPoint",
  stateMutability: "view",
  inputs: [],
  outputs: [{ name: "", type: "address" }],
}] as const;

const entryPointAbi = [
  {
    type: "function", name: "getNonce", stateMutability: "view",
    inputs: [{ name: "sender", type: "address" }, { name: "key", type: "uint192" }],
    outputs: [{ name: "nonce", type: "uint256" }],
  },
  {
    type: "function", name: "getUserOpHash", stateMutability: "view",
    inputs: [{ name: "userOp", type: "tuple", components: [
      { name: "sender", type: "address" }, { name: "nonce", type: "uint256" },
      { name: "initCode", type: "bytes" }, { name: "callData", type: "bytes" },
      { name: "accountGasLimits", type: "bytes32" }, { name: "preVerificationGas", type: "uint256" },
      { name: "gasFees", type: "bytes32" }, { name: "paymasterAndData", type: "bytes" },
      { name: "signature", type: "bytes" },
    ] }],
    outputs: [{ name: "userOpHash", type: "bytes32" }],
  },
  {
    type: "function", name: "getDepositInfo", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "info", type: "tuple", components: [
      { name: "deposit", type: "uint256" }, { name: "staked", type: "bool" },
      { name: "stake", type: "uint112" }, { name: "unstakeDelaySec", type: "uint32" },
      { name: "withdrawTime", type: "uint48" },
    ] }],
  },
] as const;

const paymasterAbi = [
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "bootstrapSender", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "expectedInitCodeHash", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "expectedCallDataHash", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "expectedSponsorNonce", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "expectedPaymasterVerificationGasLimit", stateMutability: "view", inputs: [], outputs: [{ type: "uint128" }] },
  { type: "function", name: "maxCostCap", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "verifyingSigner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "authorizationConsumed", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  {
    type: "function", name: "sponsorDigest", stateMutability: "view",
    inputs: [
      { name: "userOp", type: "tuple", components: [
        { name: "sender", type: "address" }, { name: "nonce", type: "uint256" },
        { name: "initCode", type: "bytes" }, { name: "callData", type: "bytes" },
        { name: "accountGasLimits", type: "bytes32" }, { name: "preVerificationGas", type: "uint256" },
        { name: "gasFees", type: "bytes32" }, { name: "paymasterAndData", type: "bytes" },
        { name: "signature", type: "bytes" },
      ] },
      { name: "maxCost", type: "uint256" },
      { name: "validAfter", type: "uint48" },
      { name: "validUntil", type: "uint48" },
      { name: "sponsorNonce", type: "uint256" },
    ],
    outputs: [{ name: "digest", type: "bytes32" }],
  },
] as const;

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

function privateKey(name: string): Hex {
  const value = required(name);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${name} must be a 32-byte private key`);
  return value as Hex;
}

function uint(name: string, bits = 256): bigint {
  let value: bigint;
  try {
    value = BigInt(required(name));
  } catch {
    throw new Error(`${name} must be an integer in base 10 or 0x form`);
  }
  if (value <= 0n || value >= (1n << BigInt(bits))) {
    throw new Error(`${name} must be positive and fit uint${bits}`);
  }
  return value;
}

const rpcUrl = required("XLAYER_RPC_URL");
const entryPoint = address("ENTRYPOINT_ADDRESS");
const factory = address("OKX_SMART_WALLET_FACTORY");
const implementation = address("OKX_SMART_WALLET_IMPLEMENTATION");
const paymaster = address("BOOTSTRAP_PAYMASTER_ADDRESS");
if (entryPoint.toLowerCase() !== ENTRY_POINT.toLowerCase()) {
  throw new Error(`ENTRYPOINT_ADDRESS must be v0.7 ${ENTRY_POINT}`);
}
if (factory.toLowerCase() !== OKX_SMART_WALLET_FACTORY.toLowerCase()) {
  throw new Error(`OKX_SMART_WALLET_FACTORY must be the verified X Layer factory ${OKX_SMART_WALLET_FACTORY}`);
}
if (implementation.toLowerCase() !== OKX_SMART_WALLET_IMPLEMENTATION.toLowerCase()) {
  throw new Error(`OKX_SMART_WALLET_IMPLEMENTATION must be the verified X Layer implementation ${OKX_SMART_WALLET_IMPLEMENTATION}`);
}

const receiverOwner = privateKeyToAccount(privateKey("SMART_ACCOUNT_OWNER_PRIVATE_KEY"));
const sponsorSigner = privateKeyToAccount(privateKey("BOOTSTRAP_PAYMASTER_SIGNER_PRIVATE_KEY"));
if (receiverOwner.address.toLowerCase() === sponsorSigner.address.toLowerCase()) {
  throw new Error("BOOTSTRAP_PAYMASTER_SIGNER_PRIVATE_KEY must be separate from SMART_ACCOUNT_OWNER_PRIVATE_KEY");
}
const gas = {
  accountVerificationGasLimit: uint("BOOTSTRAP_ACCOUNT_VERIFICATION_GAS_LIMIT", 128),
  callGasLimit: uint("BOOTSTRAP_CALL_GAS_LIMIT", 128),
  preVerificationGas: uint("BOOTSTRAP_PRE_VERIFICATION_GAS", 120),
  maxFeePerGas: uint("BOOTSTRAP_MAX_FEE_PER_GAS_WEI", 120),
  maxPriorityFeePerGas: uint("BOOTSTRAP_MAX_PRIORITY_FEE_PER_GAS_WEI", 120),
};
if (gas.maxPriorityFeePerGas > gas.maxFeePerGas) {
  throw new Error("BOOTSTRAP_MAX_PRIORITY_FEE_PER_GAS_WEI cannot exceed BOOTSTRAP_MAX_FEE_PER_GAS_WEI");
}

const chain = {
  id: CHAIN_ID,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
} as const;
const client = createPublicClient({ chain, transport: http(rpcUrl) });
const [chainId, entryPointCode, factoryCode, implementationCode, implementationEntryPoint] = await Promise.all([
  client.getChainId(),
  client.getCode({ address: ENTRY_POINT }),
  client.getCode({ address: factory }),
  client.getCode({ address: implementation }),
  client.readContract({ address: implementation, abi: implementationAbi, functionName: "entryPoint" }),
]);
if (chainId !== CHAIN_ID) throw new Error(`execution RPC returned chain ${chainId}, expected ${CHAIN_ID}`);
if (!entryPointCode || entryPointCode === "0x") throw new Error("v0.7 EntryPoint has no bytecode");
if (!factoryCode || factoryCode === "0x") throw new Error("OKX factory has no bytecode");
if (!implementationCode || implementationCode === "0x") throw new Error("OKX implementation has no bytecode");
if (implementationEntryPoint.toLowerCase() !== ENTRY_POINT.toLowerCase()) {
  throw new Error(`OKX Smart Wallet implementation uses unexpected EntryPoint ${implementationEntryPoint}`);
}

const keyHash = okxOwnerKeyHash(receiverOwner.address);
const owners = [{ keyHash, validator: OKX_ECDSA_VALIDATOR }];
const bootstrapSender = await client.readContract({
  address: factory,
  abi: factoryAbi,
  functionName: "getAddress",
  args: [owners, 0n],
});
const senderCode = await client.getCode({ address: bootstrapSender });
if (senderCode && senderCode !== "0x") {
  throw new Error("bootstrap operation requires an undeployed counterfactual account");
}
const initCode = encodeOkxFactoryInitCode(factory, owners, 0n);
const callData = encodeOkxClaimExecution([{ target: ZERO_ADDRESS, value: 0n, data: ZERO }]);

const [configuredOwner, configuredSender, expectedInitCodeHash, expectedCallDataHash, sponsorNonce,
  paymasterVerificationGasLimit, maxCostCap, configuredSigner, authorizationConsumed,
  depositInfo, latestBlock, nonce] = await Promise.all([
  client.readContract({ address: paymaster, abi: paymasterAbi, functionName: "owner" }),
  client.readContract({ address: paymaster, abi: paymasterAbi, functionName: "bootstrapSender" }),
  client.readContract({ address: paymaster, abi: paymasterAbi, functionName: "expectedInitCodeHash" }),
  client.readContract({ address: paymaster, abi: paymasterAbi, functionName: "expectedCallDataHash" }),
  client.readContract({ address: paymaster, abi: paymasterAbi, functionName: "expectedSponsorNonce" }),
  client.readContract({ address: paymaster, abi: paymasterAbi, functionName: "expectedPaymasterVerificationGasLimit" }),
  client.readContract({ address: paymaster, abi: paymasterAbi, functionName: "maxCostCap" }),
  client.readContract({ address: paymaster, abi: paymasterAbi, functionName: "verifyingSigner" }),
  client.readContract({ address: paymaster, abi: paymasterAbi, functionName: "authorizationConsumed" }),
  client.readContract({ address: ENTRY_POINT, abi: entryPointAbi, functionName: "getDepositInfo", args: [paymaster] }),
  client.getBlock({ blockTag: "latest" }),
  client.readContract({ address: ENTRY_POINT, abi: entryPointAbi, functionName: "getNonce", args: [bootstrapSender, 0n] }),
]);

if (configuredOwner.toLowerCase() === receiverOwner.address.toLowerCase()) {
  throw new Error("deployed paymaster owner and SMART_ACCOUNT_OWNER_PRIVATE_KEY must be separate");
}
if (configuredOwner.toLowerCase() === sponsorSigner.address.toLowerCase()) {
  throw new Error("deployed paymaster owner and BOOTSTRAP_PAYMASTER_SIGNER_PRIVATE_KEY must be separate");
}
if (configuredSender.toLowerCase() !== bootstrapSender.toLowerCase()) {
  throw new Error("deployed paymaster is configured for a different receiver account");
}
if (expectedInitCodeHash.toLowerCase() !== keccak256(initCode).toLowerCase()) {
  throw new Error("deployed paymaster is configured for different OKX factory init code");
}
if (expectedCallDataHash.toLowerCase() !== keccak256(callData).toLowerCase()) {
  throw new Error("deployed paymaster harmless-call hash does not match this OKX call encoding");
}
if (configuredSigner.toLowerCase() !== sponsorSigner.address.toLowerCase()) {
  throw new Error("BOOTSTRAP_PAYMASTER_SIGNER_PRIVATE_KEY does not match the deployed paymaster signer");
}
if (authorizationConsumed) throw new Error("bootstrap authorization has already been consumed");

const minStake = uint("PAYMASTER_MIN_STAKE_WEI");
if (!depositInfo.staked || depositInfo.stake < minStake) {
  throw new Error("bootstrap paymaster is not staked at PAYMASTER_MIN_STAKE_WEI");
}
const requiredGas = gas.accountVerificationGasLimit
  + gas.callGasLimit
  + gas.preVerificationGas
  + BigInt(paymasterVerificationGasLimit);
const entryPointGasMax = (1n << 120n) - 1n;
if (
  gas.accountVerificationGasLimit > entryPointGasMax
  || gas.callGasLimit > entryPointGasMax
  || gas.preVerificationGas > entryPointGasMax
  || gas.maxFeePerGas > entryPointGasMax
  || gas.maxPriorityFeePerGas > entryPointGasMax
  || BigInt(paymasterVerificationGasLimit) > entryPointGasMax
) {
  throw new Error("ERC-4337 v0.7 gas and fee values must not exceed uint120");
}
const maxCost = requiredGas * gas.maxFeePerGas;
if (maxCost === 0n || maxCost > maxCostCap) {
  throw new Error("bootstrap operation maxCost is zero or exceeds the deployed cap");
}
if (depositInfo.deposit < maxCost) throw new Error("bootstrap paymaster EntryPoint deposit is below maxCost");

const validAfter = latestBlock.timestamp > 5n ? latestBlock.timestamp - 5n : 0n;
// The paymaster permits a maximum 300-second authorization window. Keep the
// five-second clock-skew allowance above and use the remaining window so a
// bundle can survive RPC and block-inclusion delay on the private relayer.
const validUntil = latestBlock.timestamp + 295n;
const packed: PackedUserOperation = {
  sender: bootstrapSender,
  nonce,
  initCode,
  callData,
  accountGasLimits: packAccountGasLimits(gas.accountVerificationGasLimit, gas.callGasLimit),
  preVerificationGas: gas.preVerificationGas,
  gasFees: packGasFees(gas.maxPriorityFeePerGas, gas.maxFeePerGas),
  paymasterAndData: packPaymasterAndData(
    paymaster,
    BigInt(paymasterVerificationGasLimit),
    0n,
    encodePacked(
      ["uint48", "uint48", "uint256", "bytes"],
      [validAfter, validUntil, BigInt(sponsorNonce), `0x${"00".repeat(65)}`],
    ),
  ),
  signature: ZERO,
};

const sponsorDigest = await client.readContract({
  address: paymaster,
  abi: paymasterAbi,
  functionName: "sponsorDigest",
  args: [packed, maxCost, validAfter, validUntil, BigInt(sponsorNonce)],
});
const sponsorSignature = await sponsorSigner.sign({ hash: sponsorDigest });
packed.paymasterAndData = packPaymasterAndData(
  paymaster,
  BigInt(paymasterVerificationGasLimit),
  0n,
  encodePacked(
    ["uint48", "uint48", "uint256", "bytes"],
    [validAfter, validUntil, BigInt(sponsorNonce), sponsorSignature],
  ),
);

const userOpHash = await client.readContract({
  address: ENTRY_POINT,
  abi: entryPointAbi,
  functionName: "getUserOpHash",
  args: [packed],
});
const ownerPrehash = keccak256(encodeAbiParameters(
  [{ type: "bytes32" }, { type: "uint48" }, { type: "address" }],
  [userOpHash, 0n, implementation],
));
const ownerSigningDigest = okxOwnerSigningDigest(userOpHash, 0n, implementation);
const ownerSignature = await receiverOwner.signMessage({ message: { raw: ownerPrehash } });
const recoveredOwner = await recoverAddress({ hash: ownerSigningDigest, signature: ownerSignature });
if (recoveredOwner.toLowerCase() !== receiverOwner.address.toLowerCase()) {
  throw new Error("OKX owner signature did not recover the configured receiver key");
}
packed.signature = encodeOkxOwnerSignature(keyHash, 0n, ownerSignature);

const operationPath = process.env.BOOTSTRAP_OPERATION_FILE?.trim()
  || "/tmp/convey-bootstrap-operation.json";
const record = {
  chainId: CHAIN_ID,
  entryPoint: ENTRY_POINT,
  paymaster,
  userOpHash,
  maxCostWei: maxCost.toString(),
  validAfter: validAfter.toString(),
  validUntil: validUntil.toString(),
  userOperation: toRpcUserOperation(packed),
};
const operationHandle = await open(
  operationPath,
  fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_NOFOLLOW,
  0o600,
);
try {
  await operationHandle.chmod(0o600);
  await operationHandle.truncate(0);
  await operationHandle.writeFile(`${JSON.stringify(record, null, 2)}\n`, "utf8");
  await operationHandle.sync();
} finally {
  await operationHandle.close();
}
console.log(JSON.stringify({
  chainId: CHAIN_ID,
  userOpHash,
  paymaster,
  bootstrapSender,
  maxCostWei: maxCost.toString(),
  authorizationValidUntil: validUntil.toString(),
  operationFile: operationPath,
}, null, 2));
