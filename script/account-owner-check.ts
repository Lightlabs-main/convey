import { createPublicClient, encodeFunctionData, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { okxOwnerKeyHash, OKX_ECDSA_VALIDATOR } from "../src/relayer/okx.ts";

const CHAIN_ID = 196;
const XLAYER_ENTRYPOINT_V07 = "0x0000000071727de22e5e9d8baf0edac6f37da032" as Address;
const OKX_SMART_WALLET_FACTORY = "0xdd3fea01cd550c9effc893f346690b9a649f35ef" as Address;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

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
    outputs: [{ name: "account", type: "address" }],
  },
] as const;

const walletAbi = [
  {
    type: "function",
    name: "execute",
    stateMutability: "nonpayable",
    inputs: [{ name: "calls", type: "tuple[]", components: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
    ] }],
    outputs: [],
  },
  {
    type: "function",
    name: "removeOwner",
    stateMutability: "nonpayable",
    inputs: [{ name: "keyHash", type: "bytes32" }],
    outputs: [],
  },
  { type: "function", name: "entryPoint", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "ownerCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getOwnerKeys", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32[]" }] },
  {
    type: "function",
    name: "hasOwner",
    stateMutability: "view",
    inputs: [{ name: "keyHash", type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "getOwnerSettings",
    stateMutability: "view",
    inputs: [{ name: "keyHash", type: "bytes32" }],
    outputs: [
      { name: "validator", type: "address" },
      { name: "hook", type: "address" },
      { name: "expiration", type: "uint40" },
      { name: "adminStatus", type: "bool" },
      { name: "expired", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "getVerifiedValidator",
    stateMutability: "view",
    inputs: [{ name: "keyHash", type: "bytes32" }],
    outputs: [{ type: "address" }],
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

const rpcUrl = required("XLAYER_RPC_URL");
const configuredEntryPoint = address("ENTRYPOINT_ADDRESS");
const configuredFactory = address("OKX_SMART_WALLET_FACTORY");
if (configuredEntryPoint.toLowerCase() !== XLAYER_ENTRYPOINT_V07.toLowerCase()) {
  throw new Error(`ENTRYPOINT_ADDRESS must be X Layer v0.7 ${XLAYER_ENTRYPOINT_V07}`);
}
if (configuredFactory.toLowerCase() !== OKX_SMART_WALLET_FACTORY.toLowerCase()) {
  throw new Error(`OKX_SMART_WALLET_FACTORY must be ${OKX_SMART_WALLET_FACTORY}`);
}

const owner = privateKeyToAccount(privateKey("SMART_ACCOUNT_OWNER_PRIVATE_KEY"));
const keyHash = okxOwnerKeyHash(owner.address);
const initialOwners = [{ keyHash, validator: OKX_ECDSA_VALIDATOR }];
const chain = {
  id: CHAIN_ID,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
} as const;
const client = createPublicClient({ chain, transport: http(rpcUrl) });

const [chainId, entryPointCode, factoryCode, receiver] = await Promise.all([
  client.getChainId(),
  client.getCode({ address: configuredEntryPoint }),
  client.getCode({ address: configuredFactory }),
  client.readContract({ address: configuredFactory, abi: factoryAbi, functionName: "getAddress", args: [initialOwners, 0n] }),
]);
if (chainId !== CHAIN_ID) throw new Error(`execution RPC returned chain ${chainId}, expected ${CHAIN_ID}`);
if (!entryPointCode || entryPointCode === "0x") throw new Error("configured EntryPoint has no bytecode");
if (!factoryCode || factoryCode === "0x") throw new Error("configured OKX factory has no bytecode");

const [receiverCode, accountEntryPoint, ownerCount, ownerKeys, hasOwner, settings, verifiedValidator] = await Promise.all([
  client.getCode({ address: receiver }),
  client.readContract({ address: receiver, abi: walletAbi, functionName: "entryPoint" }),
  client.readContract({ address: receiver, abi: walletAbi, functionName: "ownerCount" }),
  client.readContract({ address: receiver, abi: walletAbi, functionName: "getOwnerKeys" }),
  client.readContract({ address: receiver, abi: walletAbi, functionName: "hasOwner", args: [keyHash] }),
  client.readContract({ address: receiver, abi: walletAbi, functionName: "getOwnerSettings", args: [keyHash] }),
  client.readContract({ address: receiver, abi: walletAbi, functionName: "getVerifiedValidator", args: [keyHash] }),
]);
if (!receiverCode || receiverCode === "0x") throw new Error("derived receiver account has no deployed bytecode");
if (accountEntryPoint.toLowerCase() !== XLAYER_ENTRYPOINT_V07.toLowerCase()) {
  throw new Error(`receiver account uses unexpected EntryPoint ${accountEntryPoint}`);
}
if (!hasOwner) throw new Error("derived receiver owner is not registered on chain");
if (!ownerKeys.some((candidate) => candidate.toLowerCase() === keyHash.toLowerCase())) {
  throw new Error("derived receiver owner key hash is absent from the live owner list");
}
const [validator, hook, expiration, adminStatus, expired] = settings;
if (validator.toLowerCase() !== OKX_ECDSA_VALIDATOR.toLowerCase()) throw new Error("receiver owner uses an unexpected validator");
if (hook.toLowerCase() !== ZERO_ADDRESS.toLowerCase()) throw new Error("receiver owner has an unexpected hook");
if (!adminStatus || expired) throw new Error("receiver owner is not an active admin");
if (verifiedValidator.toLowerCase() !== OKX_ECDSA_VALIDATOR.toLowerCase()) {
  throw new Error("receiver owner does not resolve to the built-in ECDSA validator");
}

const removeOwnerData = encodeFunctionData({ abi: walletAbi, functionName: "removeOwner", args: [keyHash] });
const executeData = encodeFunctionData({
  abi: walletAbi,
  functionName: "execute",
  args: [[{ target: receiver, value: 0n, data: removeOwnerData }]],
});
await client.call({ account: owner.address, to: receiver, data: executeData });
const [ownerCountAfterSimulation, hasOwnerAfterSimulation] = await Promise.all([
  client.readContract({ address: receiver, abi: walletAbi, functionName: "ownerCount" }),
  client.readContract({ address: receiver, abi: walletAbi, functionName: "hasOwner", args: [keyHash] }),
]);
if (ownerCountAfterSimulation !== ownerCount || hasOwnerAfterSimulation !== hasOwner) {
  throw new Error("read-only owner revocation simulation changed live owner state");
}

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  chainId,
  ownerAddress: owner.address,
  ownerKeyHash: keyHash,
  receiver,
  deployed: true,
  accountEntryPoint,
  ownerCount: ownerCount.toString(),
  ownerKeys,
  hasOwner,
  ownerSettings: {
    validator,
    hook,
    expiration: expiration.toString(),
    adminStatus,
    expired,
  },
  verifiedValidator,
  revocationSimulation: {
    callPath: "owner EOA eth_call -> wallet execute -> wallet removeOwner",
    succeeded: true,
    stateUnchanged: true,
  },
  revocationPath: "owner-signed self-call required; no mutation performed",
}, null, 2));
