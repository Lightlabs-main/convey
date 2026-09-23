import { createPublicClient, encodeFunctionData, http, keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const XLAYER_ENTRYPOINT_V07 = "0x0000000071727de22e5e9d8baf0edac6f37da032";
const OKX_SMART_WALLET_FACTORY = "0xdd3fea01cd550c9effc893f346690b9a649f35ef";

const requiredAddress = (name: string): `0x${string}` => {
  const value = process.env[name];
  if (!value || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${name} is missing or invalid`);
  return value as `0x${string}`;
};

const privateKey = process.env.SMART_ACCOUNT_OWNER_PRIVATE_KEY;
if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  throw new Error("SMART_ACCOUNT_OWNER_PRIVATE_KEY is missing or invalid");
}

const rpcUrl = process.env.XLAYER_RPC_URL;
if (!rpcUrl) throw new Error("XLAYER_RPC_URL is missing");

const chain = {
  id: 196,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
} as const;

const factory = requiredAddress("OKX_SMART_WALLET_FACTORY");
const entryPoint = requiredAddress("ENTRYPOINT_ADDRESS");
if (entryPoint.toLowerCase() !== XLAYER_ENTRYPOINT_V07) {
  throw new Error(`ENTRYPOINT_ADDRESS must be the verified X Layer v0.7 EntryPoint ${XLAYER_ENTRYPOINT_V07}`);
}
if (factory.toLowerCase() !== OKX_SMART_WALLET_FACTORY) {
  throw new Error(`OKX_SMART_WALLET_FACTORY must be the verified X Layer factory ${OKX_SMART_WALLET_FACTORY}`);
}
const owner = privateKeyToAccount(privateKey as Hex);
const keyHash = keccak256(owner.address);
const salt = 0n;
const initialOwners = [{ keyHash, validator: "0x0000000000000000000000000000000000000001" as const }];

const factoryAbi = [
  {
    type: "function", name: "getAddress", stateMutability: "view",
    inputs: [
      { name: "initialOwners", type: "tuple[]", components: [
        { name: "keyHash", type: "bytes32" }, { name: "validator", type: "address" },
      ] },
      { name: "salt", type: "uint256" },
    ],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function", name: "createAccount", stateMutability: "payable",
    inputs: [
      { name: "initialOwners", type: "tuple[]", components: [
        { name: "keyHash", type: "bytes32" }, { name: "validator", type: "address" },
      ] },
      { name: "salt", type: "uint256" },
    ],
    outputs: [{ name: "account", type: "address" }],
  },
] as const;

const client = createPublicClient({ chain, transport: http(rpcUrl) });
const [chainId, entryPointCode, factoryCode, smartAccount] = await Promise.all([
  client.getChainId(),
  client.getCode({ address: entryPoint }),
  client.getCode({ address: factory }),
  client.readContract({ address: factory, abi: factoryAbi, functionName: "getAddress", args: [initialOwners, salt] }),
]);

if (chainId !== chain.id) throw new Error(`RPC returned chain ${chainId}, expected ${chain.id}`);
if (!entryPointCode || entryPointCode === "0x") throw new Error("Configured EntryPoint has no bytecode");
if (!factoryCode || factoryCode === "0x") throw new Error("Configured OKX factory has no bytecode");

const initCallData = encodeFunctionData({ abi: factoryAbi, functionName: "createAccount", args: [initialOwners, salt] });
const initCode = `${factory}${initCallData.slice(2)}` as Hex;
const deployedCode = await client.getCode({ address: smartAccount });
const deployed = Boolean(deployedCode && deployedCode !== "0x");

console.log(JSON.stringify({
  chainId,
  ownerAddress: owner.address,
  smartAccount,
  deployed,
  entryPoint,
  factory,
  salt: salt.toString(),
  erc4337V07InitCode: initCode,
  erc4337V07InitCodeHash: keccak256(initCode),
  bundlerConfigured: Boolean(process.env.BUNDLER_RPC_URL),
  paymasterConfigured: Boolean(process.env.PAYMASTER_ADDRESS),
}, null, 2));
