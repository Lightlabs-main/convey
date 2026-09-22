import { privateKeyToAccount } from "viem/accounts";

const slots = [
  "BUNDLER_PRIVATE_KEY",
  "DEPLOYER_PRIVATE_KEY",
  "PAYMASTER_SIGNER_PRIVATE_KEY",
  "SMART_ACCOUNT_OWNER_PRIVATE_KEY",
] as const;

const privateKeyPattern = /^0x[0-9a-fA-F]{64}$/;
let bundlerConfigured = false;

for (const name of slots) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.log(`${name}: not configured`);
    continue;
  }
  if (!privateKeyPattern.test(value)) throw new Error(`${name} must be a 32-byte hex private key`);
  const account = privateKeyToAccount(value as `0x${string}`);
  console.log(`${name}: ${account.address}`);
  if (name === "BUNDLER_PRIVATE_KEY") bundlerConfigured = true;
}

if (!bundlerConfigured) {
  console.error("BUNDLER_PRIVATE_KEY is required before the bundler address can be funded");
  process.exitCode = 1;
}
