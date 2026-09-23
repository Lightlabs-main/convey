import { JsonRpcClient, assertPrivateRpcUrl } from "../src/relayer/rpc.ts";
import {
  BOOTSTRAP_CHAIN_ID,
  BOOTSTRAP_ENTRY_POINT_V07,
  bootstrapOperationFilePath,
  readBootstrapOperationRecord,
} from "./bootstrap-operation-record.ts";
import { waitForBootstrapReceipt } from "./bootstrap-operation-receipt.ts";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const bundlerUrl = assertPrivateRpcUrl(required("BUNDLER_RPC_URL"), "BUNDLER_RPC_URL");
const record = await readBootstrapOperationRecord(bootstrapOperationFilePath());
const bundler = new JsonRpcClient(bundlerUrl.href);
const [chainId, supportedEntryPoints] = await Promise.all([
  bundler.request<string>("eth_chainId"),
  bundler.request<unknown>("eth_supportedEntryPoints"),
]);
if (chainId.toLowerCase() !== "0xc4") {
  throw new Error("private bundler does not report X Layer chain 196");
}
if (
  !Array.isArray(supportedEntryPoints)
  || !supportedEntryPoints.some((candidate) =>
    typeof candidate === "string" && candidate.toLowerCase() === BOOTSTRAP_ENTRY_POINT_V07.toLowerCase())
) {
  throw new Error("private bundler does not advertise the operation's v0.7 EntryPoint");
}

console.log(JSON.stringify({
  status: "waiting-for-inclusion",
  chainId: BOOTSTRAP_CHAIN_ID,
  entryPoint: BOOTSTRAP_ENTRY_POINT_V07,
  userOpHash: record.userOpHash,
  sender: record.userOperation.sender,
  privateBundlerOrigin: bundlerUrl.origin,
}, null, 2));

try {
  const receipt = await waitForBootstrapReceipt(bundler, record.userOpHash, record.userOperation.sender);
  const includedSuccessfully = receipt.success && receipt.transactionSucceeded;
  console.log(JSON.stringify({
    status: includedSuccessfully ? "included-success" : "included-failure",
    ...receipt,
  }, null, 2));
  if (!includedSuccessfully) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({
    status: "still-pending-or-unavailable",
    userOpHash: record.userOpHash,
    error: error instanceof Error ? error.message : "receipt polling failed",
  }, null, 2));
  process.exitCode = 1;
}
