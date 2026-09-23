import { loadSelfHostedRelayerConfig } from "../src/relayer/config.ts";
import { createRelayerServer } from "../src/relayer/server.ts";

const config = loadSelfHostedRelayerConfig(process.env);
const server = createRelayerServer(config);

server.listen(config.port, config.bindAddress, () => {
  console.log(`Ticker private relayer listening on ${config.bindAddress}:${config.port}`);
});

const close = () => server.close(() => process.exit(0));
process.once("SIGINT", close);
process.once("SIGTERM", close);
