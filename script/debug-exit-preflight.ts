import { spawnSync } from "node:child_process";
import { buildReceiverCashOutCalls, buildReceiverExit, readReceiverTokenBalance, receiverClaimGasSeedFromLive } from "../src/receiver/flow.ts";
import { receiverSignerFromPrivateKey } from "../src/receiver/signer.ts";
import { ConveyRelayerClient } from "../src/relayer/client.ts";
import { toRpcUserOperation } from "../src/relayer/types.ts";
import { resolveBundlerExecutionRpcUrl } from "./rpc-config.ts";

const rpc = resolveBundlerExecutionRpcUrl();
const entryPoint = process.env.NEXT_PUBLIC_CONVEY_ENTRYPOINT_ADDRESS!;
const factory = process.env.NEXT_PUBLIC_CONVEY_SMART_WALLET_FACTORY!;
const implementation = process.env.NEXT_PUBLIC_CONVEY_SMART_WALLET_IMPLEMENTATION!;
const asset = process.env.NEXT_PUBLIC_CONVEY_WNVDA_TOKEN_ADDRESS!;
const router = process.env.NEXT_PUBLIC_CONVEY_EXIT_ROUTER_ADDRESS!;
const paymaster = process.env.NEXT_PUBLIC_CONVEY_EXIT_PAYMASTER_ADDRESS!;
const account = "0x63B2A84d47cb07fb18EE72Ec386893506Fd963db" as const;
const signer = receiverSignerFromPrivateKey(process.env.SMART_ACCOUNT_OWNER_PRIVATE_KEY! as `0x${string}`);
const relay = new ConveyRelayerClient({
  relayUrl: "https://convey.13-62-181-128.sslip.io/api/relay",
  entryPoint,
  chainId: 196,
  timeoutMs: 30_000,
});
const amountIn = await readReceiverTokenBalance(rpc, asset, account);
const quote = await relay.quoteExit(asset, amountIn);
const calls = buildReceiverCashOutCalls({ inputToken: asset, router, quote, recipient: account, amountIn });
const seed = receiverClaimGasSeedFromLive(await relay.claimGasSeed());
const built = await buildReceiverExit({
  executionRpcUrl: rpc,
  entryPoint,
  factory,
  implementation,
  paymaster,
  signer,
  salt: BigInt(process.env.NEXT_PUBLIC_CONVEY_RECEIVER_SALT || "0"),
  calls,
  gas: seed.gas,
  paymasterVerificationGasLimit: seed.paymasterVerificationGasLimit,
  paymasterPostOpGasLimit: seed.paymasterPostOpGasLimit,
  relay,
  timeoutMs: 30_000,
});

const remoteCode = [
  'let raw="";',
  'process.stdin.on("data", chunk => raw += chunk);',
  'process.stdin.on("end", async () => {',
  '  const { fromRpcUserOperation } = await import("/srv/convey/relayer/src/relayer/types.ts");',
  '  const { JsonRpcClient } = await import("/srv/convey/relayer/src/relayer/rpc.ts");',
  '  const { encodeEntryPointHandleOps, getEntryPointUserOperationHash } = await import("/srv/convey/relayer/src/relayer/preflight.ts");',
  '  try {',
  '    const userOperation = fromRpcUserOperation(JSON.parse(raw));',
  '    const entryPoint = process.env.ENTRYPOINT_ADDRESS;',
  '    const beneficiary = process.env.RELAYER_PREFLIGHT_BENEFICIARY;',
  '    const client = new JsonRpcClient(process.env.XLAYER_RPC_URL, { timeoutMs: 30000 });',
  '    const userOperationHash = await getEntryPointUserOperationHash(client, entryPoint, userOperation);',
  '    const trace = await client.request("debug_traceCall", [{ from: beneficiary, to: entryPoint, gas: "0x5f5e100", data: encodeEntryPointHandleOps(userOperation, beneficiary) }, "latest", { tracer: "callTracer" }]);',
  '    const failures = [];',
  '    const visit = (call) => { if (!call || typeof call !== "object") return; if (call.error || (typeof call.output === "string" && call.output !== "0x" && call.error)) failures.push({ type: call.type, from: call.from, to: call.to, selector: typeof call.input === "string" ? call.input.slice(0, 10) : undefined, error: call.error, revertReason: call.revertReason, output: call.output }); if (Array.isArray(call.calls)) call.calls.forEach(visit); };',
  '    visit(trace);',
  '    console.log(JSON.stringify({ userOperationHash, failures }, null, 2));',
  '  } catch (error) {',
  '    console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2));',
  '    process.exitCode = 1;',
  '  }',
  '});',
].join("\n");
const encoded = Buffer.from(remoteCode).toString("base64");
const command = `sudo node --experimental-strip-types --env-file=/etc/convey/relayer.env --input-type=module -e "eval(Buffer.from(\\"${encoded}\\",\\"base64\\").toString())"`;
const result = spawnSync(
  "ssh",
  ["-i", "/workspaces/codespaces-blank/LightsailDefaultKey-eu-north-1 (3).pem", "-o", "StrictHostKeyChecking=accept-new", "ubuntu@13.62.181.128", command],
  { input: JSON.stringify(toRpcUserOperation(built.userOperation.userOperation)), encoding: "utf8" },
);
console.log(result.stdout);
if (result.stderr) console.error(result.stderr);
if (result.status !== 0) process.exitCode = 1;
