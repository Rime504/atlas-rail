# Running a channel payment

Devnet only. A payment opens one channel, asks the mandate gate before anyone signs a voucher, settles the allowed voucher, pays the channel payee, withdraws the leftover, and can anchor the receipt root. Nothing here touches mainnet.

There are three ways to start that payment. `createAtlasRail` is the caller client: it creates the mandate, opens the escrow, and pays after `onApprove` when you set `requireApproval`. `examples/atlasrails-pay/agent-payment.ts` is the older script. The playground page `/mandate` connects Phantom and can open, pay, and refund. `/demo` runs the script with a fee payer fixed on this machine.

## Package

From the repo root, with the variables in `.env.example` filled in `.env`:

```bash
pnpm --filter atlasrails build
node scripts/launch-voucher-services.mjs both
cd examples/atlasrails-pay
node --experimental-strip-types agent-payment.ts
```

`agent-payment.ts` imports `atlasrails`. It stores `DEMO_FUNDER_SECRET_KEY`, connects that wallet, creates the payee key if `ATLAS_PAYEE_KEY_PATH` is missing, then calls `beginPayment`, `createVoucherKey`, `buildSignedMandate`, `depositUpfront`, `createVoucher`, `settleChannel`, `payPayee`, and `withdrawRemainder`.

The field list, the key files, and the amount units are in [`packages/atlasrails/MANUAL.md`](../packages/atlasrails/MANUAL.md). The script prints public keys and transaction signatures. It does not print secrets.

The API has to be on `ATLAS_API_URL` and the signer on `ATLAS_SIGNER_URL` before the script asks for a voucher key. `ATLAS_DEPOSIT` is token base units of a mint this run creates, with 6 decimals. SOL pays rent and fees.

## Mandate page

```bash
pnpm --filter @atlas-rail/playground dev
```

Open `http://localhost:3200/mandate`. Connect Phantom on Devnet, generate the approver, agent, and payee keys, and download the secrets. After `create_mandate` confirms, open the escrow (grace at least 900 seconds), pay, or refund now. Revoke and seal uses the payee key so an already-signed voucher cannot settle during grace. Details are in [`apps/playground/MANDATE.md`](../apps/playground/MANDATE.md).

## Playground script

From the repo root:

```bash
pnpm --filter @atlas-rail/playground dev
```

Open `http://localhost:3200/demo`.

1. Connect the devnet wallet that pays the deposit and the network fee. Phantom or Solflare, on devnet.
2. Accept the mandate limits shown on the page.
3. Pay. The page calls `POST /api/voucher-demo`, which runs `scripts/channel-voucher-devnet.mjs` and then `scripts/channel-voucher-anchor.mjs`.

The connected address has to be the public key of the key file at `ATLAS_FUNDER_KEY_PATH`. The route loads that file to learn the public key and refuses a different wallet. The payment script does not read that file. It loads `DEMO_FUNDER_SECRET_KEY`, and it still needs the payment fields in the environment. The browser wallet does not sign the voucher. The signer mints a key for the mandate through `POST /v1/voucher-key`.

The script asks the API to refuse `ATLAS_DENIED_RECIPIENT` first. That request is left unsigned. It signs the voucher for the channel payee only after the gate returns ALLOW. Settlement is an Ed25519 precompile plus `settle` on `CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX`. The same run distributes the payee share and withdraws the unspent deposit. The anchor script then registers the mandate and submits `anchor_root` on `programs/atlas-mandate`.

The last step shows the settle transaction and the root account.

## Same script from the terminal

From the repo root, with the payment environment set and the fee-payer address matching `DEMO_FUNDER_SECRET_KEY`:

```bash
node scripts/channel-voucher-devnet.mjs <fee-payer-address>
node scripts/channel-voucher-anchor.mjs
```

`scripts/channel-voucher-devnet.mjs` re-exports `packages/atlasrails/payment.mjs`. `ATLAS_FEE_PAYER` is the same check as the argument. The first script writes `reports/channel-voucher-devnet.json`. The second reads that file, checks the channel account, and writes `reports/channel-voucher-anchor.json`. Neither script prints secret keys.

## What you can check afterwards

```bash
pnpm turbo run build --filter=@atlas-rail/cli...
node apps/cli/dist/main.js verify --tx <settle-signature> --trusted-key <instance-public-key>
```

Exit code `0` means the checks passed, `1` means at least one failed, `2` means the input was unusable. Pass the instance key the run actually used. Without `--trusted-key` the instance check fails.
