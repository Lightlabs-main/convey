const DEFAULT_XLAYER_RPC_URL = "https://rpc.xlayer.tech";

export type RpcEnvironment = Record<string, string | undefined>;

/**
 * Resolve the execution RPC used by the private bundler. Prefer an explicit
 * private URL, then the keyed NodeFlare endpoint already configured by the
 * operator, then the ordinary read RPC.
 */
export function resolveBundlerExecutionRpcUrl(env: RpcEnvironment = process.env): string {
  const explicit = env.BUNDLER_EXECUTION_RPC_URL?.trim();
  if (explicit) return explicit;

  const nodeflareKey = env.NODEFLARE_API_KEY?.trim();
  if (nodeflareKey) {
    return `https://rpc.nodeflare.app/xlayer/v1/${encodeURIComponent(nodeflareKey)}`;
  }

  return env.XLAYER_RPC_URL?.trim() || DEFAULT_XLAYER_RPC_URL;
}

/** Do not write credentials embedded in RPC paths, query strings, or userinfo to logs. */
export function redactRpcUrl(rpcUrl: string): string {
  try {
    const parsed = new URL(rpcUrl);
    return `${parsed.protocol}//${parsed.host}/[RPC path redacted]`;
  } catch {
    return "[invalid RPC URL redacted]";
  }
}
