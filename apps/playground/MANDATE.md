# Atlas Mandate (playground)

Owner flow: connect Phantom on Devnet, fill the form, review, then sign `create_mandate` on program `CnGoTE5Bxc8MFGaeK5LDv5uAZ7pNiktMunYy8JZcLY4k`. After confirmation the page shows the mandate PDA, the transaction signature, a Devnet explorer link, copy, and a JSON download. The same page opens the escrow, pays the generated payee, and refunds the remainder. Refund now and Revoke and seal use the payee key, so an already-signed voucher cannot settle during grace. Open rejects a grace under 900 seconds. The page does not call `anchor_root`. That call is `atlas.anchorRoot` in `packages/atlasrails`. See [SDK.md](../../packages/atlasrails/SDK.md).

```bash
pnpm --filter @atlas-rail/playground dev
# http://localhost:3200/mandate
```

The browser never imports `@atlas-rail/solana` (that package reads `fs`). Transaction bytes are built by:

- `POST /api/mandate/prepare` for `create_mandate` and `revoke_mandate`
- `GET /api/mandate/account?address=` to decode the account after confirmation

Public config only: Devnet RPC `https://api.devnet.solana.com`, the program id above, and the Devnet USDC mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`. Do not put signer tokens or voucher secrets in client env.

`create_mandate` needs three distinct signers. Phantom is the owner and pays the fee. The page generates the approver and agent keys in the session and can download those secret files. It does not ask for a seed phrase. Recipients, resource URLs, and the label are in the JSON export under `off_chain`. The program does not store them. The gate enforces them.

A confirmed Devnet create, escrow deposit, deny, allow, settle, and anchor from the package is recorded in `reports/devnet-mandate-package-2026-10-20.json`.
