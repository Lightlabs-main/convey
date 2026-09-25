import { loadSelfHostedRelayerConfig } from "../src/relayer/config.ts";
import { checkConveyOperations, operationsOptionsFromEnv } from "../src/relayer/operations.ts";

try {
  const config = loadSelfHostedRelayerConfig(process.env);
  const report = await checkConveyOperations(config, operationsOptionsFromEnv(process.env));
  console.log(JSON.stringify(report, null, 2));
  if (!report.healthy) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : "operations check failed");
  process.exitCode = 1;
}
