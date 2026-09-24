# Convey project memory

- The product is named **Convey**. Its former name, Ticker, is retired. Use Convey in package names, APIs, documentation, and product copy.
- Convey gifts tokenized real-world assets on X Layer mainnet (chain ID 196). Read `HANDOFF.md`, `PROGRESS.md`, and `docs/verification.md` before advancing the build.
- The selected receiver account is the deployed OKX Smart Wallet at ERC-4337 EntryPoint v0.7. Its inspected implementation is modular but does not implement ERC-7579; describe it accurately.
- The private claim route uses Convey's gateway and OKBund with NodeFlare as the execution RPC. A live sponsored mainnet UserOperation is required before product escrow contracts begin.
- Record live verification evidence and transaction hashes. Never substitute mock prices, balances, sponsorship, or claim flows.
- The operator supplied a Lightsail VPS. Read the `Supplied Lightsail VPS` section in `HANDOFF.md` and use that host and its existing ignored SSH key before asking for server details or proposing another server. Never expose or commit the key contents.
