import { createPublicClient, http, type Address } from "viem";
import { JsonRpcClient, assertPrivateRpcUrl } from "../src/relayer/rpc.ts";
import { assertUserOperationHash, fromRpcUserOperation } from "../src/relayer/types.ts";
import {
  BOOTSTRAP_CHAIN_ID,
  BOOTSTRAP_ENTRY_POINT_V07,
  bootstrapOperationFilePath,
  readBootstrapOperationRecord,
} from "./bootstrap-operation-record.ts";
import { waitForBootstrapReceipt } from "./bootstrap-operation-receipt.ts";

const CHAIN_ID_HEX = "0xc4";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const bundlerUrl = assertPrivateRpcUrl(required("BUNDLER_RPC_URL"), "BUNDLER_RPC_URL");
const executionUrl = assertPrivateRpcUrl(required("XLAYER_RPC_URL"), "XLAYER_RPC_URL");
if (bundlerUrl.href === executionUrl.href) {
  throw new Error("BUNDLER_RPC_URL must be a separate private bundler endpoint");
}

const configuredEntryPoint = required("ENTRYPOINT_ADDRESS");
if (configuredEntryPoint.toLowerCase() !== BOOTSTRAP_ENTRY_POINT_V07.toLowerCase()) {
  throw new Error(`ENTRYPOINT_ADDRESS must be v0.7 ${BOOTSTRAP_ENTRY_POINT_V07}`);
}
const paymaster = required("BOOTSTRAP_PAYMASTER_ADDRESS");
if (!/^0x[0-9a-fA-F]{40}$/.test(paymaster)) throw new Error("BOOTSTRAP_PAYMASTER_ADDRESS must be a 20-byte address");

const operationRecord = await readBootstrapOperationRecord(bootstrapOperationFilePath(), paymaster as Address);
const userOperation = operationRecord.userOperation;

const execution = createPublicClient({
  chain: {
    id: BOOTSTRAP_CHAIN_ID,
    name: "X Layer",
    nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
    rpcUrls: { default: { http: [executionUrl.href] } },
  },
  transport: http(executionUrl.href),
});
const executionChainId = await execution.getChainId();
if (executionChainId !== 196) throw new Error("execution RPC does not report X Layer chain 196");
const liveHash = await execution.readContract({
    address: BOOTSTRAP_ENTRY_POINT_V07,
  abi: [{
    type: "function", name: "getUserOpHash", stateMutability: "view",
    inputs: [{ name: "userOp", type: "tuple", components: [
      { name: "sender", type: "address" }, { name: "nonce", type: "uint256" },
      { name: "initCode", type: "bytes" }, { name: "callData", type: "bytes" },
      { name: "accountGasLimits", type: "bytes32" }, { name: "preVerificationGas", type: "uint256" },
      { name: "gasFees", type: "bytes32" }, { name: "paymasterAndData", type: "bytes" },
      { name: "signature", type: "bytes" },
    ] }],
    outputs: [{ name: "userOpHash", type: "bytes32" }],
  }] as const,
  functionName: "getUserOpHash",
  args: [fromRpcUserOperation(userOperation)],
});
if (liveHash.toLowerCase() !== operationRecord.userOpHash.toLowerCase()) {
  throw new Error("bootstrap operation file hash differs from the live EntryPoint hash");
}

const bundler = new JsonRpcClient(bundlerUrl.href);
const [chainId, supportedEntryPoints] = await Promise.all([
  bundler.request<string>("eth_chainId"),
  bundler.request<unknown>("eth_supportedEntryPoints"),
]);
if (chainId.toLowerCase() !== CHAIN_ID_HEX) throw new Error("private bundler does not report X Layer chain 196");
if (
  !Array.isArray(supportedEntryPoints)
  || !supportedEntryPoints.some((candidate) =>
    typeof candidate === "string" && candidate.toLowerCase() === BOOTSTRAP_ENTRY_POINT_V07.toLowerCase())
) {
  throw new Error("private bundler does not advertise the configured v0.7 EntryPoint");
}

const submittedHash = await bundler.request<unknown>("eth_sendUserOperation", [userOperation, BOOTSTRAP_ENTRY_POINT_V07]);
assertUserOperationHash(submittedHash, "private bundler response");
if (submittedHash.toLowerCase() !== operationRecord.userOpHash.toLowerCase()) {
  throw new Error("private bundler returned a different UserOperation hash than EntryPoint");
}

console.log(JSON.stringify({
  status: "submitted-to-private-bundler",
  chainId: BOOTSTRAP_CHAIN_ID,
  entryPoint: BOOTSTRAP_ENTRY_POINT_V07,
  paymaster,
  sender: userOperation.sender,
  userOpHash: submittedHash,
  privateBundlerOrigin: bundlerUrl.origin,
}, null, 2));

try {
  const receipt = await waitForBootstrapReceipt(bundler, submittedHash, userOperation.sender);
  const includedSuccessfully = receipt.success && receipt.transactionSucceeded;
  console.log(JSON.stringify({
    status: includedSuccessfully ? "included-success" : "included-failure",
    ...receipt,
  }, null, 2));
  if (!includedSuccessfully) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({
    status: "submitted-awaiting-inclusion",
    userOpHash: submittedHash,
    error: error instanceof Error ? error.message : "receipt polling failed",
    recoveryCommand: "pnpm bootstrap:wait",
  }, null, 2));
  process.exitCode = 1;
}
