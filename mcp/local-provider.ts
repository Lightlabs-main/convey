import { toHex, zeroAddress, type Address, type EIP1193Provider, type Hex, type LocalAccount, type PublicClient, type TransactionSerializable } from "viem";

const XLAYER_CHAIN_ID = 196;

type RpcRequest = { method: string; params?: unknown };

function optionalBigint(value: unknown): bigint | undefined {
  return typeof value === "string" || typeof value === "number" || typeof value === "bigint" ? BigInt(value) : undefined;
}

/**
 * A minimal EIP-1193 provider for an agent-held key, so the MCP server can reuse
 * the browser sender SDK unchanged. Transactions are signed locally and sent as
 * raw transactions. The nonce is tracked here because load-balanced X Layer RPC
 * nodes can briefly return a stale pending nonce right after a receipt.
 *
 * With no account, the provider is watch-only: reads work and sends are refused.
 */
export function localAccountProvider(publicClient: PublicClient, account?: LocalAccount): EIP1193Provider {
  let nextNonce: number | undefined;
  const address: Address = account?.address ?? zeroAddress;

  async function sendTransaction(transaction: Record<string, unknown>): Promise<Hex> {
    if (!account) throw new Error("No agent wallet is configured. Set CONVEY_AGENT_PRIVATE_KEY to send gifts.");
    const from = typeof transaction.from === "string" ? transaction.from.toLowerCase() : address.toLowerCase();
    if (from !== address.toLowerCase()) throw new Error("transaction sender does not match the agent wallet");
    const pending = await publicClient.getTransactionCount({ address, blockTag: "pending" });
    const nonce = Math.max(pending, nextNonce ?? 0);
    const prepared = await publicClient.prepareTransactionRequest({
      account,
      chain: publicClient.chain,
      to: transaction.to as Address,
      data: transaction.data as Hex | undefined,
      value: optionalBigint(transaction.value),
      gas: optionalBigint(transaction.gas),
      nonce,
    });
    const hash = await publicClient.sendRawTransaction({ serializedTransaction: await account.signTransaction(prepared as TransactionSerializable) });
    nextNonce = nonce + 1;
    return hash;
  }

  const provider = {
    async request({ method, params }: RpcRequest) {
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return [address];
        case "eth_chainId":
          return toHex(XLAYER_CHAIN_ID);
        case "eth_sendTransaction":
          return sendTransaction((params as Record<string, unknown>[])[0]);
        default:
          return publicClient.request({ method, params } as never);
      }
    },
    on() {},
    removeListener() {},
  };
  return provider as unknown as EIP1193Provider;
}
