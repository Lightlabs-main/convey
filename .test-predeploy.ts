import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, encodeFunctionData, http, keccak256, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ConveyRelayerClient } from "./src/relayer/client.ts";
import { parseClaimLink, prepareReceiverClaim, readReceiverAccountAddress, receiverClaimGasSeedFromLive } from "./src/receiver/flow.ts";
import { receiverSignerFromPrivateKey } from "./src/receiver/signer.ts";
import { randomSecret } from "./src/sender/index.ts";
const e = process.env;
const RPC = "https://rpc.xlayer.tech";
const FACTORY = e.NEXT_PUBLIC_CONVEY_SMART_WALLET_FACTORY as Address;
const salt = BigInt(e.NEXT_PUBLIC_CONVEY_RECEIVER_SALT ?? "0");
const signer = receiverSignerFromPrivateKey(randomSecret());
const account = await readReceiverAccountAddress(RPC, FACTORY, signer.address, salt);
const pc = createPublicClient({ transport: http(RPC) });
const admin = privateKeyToAccount(e.RECURRING_ADMIN_PRIVATE_KEY as Hex);
const wc = createWalletClient({ account: admin, transport: http(RPC) });
const abi = [{ type: "function", name: "createAccount", stateMutability: "payable", inputs: [{ name: "o", type: "tuple[]", components: [{ name: "keyHash", type: "bytes32" }, { name: "validator", type: "address" }] }, { name: "salt", type: "uint256" }], outputs: [{ type: "address" }] }] as const;
const deployTx = await wc.sendTransaction({ chain: null, to: FACTORY, gasPrice: await pc.getGasPrice(), data: encodeFunctionData({ abi, functionName: "createAccount", args: [[{ keyHash: keccak256(signer.address), validator: "0x0000000000000000000000000000000000000001" }], salt] }) });
const r = await pc.waitForTransactionReceipt({ hash: deployTx });
console.log("pre-deployed receiver", account, r.status, deployTx);
const link = JSON.parse(readFileSync(".recurring-proof.mainnet.json", "utf8")).gifts[0].claimLink;
const relay = new ConveyRelayerClient({ relayUrl: "https://conveyapp.site/api/relay", entryPoint: "0x0000000071727de22e5e9d8baf0edac6f37da032" });
const prepared = await prepareReceiverClaim({
  claim: parseClaimLink(link), executionRpcUrl: RPC, factory: FACTORY, implementation: e.NEXT_PUBLIC_CONVEY_SMART_WALLET_IMPLEMENTATION as Address,
  escrow: e.NEXT_PUBLIC_CONVEY_CLAIM_ESCROW_ADDRESS as Address, claimFunctionSelector: e.NEXT_PUBLIC_CONVEY_CLAIM_FUNCTION_SELECTOR as Hex,
  paymaster: e.NEXT_PUBLIC_CONVEY_CLAIM_PAYMASTER_ADDRESS as Address, signer, salt, relay, gasSeed: receiverClaimGasSeedFromLive(await relay.claimGasSeed()),
});
console.log("deployed flag", prepared.deployed);
const accepted = await relay.submitClaim(prepared.userOperation.userOperation, { idempotencyKey: `predeploy-${Date.now()}` } as never);
console.log("accepted", accepted.userOperationHash);
const result = await relay.waitForClaim(accepted.userOperationHash);
console.log("result", JSON.stringify(result, (_k, v) => typeof v === "bigint" ? v.toString() : v).slice(0, 400));
