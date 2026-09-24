import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import type { OkxEcdsaMessageSigner } from "../relayer/okx.ts";

/**
 * Creates the short-lived signer adapter needed by the existing OKX builder.
 * The private key is captured in memory only; callers must drop the adapter
 * immediately after the UserOperation is built.
 */
export function receiverSignerFromPrivateKey(privateKey: Hex): OkxEcdsaMessageSigner {
  const account = privateKeyToAccount(privateKey);
  return {
    address: account.address,
    signMessage: ({ message }) => account.signMessage({ message }),
  };
}
