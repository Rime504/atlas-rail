# Integrate Atlas Rail

Devnet only. A signed mandate says what the voucher signer may spend. The caller passes that mandate through `atlasrails`. The package asks `POST /v1/channel-voucher`. The API runs the spend through the gate and asks the signer to sign the 50-byte voucher only when the decision is ALLOW. A denial is not signed.

The amount the gate scores is the increment, cumulative voucher amount minus the channel watermark.

## 1. Call the package

Install and build from this repo. The packages are not on npm, and `atlasrails` depends on the other `@atlas-rail/*` workspace packages.

```bash
pnpm install
pnpm --filter atlasrails build
```

Fill `.env` from `.env.example`, start the API and the signer, and run `examples/atlasrails-pay/agent-payment.ts`. That script uses the session helpers: `loadEnv`, `importFunder`, `connect`, `init`, `beginPayment`, `createVoucherKey`, `buildSignedMandate`, `depositUpfront`, `createVoucher`, `settleChannel`, `payPayee`, and `withdrawRemainder`.

The client to build on is `createAtlasRail`. It creates the on-chain mandate, opens the escrow, requests a voucher, and settles only after `onApprove` returns true when `execution` is `requireApproval`. `openChannel`, `pay`, `refundRemainder`, and `revokeMandate` are on that client. The sample is in the repository [README](../README.md). The field list is [`packages/atlasrails/MANUAL.md`](../packages/atlasrails/MANUAL.md).

Every amount, URL, seed, and path is an argument or an environment variable. The manual is [`packages/atlasrails/MANUAL.md`](../packages/atlasrails/MANUAL.md). A missing field throws before a transaction is sent.

`importFunder` copies `DEMO_FUNDER_SECRET_KEY`. It does not generate a wallet. `init` generates the payee key when its file is missing. `createVoucherKey` asks the signer for a new key for that mandate id.

## 2. Playground and the channel scripts

```bash
pnpm --filter @atlas-rail/playground dev
```

Open `http://localhost:3200/mandate` to connect Phantom, create the mandate, open the escrow, pay, and refund. `http://localhost:3200/demo` is the older scripted channel page. See [`DEMO.md`](DEMO.md) and [`apps/playground/MANDATE.md`](../apps/playground/MANDATE.md).

The connected address must match the key file at `ATLAS_FUNDER_KEY_PATH`. That file is how the page learns the fee-payer address. The payment itself loads `DEMO_FUNDER_SECRET_KEY`.

From the repo root, with the same environment:

```bash
node scripts/channel-voucher-devnet.mjs <fee-payer-address>
node scripts/channel-voucher-anchor.mjs
```

`channel-voucher-devnet.mjs` re-exports `packages/atlasrails/payment.mjs`. That module opens a channel on `CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX`, refuses an unsigned request for `ATLAS_DENIED_RECIPIENT`, signs one allowed voucher, and submits `settle`, `distribute`, and `withdraw_payer`. `refundRemainder` on `createAtlasRail` also closes the escrow and, after 1,500 slots, sends `reclaim`. `channel-voucher-anchor.mjs` reads `reports/channel-voucher-devnet.json` and anchors the receipt with `anchor_root` on the mandate program `CnGoTE5Bxc8MFGaeK5LDv5uAZ7pNiktMunYy8JZcLY4k`.

The signer checks a gate authorisation for the exact voucher bytes, then signs with the mandate's voucher key. `apps/signer` exposes the key as `POST /v1/voucher-key` and the signature as `POST /v1/sign-voucher`. The package calls `POST /v1/channel-voucher` on the API, and the API calls the signer.

## 3. Verify a payment

Anyone can check a devnet payment, with no account:

- **In a browser:** [atlas-rail-playground.vercel.app/verify](https://atlas-rail-playground.vercel.app/verify), paste the transaction signature.
- **In a terminal:**

  ```bash
  pnpm turbo run build --filter=@atlas-rail/cli...
  node apps/cli/dist/main.js verify --tx <signature> --trusted-key <instance-public-key>
  ```

  Exit code 0 means PROVEN, 1 means NO PROOF or INVALID.

- **In code** (`@atlas-rail/receipt`):

  ```ts
  import { provePayment } from '@atlas-rail/receipt';
  import { Web3ChainClient } from '@atlas-rail/solana';

  const proof = await provePayment(signature, {
    chain: Web3ChainClient.fromUrl('https://api.devnet.solana.com'),
    loadReceipt: async (id) => {
      const res = await fetch(`https://atlas-rail-playground.vercel.app/api/receipts/${id}`);
      return res.ok ? res.json() : null;
    },
  });
  console.log(proof.verdict); // PROVEN | NO_PROOF | INVALID | NOT_FOUND
  ```

For a voucher settlement the memo names the receipt (`atlasrail:receipt:<id>`). The verifier loads that receipt, checks that it names this transaction, and re-runs the mandate signatures, the gate decision, the on-chain settlement, and the Merkle proof against the `anchor_root` account.

The packages are not published to npm yet; use them from this repository.
