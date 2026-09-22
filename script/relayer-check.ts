import { loadSelfHostedRelayerConfig } from "../src/relayer/config.ts";
import { checkRelayerHealth } from "../src/relayer/health.ts";

try {
  const config = loadSelfHostedRelayerConfig(process.env);
  const report = await checkRelayerHealth(config);
  console.log(JSON.stringify(report, null, 2));
  if (!report.healthy) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : "relayer configuration failed");
  process.exitCode = 1;
}

