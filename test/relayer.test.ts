import test from "node:test";
import assert from "node:assert/strict";
import {
  assertPrivateRpcUrl,
} from "../src/relayer/rpc.ts";
import {
  assertRpcUserOperationV07,
  assertSponsoredUserOperation,
  fromRpcUserOperation,
  packAccountGasLimits,
  packGasFees,
  packPaymasterAndData,
  toRpcUserOperation,
  type Address,
  type RpcUserOperationV07,
} from "../src/relayer/types.ts";
import { loadSelfHostedRelayerConfig } from "../src/relayer/config.ts";
import { assertClaimExecutionCalldata, encodeOkxClaimExecution } from "../src/relayer/claim-policy.ts";
import {
  encodeOkxFactoryInitCode,
  encodeOkxOwnerSignature,
  okxOwnerKeyHash,
  OKX_ECDSA_VALIDATOR,
} from "../src/relayer/okx.ts";
import * as browserSdk from "../src/index.ts";

const sender = "0x1111111111111111111111111111111111111111" as Address;
const factory = "0x2222222222222222222222222222222222222222" as Address;
const paymaster = "0x3333333333333333333333333333333333333333" as Address;
const entryPoint = "0x0000000071727de22e5e9d8baf0edac6f37da032" as Address;
const escrow = "0x4444444444444444444444444444444444444444" as Address;

const expandedOperation: RpcUserOperationV07 = {
  sender,
  nonce: "0x0",
  factory,
  factoryData: "0xdeadbeef",
  callData: "0x12345678",
  callGasLimit: "0x1d4c0",
  verificationGasLimit: "0x493e0",
  preVerificationGas: "0xc350",
  maxFeePerGas: "0x1",
  maxPriorityFeePerGas: "0x1",
  paymaster,
  paymasterVerificationGasLimit: "0x186a0",
  paymasterPostOpGasLimit: "0x186a0",
  paymasterData: "0xbeef",
  signature: "0xdeadbeef",
};

test("v0.7 packed and JSON-RPC UserOperation forms round-trip without loss", () => {
  const packed = fromRpcUserOperation(expandedOperation);
  const unpacked = toRpcUserOperation(packed);
  assert.deepEqual(unpacked, expandedOperation);
  assert.equal(packed.accountGasLimits, packAccountGasLimits(300_000n, 120_000n));
  assert.equal(packed.gasFees, packGasFees(1n, 1n));
  assert.equal(packed.paymasterAndData, packPaymasterAndData(paymaster, 100_000n, 100_000n, "0xbeef"));
});

test("claim validation requires a sponsored, signed operation", () => {
  assert.doesNotThrow(() => assertSponsoredUserOperation(expandedOperation));
  assert.throws(() => assertSponsoredUserOperation({ ...expandedOperation, paymaster: undefined, paymasterVerificationGasLimit: undefined, paymasterPostOpGasLimit: undefined, paymasterData: undefined }), /paymaster/);
  assert.throws(() => assertSponsoredUserOperation({ ...expandedOperation, signature: "0x" }), /signature/);
});

test("private relay URLs fail closed outside HTTPS or localhost", () => {
  assert.equal(assertPrivateRpcUrl("https://relay.ticker.example", "relay").protocol, "https:");
  assert.equal(assertPrivateRpcUrl("http://127.0.0.1:8787", "relay").hostname, "127.0.0.1");
  assert.throws(() => assertPrivateRpcUrl("http://relay.ticker.example", "relay"), /HTTPS/);
});

test("browser SDK does not export the private bundler client", () => {
  assert.equal("SelfHostedBundlerClient" in browserSdk, false);
  assert.equal("TickerRelayerClient" in browserSdk, true);
});

test("self-hosted configuration cannot accidentally use the public execution RPC as bundler", () => {
  const env = {
    XLAYER_CHAIN_ID: "196",
    XLAYER_RPC_URL: "https://rpc.xlayer.tech",
    BUNDLER_RPC_URL: "https://bundler.ticker.example/rpc",
    ENTRYPOINT_ADDRESS: entryPoint,
    PAYMASTER_ADDRESS: paymaster,
    PAYMASTER_MIN_DEPOSIT_WEI: "1",
    PAYMASTER_MIN_STAKE_WEI: "1",
    TICKER_CLAIM_ESCROW_ADDRESS: escrow,
    TICKER_CLAIM_FUNCTION_SELECTOR: "0x12345678",
  };
  const config = loadSelfHostedRelayerConfig(env);
  assert.equal(config.chainId, 196);
  assert.equal(config.entryPoint, entryPoint);
  assert.equal(config.paymaster, paymaster);
  assert.equal(config.claimEscrow, escrow);
  assert.throws(() => loadSelfHostedRelayerConfig({ ...env, BUNDLER_RPC_URL: env.XLAYER_RPC_URL }), /separate private bundler/);
  assert.throws(() => loadSelfHostedRelayerConfig({ ...env, ENTRYPOINT_ADDRESS: "0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789" }), /ERC-4337 v0.7/);
});

test("legacy-shaped operations are rejected when v0.7 expanded fields are absent", () => {
  const legacy = { sender, nonce: "0x0", callData: "0x", signature: "0x01" };
  assert.throws(() => assertRpcUserOperationV07(legacy), /callGasLimit/);
});

test("claim policy accepts only one zero-value call to the configured escrow", () => {
  const selector = "0x12345678" as `0x${string}`;
  const callData = encodeOkxClaimExecution([{ target: escrow, value: 0n, data: `${selector}deadbeef` as `0x${string}` }]);
  assert.doesNotThrow(() => assertClaimExecutionCalldata(callData, escrow, selector));
  assert.throws(() => assertClaimExecutionCalldata(callData, paymaster, selector), /configured escrow/);
  assert.throws(() => assertClaimExecutionCalldata(encodeOkxClaimExecution([{ target: escrow, value: 1n, data: `${selector}deadbeef` as `0x${string}` }]), escrow, selector), /native currency/);
  assert.throws(() => assertClaimExecutionCalldata(encodeOkxClaimExecution([{ target: escrow, value: 0n, data: "0xdeadbeef" }]), escrow, selector), /configured claim function/);
});

test("OKX owner signature envelope is fixed-width", () => {
  const owner = "0x14791697260E4c9A71f18484C9f997B308e59325" as Address;
  const keyHash = okxOwnerKeyHash(owner);
  const ecdsaSignature = `0x${"11".repeat(65)}` as `0x${string}`;
  const envelope = encodeOkxOwnerSignature(keyHash, 0x010203040506n, ecdsaSignature);
  assert.equal(envelope.length, 2 + (32 + 6 + 65) * 2);
  assert.equal(envelope.slice(2, 66), keyHash.slice(2));
  assert.equal(envelope.slice(66, 78), "010203040506");
  assert.equal(envelope.slice(78), ecdsaSignature.slice(2));
  assert.throws(() => encodeOkxOwnerSignature(keyHash, 1n << 48n, ecdsaSignature), /6 bytes/);
});

test("OKX factory init code carries the verified owner validator and factory address", () => {
  const owner = "0x14791697260E4c9A71f18484C9f997B308e59325" as Address;
  const factoryAddress = "0xdd3fea01cd550c9effc893f346690b9a649f35ef" as Address;
  const code = encodeOkxFactoryInitCode(factoryAddress, [{ keyHash: okxOwnerKeyHash(owner), validator: OKX_ECDSA_VALIDATOR }], 0n);
  assert.equal(code.slice(0, 42).toLowerCase(), factoryAddress.toLowerCase());
  assert.ok(code.length > 42);
});
