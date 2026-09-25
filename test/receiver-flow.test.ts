import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, encodeAbiParameters, stringToHex } from "viem";
import { buildClaimCalldata, issuerApiSymbol, liveGasFromEstimate, parseClaimLink, readReceiverAccountAddress } from "../src/receiver/flow.ts";

test("receiver maps wrapper symbols to the issuer API symbols", () => {
  assert.equal(issuerApiSymbol("wNVDAx"), "NVDAx");
  assert.equal(issuerApiSymbol("AAPLx"), "AAPLx");
  assert.throws(() => issuerApiSymbol("unknown"), /issuer API does not support/);
});

test("receiver parses the bearer secret and non-secret gift lookup hint", () => {
  const secret = "ab".repeat(32);
  const claim = parseClaimLink(`https://convey.example/g/${secret}?giftId=7`);
  assert.equal(claim.giftId, 7n);
  assert.equal(claim.secret, `0x${secret}`);
  assert.throws(() => parseClaimLink(`https://convey.example/g/${secret}`), /missing a valid giftId/);
  assert.throws(() => parseClaimLink("https://convey.example/g/not-a-secret?giftId=7"), /32-byte secret/);
});

test("receiver claim calldata targets the deployed escrow claim interface", () => {
  const claim = parseClaimLink(`https://convey.example/g/${"cd".repeat(32)}?giftId=9`);
  const calldata = buildClaimCalldata(claim, "4471");
  const decoded = decodeFunctionData({
    abi: [{
      type: "function",
      name: "claim",
      stateMutability: "nonpayable",
      inputs: [
        { name: "giftId", type: "uint256" },
        { name: "secret", type: "bytes" },
        { name: "code", type: "bytes" },
      ],
      outputs: [],
    }] as const,
    data: calldata,
  });
  assert.equal(decoded.functionName, "claim");
  assert.equal(decoded.args?.[0], 9n);
  assert.equal(decoded.args?.[1], `0x${"cd".repeat(32)}`);
  assert.equal(decoded.args?.[2], stringToHex("4471"));
});

test("receiver uses live bundler estimate fields without defaults", () => {
  const gas = liveGasFromEstimate({
    callGasLimit: "0x5208",
    verificationGasLimit: "0x100000",
    preVerificationGas: "0x9000",
  }, {
    maxFeePerGas: 20_000_000_000n,
    maxPriorityFeePerGas: 20_000_000_000n,
  });
  assert.deepEqual(gas, {
    callGasLimit: 21_000n,
    verificationGasLimit: 1_048_576n,
    preVerificationGas: 36_864n,
    maxFeePerGas: 20_000_000_000n,
    maxPriorityFeePerGas: 20_000_000_000n,
  });
  assert.throws(() => liveGasFromEstimate({ callGasLimit: undefined as never, verificationGasLimit: "0x1", preVerificationGas: "0x1" }, {
    maxFeePerGas: 1n,
    maxPriorityFeePerGas: 1n,
  }), /callGasLimit/);
});

test("receiver re-derives its deterministic account from the persisted owner", async () => {
  const factory = "0x1111111111111111111111111111111111111111" as const;
  const owner = "0x2222222222222222222222222222222222222222" as const;
  const expected = "0x3333333333333333333333333333333333333333" as const;
  let method = "";
  const account = await readReceiverAccountAddress(
    "https://rpc.example",
    factory,
    owner,
    7n,
    async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { method: string; id: number };
      method = request.method;
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: request.method === "eth_chainId"
          ? "0xc4"
          : encodeAbiParameters([{ type: "address" }], [expected]),
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  );
  assert.equal(method, "eth_call");
  assert.equal(account, expected);
});
