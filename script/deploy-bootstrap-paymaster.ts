import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const CHAIN_ID = 196;
const ENTRY_POINT_V07 = "0x0000000071727de22e5e9d8baf0edac6f37da032" as Address;
const OKX_SMART_WALLET_FACTORY = "0xdd3fea01cd550c9effc893f346690b9a649f35ef" as Address;
const OKX_SMART_WALLET_IMPLEMENTATION = "0xe40ccb2d94975c51bff0c004efdfd9b3a5796fa4" as Address;
const OKX_ECDSA_VALIDATOR = "0x0000000000000000000000000000000000000001" as Address;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function privateKey(name: string): Hex {
  const value = required(name);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${name} must be a 32-byte private key`);
  return value as Hex;
}

function address(name: string): Address {
  const value = required(name);
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${name} must be a 20-byte address`);
  return value as Address;
}

function uint(name: string, maxBits = 256): bigint {
  let value: bigint;
  try {
    value = BigInt(required(name));
  } catch {
    throw new Error(`${name} must be an integer in base 10 or 0x form`);
  }
  if (value < 0n || value >= (1n << BigInt(maxBits))) {
    throw new Error(`${name} must fit uint${maxBits}`);
  }
  return value;
}

const rpcUrl = required("XLAYER_RPC_URL");
const factory = address("OKX_SMART_WALLET_FACTORY");
const implementation = address("OKX_SMART_WALLET_IMPLEMENTATION");
if (factory.toLowerCase() !== OKX_SMART_WALLET_FACTORY.toLowerCase()) {
  throw new Error(`OKX_SMART_WALLET_FACTORY must be the verified X Layer factory ${OKX_SMART_WALLET_FACTORY}`);
}
if (implementation.toLowerCase() !== OKX_SMART_WALLET_IMPLEMENTATION.toLowerCase()) {
  throw new Error(`OKX_SMART_WALLET_IMPLEMENTATION must be the verified X Layer implementation ${OKX_SMART_WALLET_IMPLEMENTATION}`);
}
const configuredEntryPoint = address("ENTRYPOINT_ADDRESS");
if (configuredEntryPoint.toLowerCase() !== ENTRY_POINT_V07.toLowerCase()) {
  throw new Error(`ENTRYPOINT_ADDRESS must be v0.7 ${ENTRY_POINT_V07}`);
}

const deployer = privateKeyToAccount(privateKey("DEPLOYER_PRIVATE_KEY"));
const receiverOwner = privateKeyToAccount(privateKey("SMART_ACCOUNT_OWNER_PRIVATE_KEY"));
const sponsorSigner = privateKeyToAccount(privateKey("BOOTSTRAP_PAYMASTER_SIGNER_PRIVATE_KEY"));
const signer = sponsorSigner.address;
const receiverOwnerAddress = receiverOwner.address.toLowerCase();
const deployerAddress = deployer.address.toLowerCase();
const signerAddress = signer.toLowerCase();
if (deployerAddress === signerAddress) {
  throw new Error("DEPLOYER_PRIVATE_KEY and BOOTSTRAP_PAYMASTER_SIGNER_PRIVATE_KEY must be different");
}
if (deployerAddress === receiverOwnerAddress) {
  throw new Error("DEPLOYER_PRIVATE_KEY must be separate from SMART_ACCOUNT_OWNER_PRIVATE_KEY");
}
if (signerAddress === receiverOwnerAddress) {
  throw new Error("BOOTSTRAP_PAYMASTER_SIGNER_PRIVATE_KEY must be separate from SMART_ACCOUNT_OWNER_PRIVATE_KEY");
}

const sponsorNonce = uint("BOOTSTRAP_SPONSOR_NONCE");
const paymasterVerificationGasLimit = uint("BOOTSTRAP_PAYMASTER_VERIFICATION_GAS_LIMIT", 128);
const maxCostCap = uint("BOOTSTRAP_MAX_COST_CAP_WEI");
if (paymasterVerificationGasLimit === 0n || maxCostCap === 0n) {
  throw new Error("bootstrap paymaster gas limit and max cost cap must be greater than zero");
}
if (paymasterVerificationGasLimit > ((1n << 120n) - 1n)) {
  throw new Error("BOOTSTRAP_PAYMASTER_VERIFICATION_GAS_LIMIT must not exceed uint120");
}

const chain = {
  id: CHAIN_ID,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
} as const;
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account: deployer, chain, transport: http(rpcUrl) });

const configuredPaymaster = process.env.BOOTSTRAP_PAYMASTER_ADDRESS?.trim();
if (configuredPaymaster) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(configuredPaymaster)) {
    throw new Error("BOOTSTRAP_PAYMASTER_ADDRESS must be a 20-byte address");
  }
  const configuredPaymasterCode = await publicClient.getCode({ address: configuredPaymaster as Address });
  if (configuredPaymasterCode && configuredPaymasterCode !== "0x") {
    throw new Error(`bootstrap paymaster is already deployed at ${configuredPaymaster}; refusing duplicate deployment`);
  }
}

