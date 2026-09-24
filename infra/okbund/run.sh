#!/usr/bin/env bash
set -euo pipefail

: "${BUNDLER_PRIVATE_KEY:?BUNDLER_PRIVATE_KEY must be supplied by the secret manager}"
: "${ETH_RPC_URL:?ETH_RPC_URL must point to a private X Layer tracing RPC}"
: "${CHAIN_ID:?CHAIN_ID must be set to 196}"
: "${ENTRYPOINT:?ENTRYPOINT must be set to the verified v0.7 EntryPoint}"
: "${BUNDLER_ENV:?BUNDLER_ENV=prod is required}"

if [[ "${CHAIN_ID}" != "196" ]]; then
  echo "refusing to start: CHAIN_ID must be 196" >&2
  exit 1
fi
if [[ "${ENTRYPOINT,,}" != "0x0000000071727de22e5e9d8baf0edac6f37da032" ]]; then
  echo "refusing to start: ENTRYPOINT must be the verified X Layer v0.7 EntryPoint" >&2
  exit 1
fi
if [[ "${SAFE_MODE:-}" != "true" ]]; then
  echo "refusing to start: SAFE_MODE=true is required" >&2
  exit 1
fi
if [[ "${EIP1559:-}" != "true" ]]; then
  echo "refusing to start: EIP1559=true is required" >&2
  exit 1
fi
if [[ "${BUNDLER_ENV}" != "prod" ]]; then
  echo "refusing to start: BUNDLER_ENV=prod is required" >&2
  exit 1
fi

bundler_dir="${OKBUND_DIR:-/srv/convey/okbund}"
jar_path="${OKBUND_JAR:-${bundler_dir}/aa-starter/target/aa-starter-0.0.1.jar}"
BUNDLER_BIND_ADDRESS="${BUNDLER_BIND_ADDRESS:-127.0.0.1}"
if [[ ! -f "${jar_path}" ]]; then
  echo "refusing to start: OKBund jar not found at ${jar_path}" >&2
  exit 1
fi

cd "${bundler_dir}"
# The node-side fallback calls account calldata in isolation and is invalid for
# Convey claims whose escrow call intentionally depends on paymaster validation
# having marked the gift reserve InFlight. Keep OKBund's EntryPoint/EVM
# simulation enabled and disable only that incompatible fallback estimator.
exec java -jar "${jar_path}" \
  --server.address="${BUNDLER_BIND_ADDRESS}" \
  --rest.estimate.open-estimate-gas-from-node=false
