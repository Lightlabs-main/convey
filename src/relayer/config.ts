import { assertPrivateRpcUrl } from "./rpc.ts";
import type { Address, Hex } from "./types.ts";
import { assertAddress, assertUserOperationHash } from "./types.ts";

export const XLAYER_CHAIN_ID = 196;
export const XLAYER_ENTRYPOINT_V07 = "0x0000000071727de22e5e9d8baf0edac6f37da032" as Address;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

export interface SelfHostedRelayerConfig {
  chainId: number;
  executionRpcUrl: string;
  bundlerRpcUrl: string;
  entryPoint: Address;
  paymaster: Address;
  claimEscrow: Address;
  claimFunctionSelector: `0x${string}`;
  preflightBeneficiary: Address;
  minimumPaymasterDepositWei: bigint;
  minimumPaymasterStakeWei: bigint;
  requestTimeoutMs: number;
  maxBodyBytes: number;
  bindAddress: string;
  port: number;
  authToken?: string;
  claimPaymasterSignerPrivateKey?: Hex;
  claimGasSeedUserOperationHash?: Hex;
}

export interface RelayClientConfig {
  relayUrl: string;
  entryPoint: Address;
  chainId?: number;
  requestTimeoutMs?: number;
  authToken?: string;
}

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function addressFromEnv(env: Record<string, string | undefined>, name: string): Address {
  const value = required(env, name);
  assertAddress(value, name);
  return value.toLowerCase() as Address;
}

function selectorFromEnv(env: Record<string, string | undefined>, name: string): `0x${string}` {
  const value = required(env, name);
  if (!/^0x[0-9a-fA-F]{8}$/.test(value)) throw new Error(`${name} must be a bytes4 selector`);
  return value.toLowerCase() as `0x${string}`;
}

function privateKeyFromEnv(env: Record<string, string | undefined>, name: string): Hex | undefined {
  const value = env[name]?.trim();
  if (!value) return undefined;
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${name} must be a 32-byte private key`);
  return value.toLowerCase() as Hex;
}

function userOperationHashFromEnv(env: Record<string, string | undefined>, name: string): Hex | undefined {
  const value = env[name]?.trim();
  if (!value) return undefined;
  assertUserOperationHash(value, name);
  return value.toLowerCase() as Hex;
}

function positiveBigIntFromEnv(env: Record<string, string | undefined>, name: string): bigint {
  const value = required(env, name);
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`${name} must be an integer amount in wei`);
  }
  if (parsed <= 0n) throw new Error(`${name} must be greater than zero`);
  return parsed;
}

function integerFromEnv(env: Record<string, string | undefined>, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return value;
}

function chainIdFromEnv(env: Record<string, string | undefined>): number {
  const value = env.XLAYER_CHAIN_ID?.trim() || String(XLAYER_CHAIN_ID);
  const chainId = Number(value);
  if (!Number.isInteger(chainId) || chainId !== XLAYER_CHAIN_ID) {
    throw new Error(`XLAYER_CHAIN_ID must be ${XLAYER_CHAIN_ID}`);
  }
  return chainId;
}

export function loadSelfHostedRelayerConfig(env: Record<string, string | undefined> = process.env): SelfHostedRelayerConfig {
  const chainId = chainIdFromEnv(env);
  const executionRpcUrl = env.XLAYER_RPC_URL?.trim() || env.ETH_RPC_URL?.trim();
  if (!executionRpcUrl) throw new Error("XLAYER_RPC_URL or ETH_RPC_URL is required");
  const bundlerRpcUrl = required(env, "BUNDLER_RPC_URL");
  assertPrivateRpcUrl(executionRpcUrl, "XLAYER_RPC_URL");
  assertPrivateRpcUrl(bundlerRpcUrl, "BUNDLER_RPC_URL");
  if (new URL(executionRpcUrl).href === new URL(bundlerRpcUrl).href) {
    throw new Error("BUNDLER_RPC_URL must be a separate private bundler endpoint, not the execution RPC");
  }

  const entryPoint = addressFromEnv(env, "ENTRYPOINT_ADDRESS");
  if (entryPoint !== XLAYER_ENTRYPOINT_V07) throw new Error(`ENTRYPOINT_ADDRESS must be ERC-4337 v0.7 at ${XLAYER_ENTRYPOINT_V07}`);

  return {
    chainId,
    executionRpcUrl,
    bundlerRpcUrl,
    entryPoint,
    paymaster: addressFromEnv(env, "PAYMASTER_ADDRESS"),
    claimEscrow: addressFromEnv(env, "CONVEY_CLAIM_ESCROW_ADDRESS"),
    claimFunctionSelector: selectorFromEnv(env, "CONVEY_CLAIM_FUNCTION_SELECTOR"),
    preflightBeneficiary: env.RELAYER_PREFLIGHT_BENEFICIARY
      ? addressFromEnv(env, "RELAYER_PREFLIGHT_BENEFICIARY")
      : ZERO_ADDRESS,
    minimumPaymasterDepositWei: positiveBigIntFromEnv(env, "PAYMASTER_MIN_DEPOSIT_WEI"),
    minimumPaymasterStakeWei: positiveBigIntFromEnv(env, "PAYMASTER_MIN_STAKE_WEI"),
    requestTimeoutMs: integerFromEnv(env, "RELAYER_RPC_TIMEOUT_MS", 15_000, 500, 120_000),
    maxBodyBytes: integerFromEnv(env, "RELAYER_MAX_BODY_BYTES", 131_072, 16_384, 1_048_576),
    bindAddress: env.RELAYER_SERVER_BIND?.trim() || "127.0.0.1",
    port: integerFromEnv(env, "RELAYER_SERVER_PORT", 8787, 1, 65_535),
    authToken: env.CONVEY_RELAYER_AUTH_TOKEN?.trim() || undefined,
    claimPaymasterSignerPrivateKey: privateKeyFromEnv(env, "CONVEY_CLAIM_PAYMASTER_SIGNER_PRIVATE_KEY"),
    claimGasSeedUserOperationHash: userOperationHashFromEnv(env, "CONVEY_CLAIM_GAS_SEED_USER_OPERATION_HASH"),
  };
}

export function loadRelayClientConfig(env: Record<string, string | undefined> = process.env): RelayClientConfig {
  const relayUrl = required(env, "CONVEY_RELAYER_URL");
  const entryPoint = addressFromEnv(env, "ENTRYPOINT_ADDRESS");
  if (entryPoint !== XLAYER_ENTRYPOINT_V07) throw new Error(`ENTRYPOINT_ADDRESS must be ERC-4337 v0.7 at ${XLAYER_ENTRYPOINT_V07}`);
  const parsedUrl = new URL(relayUrl);
  if (parsedUrl.protocol !== "https:" && !(parsedUrl.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(parsedUrl.hostname))) {
    throw new Error("CONVEY_RELAYER_URL must use HTTPS; plain HTTP is only allowed on localhost");
  }
  return {
    relayUrl: parsedUrl.toString().replace(/\/$/, ""),
    entryPoint,
    chainId: chainIdFromEnv(env),
    requestTimeoutMs: integerFromEnv(env, "RELAYER_RPC_TIMEOUT_MS", 15_000, 500, 120_000),
    authToken: env.CONVEY_RELAYER_AUTH_TOKEN?.trim() || undefined,
  };
}
