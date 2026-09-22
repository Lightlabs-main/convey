import { createPublicClient, encodeFunctionData, http, keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

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
const [chainId, entryPointCode, smartAccount] = await Promise.all([
  client.getChainId(),
  client.getCode({ address: entryPoint }),
  client.readContract({ address: factory, abi: factoryAbi, functionName: "getAddress", args: [initialOwners, salt] }),
]);

if (chainId !== chain.id) throw new Error(`RPC returned chain ${chainId}, expected ${chain.id}`);
if (!entryPointCode) throw new Error("Configured EntryPoint has no bytecode");

const initCallData = encodeFunctionData({ abi: factoryAbi, functionName: "createAccount", args: [initialOwners, salt] });
const factoryData = `${factory}${initCallData.slice(2)}` as Hex;
const deployedCode = await client.getCode({ address: smartAccount });

console.log(JSON.stringify({
  chainId,
  ownerAddress: owner.address,
  smartAccount,
  deployed: Boolean(deployedCode),
  entryPoint,
  factory,
  salt: salt.toString(),
  erc4337V07FactoryData: factoryData,
  bundlerConfigured: Boolean(process.env.BUNDLER_RPC_URL),
  paymasterConfigured: Boolean(process.env.PAYMASTER_RPC_URL),
}, null, 2));
