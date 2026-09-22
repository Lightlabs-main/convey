import { writeFile } from "node:fs/promises";

const rpcUrl = process.env.BUNDLER_EXECUTION_RPC_URL?.trim() || process.env.XLAYER_RPC_URL?.trim() || "https://rpc.xlayer.tech";
const outputPath = process.env.BUNDLER_RPC_CAPABILITIES_OUTPUT ?? "docs/verification.rpc-capabilities.json";
const entryPoint = "0x0000000071727de22e5e9d8baf0edac6f37da032";
const zeroAddress = "0x0000000000000000000000000000000000000000";
const javascriptTracer = "{result: function(){ return {}; }}";

let id = 0;

interface ProbeResult {
  supported: boolean;
  resultType?: string;
  error?: string;
}

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const body = await response.json() as { error?: unknown; result?: unknown };
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

async function probe(method: string, params: unknown[]): Promise<ProbeResult> {
  try {
    const result = await rpc(method, params);
    return { supported: true, resultType: Array.isArray(result) ? "array" : typeof result };
  } catch (error) {
    return { supported: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const traceTransaction = { from: zeroAddress, to: entryPoint, data: "0x" };

async function main(): Promise<void> {
  const chainId = Number(BigInt(String(await rpc("eth_chainId", []))));
  if (chainId !== 196) throw new Error(`RPC is on chain ${chainId}; expected X Layer chain 196`);

  const probes = {
    debugTraceCallJavascriptTracer: await probe("debug_traceCall", [traceTransaction, "latest", { tracer: javascriptTracer }]),
    debugTraceCallStateOverride: await probe("debug_traceCall", [
      traceTransaction,
      "latest",
      { tracer: javascriptTracer, stateOverrides: { [entryPoint]: { code: "0x00" } } },
    ]),
    traceCall: await probe("trace_call", [traceTransaction, ["trace"]]),
  };

  const result = {
    observedAt: new Date().toISOString(),
    rpcUrl,
    chainId,
    entryPoint,
    requiredForSafeBundling: ["debug_traceCall with a JavaScript tracer", "debug_traceCall state overrides"],
    probes,
  };
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));

  if (!probes.debugTraceCallJavascriptTracer.supported || !probes.debugTraceCallStateOverride.supported) {
    throw new Error("RPC does not expose the tracing capabilities required for safe ERC-4337 bundling");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