const factoryAbi = [
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
    outputs: [{ name: "", type: "address" }],
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
const implementationAbi = [{
  type: "function",
  name: "entryPoint",
  stateMutability: "view",
  inputs: [],
  outputs: [{ name: "", type: "address" }],
}] as const;

const ownerKeyHash = keccak256(receiverOwner.address);
const initialOwners = [{ keyHash: ownerKeyHash, validator: OKX_ECDSA_VALIDATOR }];
const salt = 0n;

const [chainId, entryPointCode, factoryCode, implementationCode, implementationEntryPoint, bootstrapSender] = await Promise.all([
  publicClient.getChainId(),
  publicClient.getCode({ address: ENTRY_POINT_V07 }),
  publicClient.getCode({ address: factory }),
  publicClient.getCode({ address: implementation }),
  publicClient.readContract({
    address: implementation,
    abi: implementationAbi,
    functionName: "entryPoint",
  }),
  publicClient.readContract({
    address: factory,
    abi: factoryAbi,
    functionName: "getAddress",
    args: [initialOwners, salt],
  }),
]);

if (chainId !== CHAIN_ID) throw new Error(`execution RPC returned chain ${chainId}, expected ${CHAIN_ID}`);
if (!entryPointCode || entryPointCode === "0x") {
  throw new Error("canonical v0.7 EntryPoint has no bytecode");
}
if (!factoryCode || factoryCode === "0x") {
  throw new Error("configured OKX Smart Wallet factory has no bytecode");
}
if (!implementationCode || implementationCode === "0x") {
  throw new Error("verified OKX Smart Wallet implementation has no bytecode");
}
if (implementationEntryPoint.toLowerCase() !== ENTRY_POINT_V07.toLowerCase()) {
  throw new Error(`OKX Smart Wallet implementation uses unexpected EntryPoint ${implementationEntryPoint}`);
}
const bootstrapSenderCode = await publicClient.getCode({ address: bootstrapSender });
if (bootstrapSenderCode && bootstrapSenderCode !== "0x") {
  throw new Error("bootstrap receiver account is already deployed; expected the counterfactual account");
}

const factoryCall = encodeFunctionData({
  abi: factoryAbi,
  functionName: "createAccount",
  args: [initialOwners, salt],
});
const initCode = `${factory}${factoryCall.slice(2)}` as Hex;
const initCodeHash = keccak256(initCode);

const artifactPath = new URL(
  "../out/ConveyBootstrapPaymasterV07.sol/ConveyBootstrapPaymasterV07.json",
  import.meta.url,
);
const artifact = JSON.parse(await readFile(fileURLToPath(artifactPath), "utf8")) as {
  abi: readonly unknown[];
  bytecode: { object: Hex };
};
if (!artifact.bytecode.object || artifact.bytecode.object === "0x") {
  throw new Error("ConveyBootstrapPaymasterV07 artifact has no deployable bytecode; run forge build first");
}

const transactionHash = await walletClient.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode.object,
  args: [
    deployer.address,
    signer,
    bootstrapSender,
    initCodeHash,
    sponsorNonce,
    paymasterVerificationGasLimit,
    maxCostCap,
  ],
});
const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash });
if (receipt.status !== "success" || !receipt.contractAddress) {
  throw new Error(`paymaster deployment failed in transaction ${transactionHash}`);
}

let expectedCallDataHash: unknown;
let postDeploymentReadError: string | undefined;
try {
  expectedCallDataHash = await publicClient.readContract({
    address: receipt.contractAddress,
    abi: artifact.abi,
    functionName: "expectedCallDataHash",
  });
} catch (error) {
  const shortMessage = (error as { shortMessage?: unknown } | null)?.shortMessage;
  postDeploymentReadError = typeof shortMessage === "string"
    ? shortMessage
    : "could not read expectedCallDataHash after the successful deployment receipt";
}

console.log(JSON.stringify({
  chainId,
  transactionHash,
  paymasterAddress: receipt.contractAddress,
  deploymentBlockNumber: receipt.blockNumber.toString(),
  deploymentGasUsed: receipt.gasUsed.toString(),
  effectiveGasPriceWei: receipt.effectiveGasPrice?.toString(),
  owner: deployer.address,
  verifyingSigner: signer,
  bootstrapSender,
  initCodeHash,
  expectedCallDataHash,
  postDeploymentReadError,
  sponsorNonce: sponsorNonce.toString(),
  paymasterVerificationGasLimit: paymasterVerificationGasLimit.toString(),
  maxCostCapWei: maxCostCap.toString(),
}, null, 2));
