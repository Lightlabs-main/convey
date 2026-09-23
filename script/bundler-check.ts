import { SelfHostedBundlerClient } from "../src/relayer/bundler.ts";
import { XLAYER_ENTRYPOINT_V07, XLAYER_CHAIN_ID } from "../src/relayer/config.ts";
import { redactRpcUrl } from "./rpc-config.ts";

const endpoint = process.env.BUNDLER_RPC_URL?.trim();
if (!endpoint) {
  console.error("BUNDLER_RPC_URL is required for the private bundler check");
  process.exitCode = 1;
} else {
  try {
    const client = new SelfHostedBundlerClient(endpoint);
    const [chainId, supportedEntryPoints] = await Promise.all([
      client.chainId(),
      client.supportedEntryPoints(),
    ]);
    const entryPointSupported = supportedEntryPoints.includes(XLAYER_ENTRYPOINT_V07);
    const report = {
      healthy: chainId === XLAYER_CHAIN_ID && entryPointSupported,
      endpoint: redactRpcUrl(endpoint),
      chainId,
      expectedChainId: XLAYER_CHAIN_ID,
      supportedEntryPoints,
      expectedEntryPoint: XLAYER_ENTRYPOINT_V07,
      entryPointSupported,
    };
    console.log(JSON.stringify(report, null, 2));
    if (!report.healthy) process.exitCode = 1;
  } catch {
    console.error("private bundler check failed; endpoint details are redacted");
    process.exitCode = 1;
  }
}
