import { JsonRpcClient } from "./rpc.ts";
import type { Address, ClaimRelayStatus, Hex, RpcUserOperationV07, UserOperationGasEstimate, UserOperationReceipt } from "./types.ts";
import { assertRpcUserOperationV07, assertUserOperationHash, isUserOperationHash } from "./types.ts";

export interface BundlerReceiptResult {
  userOpHash: Hex;
  receipt: UserOperationReceipt | null;
}

export class SelfHostedBundlerClient {
  readonly rpc: JsonRpcClient;

  constructor(url: string, timeoutMs = 15_000) {
    this.rpc = new JsonRpcClient(url, { timeoutMs });
  }

  async chainId(): Promise<number> {
    const value = await this.rpc.request<Hex>("eth_chainId");
    return Number(BigInt(value));
  }

  async supportedEntryPoints(): Promise<Address[]> {
    const values = await this.rpc.request<unknown>("eth_supportedEntryPoints");
    if (!Array.isArray(values) || !values.every((value) => typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value))) {
      throw new Error("bundler returned an invalid eth_supportedEntryPoints response");
    }
    return values.map((value) => value.toLowerCase() as Address);
  }

  async estimateUserOperationGas(userOperation: RpcUserOperationV07, entryPoint: Address): Promise<UserOperationGasEstimate> {
    assertRpcUserOperationV07(userOperation);
    return this.rpc.request<UserOperationGasEstimate>("eth_estimateUserOperationGas", [userOperation, entryPoint]);
  }

  async sendUserOperation(userOperation: RpcUserOperationV07, entryPoint: Address): Promise<Hex> {
    assertRpcUserOperationV07(userOperation);
    if (userOperation.signature === "0x") throw new Error("cannot submit an unsigned UserOperation");
    const value = await this.rpc.request<unknown>("eth_sendUserOperation", [userOperation, entryPoint]);
    assertUserOperationHash(value, "bundler userOperationHash");
    return value;
  }

  async getUserOperationByHash(userOperationHash: Hex): Promise<unknown | null> {
    assertUserOperationHash(userOperationHash);
    return this.rpc.request<unknown | null>("eth_getUserOperationByHash", [userOperationHash]);
  }

  async getUserOperationReceipt(userOperationHash: Hex): Promise<UserOperationReceipt | null> {
    assertUserOperationHash(userOperationHash);
    return this.rpc.request<UserOperationReceipt | null>("eth_getUserOperationReceipt", [userOperationHash]);
  }

  async claimStatus(userOperationHash: Hex): Promise<ClaimRelayStatus> {
    const receipt = await this.getUserOperationReceipt(userOperationHash);
    if (!receipt) return { userOperationHash, status: "pending" };
    return {
      userOperationHash,
      status: receipt.success ? "confirmed" : "failed",
      success: receipt.success,
      transactionHash: receipt.receipt.transactionHash,
      blockNumber: receipt.receipt.blockNumber,
    };
  }

  async requireEntryPoint(entryPoint: Address): Promise<void> {
    const supported = await this.supportedEntryPoints();
    if (!supported.includes(entryPoint.toLowerCase() as Address)) {
      throw new Error("private bundler does not advertise the configured EntryPoint");
    }
  }
}

export function assertUserOperationHashValue(value: unknown): asserts value is Hex {
  if (!isUserOperationHash(value)) throw new Error("bundler returned an invalid UserOperation hash");
}
