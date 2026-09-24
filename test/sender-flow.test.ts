import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData } from "viem";
import { buildClaimLink, encodeCreateGiftCall, parseGiftAmount } from "../src/sender/index.ts";

test("sender amount parsing uses the live token decimals supplied by the registry", () => {
  assert.equal(parseGiftAmount("5", 18), 5_000_000_000_000_000_000n);
  assert.equal(parseGiftAmount("0.030965586663211895", 18), 30_965_586_663_211_895n);
  assert.throws(() => parseGiftAmount("0", 18), /greater than zero/);
  assert.throws(() => parseGiftAmount("1.0000000000000000001", 18), /at most 18 places/);
});

test("sender claim links contain only the generated bearer secret", () => {
  const secret = `0x${"ab".repeat(32)}` as `0x${string}`;
  assert.equal(buildClaimLink("https://convey.example/", secret), `https://convey.example/g/${"ab".repeat(32)}`);
  assert.throws(() => buildClaimLink("http://example.com", secret), /HTTPS/);
});

test("sender createGift calldata encodes the deployed escrow interface", () => {
  const call = encodeCreateGiftCall({
    asset: "0x0000000000000000000000000000000000000001",
    amount: 5n,
    secretHash: `0x${"11".repeat(32)}`,
    codeHash: `0x${"22".repeat(32)}`,
    expiry: 0n,
    noteHash: `0x${"33".repeat(32)}`,
  });
  const decoded = decodeFunctionData({
    abi: [{
      type: "function",
      name: "createGift",
      stateMutability: "payable",
      inputs: [
        { name: "asset", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "secretHash", type: "bytes32" },
        { name: "codeHash", type: "bytes32" },
        { name: "expiry", type: "uint64" },
        { name: "noteHash", type: "bytes32" },
      ],
      outputs: [{ name: "giftId", type: "uint256" }],
    }] as const,
    data: call,
  });
  assert.equal(decoded.functionName, "createGift");
  assert.equal(decoded.args?.[1], 5n);
  assert.equal(decoded.args?.[3], `0x${"22".repeat(32)}`);
});
