# atlasrails

`atlasrails` is the package a caller uses to pay on Solana Devnet through an Atlas Rail channel.

There are two ways in. `createAtlasRail` is the one to build on. It creates and revokes the on-chain mandate, opens the escrow, asks for a voucher, settles, pays the payee, and refunds the leftover under an execution policy you set. The script helpers (`beginPayment`, `depositUpfront`, `settleChannel`, and the rest) remain for `examples/atlasrails-pay/agent-payment.ts` and the older demo scripts.

The method table, the 20 October Devnet signatures, and the trust boundary are in [SDK.md](./SDK.md).

The channel program id is `CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX`. The mandate program id is `CnGoTE5Bxc8MFGaeK5LDv5uAZ7pNiktMunYy8JZcLY4k`. You do not pass those. Both are already on Devnet. This package does not deploy or upgrade them.

## Install

From the repo root:

```bash
pnpm install
pnpm --filter atlasrails build
```

`atlasrails` depends on the other `@atlas-rail/*` workspace packages. Inside this repo, `workspace:*` resolves them. The package is not on npm. A lone `npm install atlasrails` cannot resolve those dependencies until they are published too.

Node.js 22 or newer, and pnpm 9.

## What has to be running

`pnpm install` does not start a server. A payment that uses the HTTP voucher path needs three addresses. Set them in `.env` or on the call. If one is missing, or nothing is listening, the call throws before a transaction is sent.

`SOLANA_RPC_URL` is a Solana node. Use the public Devnet node. You do not run this yourself.

```bash
SOLANA_RPC_URL=https://api.devnet.solana.com
```

The client checks the genesis hash `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`. A mainnet URL fails that check.

`ATLAS_API_URL` is `apps/api`. The voucher request is `POST /v1/channel-voucher`. The API runs the gate. A failed check returns no signature. A passed check asks the signer to sign. On this machine:

```bash
ATLAS_API_URL=http://127.0.0.1:3001
```

`ATLAS_SIGNER_URL` is `apps/signer`. `POST /v1/voucher-key` creates the voucher key for a mandate and keeps the secret in the signer's file. The caller receives the public key.

```bash
ATLAS_SIGNER_URL=http://127.0.0.1:3012
```

`127.0.0.1` works when both processes are on the same machine as the script. Start them from the repo root and leave that command running:

```bash
node scripts/launch-voucher-services.mjs both
```

If they already run somewhere else, put those addresses in `ATLAS_API_URL` and `ATLAS_SIGNER_URL`. The package does not start them.

The agent key lives in the signer. `signerAgent({ signerUrl, mandateId })` mints it for one mandate and returns its public key. It signs the mandate acceptance and co-signs `create_mandate`, and the secret never enters your process. `gate` on `createAtlasRail` is the key that signs receipts and `anchor_root`. It must not be the API instance key the signer trusts, so it cannot approve a voucher.

Passing both `agent` and `gate` keypairs skips the HTTP voucher path and signs vouchers in process. That process then holds the agent key and can approve its own payments. Use it only in tests.

The fee payer needs Devnet SOL for rent and fees. `ATLAS_DEPOSIT` is not that SOL.

## Environment

Put the values in `.env` at the repo root. Do not commit that file. `.env.example` lists the names. `loadEnv({ path })` reads the file and sets any variable that is not already in the process environment. It does not print the values.

| Variable | What it is |
| --- | --- |
| `DEMO_FUNDER_SECRET_KEY` | Your wallet secret, a JSON byte array or a base58 string. `importFunder` copies it. |
| `ATLAS_FUNDER_KEY_PATH` | Where that wallet is stored, for example `.demo/atlasrails-funder.json`. |
| `ATLAS_PAYEE_KEY_PATH` | Where the payee key is stored. `init` creates it when the file is missing. |
| `ATLAS_ORGANIZATION_ID` | Organization id on the mandate. |
| `ATLAS_ISSUER_NAME` | Issuer name on the mandate. |
| `ATLAS_RESOURCE` | Resource pattern the mandate allows. |
| `ATLAS_RESOURCE_URL` | Exact resource URL for this payment. |
| `ATLAS_DEPOSIT` | Upfront lock, in token base units. |
| `ATLAS_SETTLED` | Cumulative amount the voucher pays. Must be less than or equal to the deposit, and strictly above the channel watermark. |
| `ATLAS_MAX_PER_PAYMENT` | Cap for one payment, base units. |
| `ATLAS_MAX_PER_WINDOW` | Cap inside one window, base units. |
| `ATLAS_WINDOW_SECONDS` | Length of that window. |
| `ATLAS_MAX_TOTAL` | Cap across the mandate, base units. |
| `ATLAS_THRESHOLD` | Spend above this needs the extra approval, base units. Cannot exceed `ATLAS_MAX_PER_PAYMENT`. |
| `ATLAS_APPROVAL_TTL_SECONDS` | How long an approval stays valid. |
| `ATLAS_REQUIRED_APPROVALS` | How many approvals the mandate document requires. |
| `ATLAS_VALID_AFTER_SECONDS` | Mandate `notBefore` is now minus this many seconds. |
| `ATLAS_VALID_FOR_SECONDS` | Mandate `expiresAt` is now plus this many seconds. |
| `ATLAS_VOUCHER_TTL_SECONDS` | Voucher expiry is now plus this many seconds. |
| `ATLAS_GRACE_SECONDS` | Grace stored on the channel at open. `0` is rejected. Use at least `900` when an x402 facilitator will touch the channel. |
| `ATLAS_CHANNEL_SALT` | Salt used when the channel is opened. |
| `ATLAS_NETWORK` | Must be `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`. |
| `ATLAS_DENIED_RECIPIENT` | A public key that is not the payee. The script asks the gate to refuse this address before it signs the real voucher. |
| `ATLAS_OWNER_SEED` | 32-byte hex seed for the mandate owner signer. |
| `ATLAS_APPROVER_SEED` | 32-byte hex seed for the approver signer. |
| `ATLAS_INSTANCE_SEED` | 32-byte hex seed for the gate instance signer. |
| `ATLAS_API_URL` | Atlas Rail API. |
| `ATLAS_SIGNER_URL` | Signer that mints the voucher key and signs allowed vouchers. |
| `ATLAS_VOUCHER_TOKEN` | Shared secret for `POST /v1/channel-voucher`. The API refuses every voucher ask while it is unset. Callers send it as a bearer token. |
| `SOLANA_RPC_URL` | Solana RPC. |
| `ATLAS_ONCHAIN` | `1` makes the API read the mandate account. |
| `ATLAS_ONCHAIN_REQUIRE` | `1` with `ATLAS_ONCHAIN` denies a missing, inactive, or undecodable account. Without it, a missing account falls back to the database. An RPC error always denies. |
| `ATLAS_ANCHOR_ROOT` | `1` with `ATLAS_ONCHAIN` makes the API worker anchor with `anchor_root`. |

A missing payment field throws `${name} is required` before a transaction is sent. The script helper throws `settled is above the deposit` when the settled amount is larger than the deposit.

Do not put seed phrases or secret keys in logs, reports, or chat.

## Keys

`importFunder({ path, envFile })` reads `DEMO_FUNDER_SECRET_KEY` and writes the 64-byte secret to `path` when that file is missing or holds a different public key. It does not generate a wallet. The return value is the public key.

`keypairWallet({ path })` is the `WalletSigner` for that file: `{ publicKey, signTransaction }`. It does not expose `secretKey`. Use it as `wallet` on `createAtlasRail`. Phantom can be adapted to the same shape. The browser page does that. This package does not import Phantom.

`init({ path })` writes a new keypair when `path` does not exist, and returns the same public key on later calls. The example uses this for the payee.

`createVoucherKey(session)` asks the signer to mint a key for this mandate. The signer keeps it under `voucher:<mandateId>`. The same mandate id reuses that key. If a later step in `createMandateAndTransfer` throws, the package deletes that voucher key.

`keypair({ path })` returns the stored keypair so a script can sign. Do not log `secretKey`.

The script path builds the owner, approver, and instance signers from `ownerSeed`, `approverSeed`, and `instanceSeed`. Each one is 64 hex characters. Those three sign the off-chain mandate document. They are not the fee-payer file.

`createMandate` on the client is separate. It needs three `Keypair`s: owner, approver, and agent. All three must be distinct, and all three sign `create_mandate`. The fee-payer wallet pays the fee. If the owner is the fee payer, load that same secret as the owner `Keypair` and also pass `keypairWallet` for the fee.

The payee key is required for an immediate refund and for sealing a channel at revoke. Generate it and store it. A second browser wallet for the payee is rejected by `withdrawRemainder` on the script path. The client `refundRemainder({ payee })` signs with the `Keypair` you pass and uses the fee-payer wallet for the fee.

## Script helpers

Import them from `atlasrails`. Run them in this order, and pass the session from `beginPayment` into every later call. This is the path `examples/atlasrails-pay/agent-payment.ts` uses.

1. `loadEnv({ path })` reads `.env`.
2. `importFunder({ path, envFile })` stores your wallet.
3. `connect({ path, rpcUrl })` opens a confirmed connection for that wallet.
4. `init({ path })` creates the payee key file when it is missing.
5. `beginPayment(payment)` checks the fields and starts the session. The mandate id and nonce are new on each call.
6. `createVoucherKey(session)` mints the voucher signer. Returns `{ mandateId, publicKey }`.
7. `createDemoMint(session)` creates a demo mint. This is opt-in. Skip it when you already have a mint, and call `fundChannel(session, mint, wallet)` instead. `wallet` is a `WalletSigner`. It checks the token program, the payer token account, and the balance, and does not mint. A Token-2022 mint is rejected. The Devnet address `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` is not mainnet USDC. The wallet pays the fee for a missing payee or treasury token account, then pays the fee for the channel open. An account that already exists is left alone. If the open fails after the accounts are created, call `fundChannel` again. Wallet rejection throws the wallet's error and does not submit.
8. `buildSignedMandate(session)` signs the off-chain mandate. The mint must already be set. Returns `{ mandateId, publicKey, mint }`.
9. `depositUpfront(session)` locks `deposit` in the channel. It mints supply only after `createDemoMint`. Returns `{ channel, deposit, openSignature }`.
10. `createVoucher(session)` asks the API to refuse `deniedRecipient`, then signs a voucher for `settled`. Returns `{ signed, messageHash }`. Changing the recipient or amount after that allow is a new request.
11. `settleChannel(session)` settles that voucher. The payer signs to pay the fee. That signature is not the voucher. Returns `{ settleSignature, receiptId }`.
12. `payPayee(session)` sends the settled amount to the payee. Returns `{ distributeSignature, payeeReceived }`.
13. `withdrawRemainder(session)` seals with the payee key and sends deposit minus settled back to the payer. Returns `{ withdrawSignature, payerRemainder }`.

`createMandateAndTransfer(payment)` runs steps 5 through 12. It still expects you to have stored the wallet. The example calls the steps itself so you can see each result.

`MandatePayment` is the object those functions take. Amounts are strings. Times, `windowSeconds`, `graceSeconds`, `approvalTtlSeconds`, and `requiredApprovals` are numbers.

`attachFundedChannel(session, expected)` checks the Devnet genesis hash and an open channel account. It sets the channel, escrow, mint, and token accounts already on that account. It does not call `createDemoMint`, `depositUpfront`, or `createVoucherKey`. `createVoucher` on that session sends a voucher only when `session.agent.publicKey` is the channel's authorized signer, the fee payer is the channel payer, and the cumulative amount is above the settled amount.

Run the example:

```bash
cd examples/atlasrails-pay
node --experimental-strip-types agent-payment.ts
```

The log prints public keys, the mandate id, the mint, the channel address, and the transaction signatures. It does not print secrets.

`sdk-prepare-only.ts` only constructs `createAtlasRail` with `execution: 'prepareOnly'` and prints the fee payer. It does not open a channel or broadcast.

## Client

```ts
import { Connection, Keypair } from '@solana/web3.js';
import { createAtlasRail, keypairWallet, signerAgent } from 'atlasrails';

const connection = new Connection(process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com', 'confirmed');
const gate = Keypair.generate(); // receipts and anchor_root; not the API instance key

const atlas = createAtlasRail({
  apiUrl: process.env.ATLAS_API_URL!,
  apiToken: process.env.ATLAS_VOUCHER_TOKEN!,
  connection,
  gate,
  wallet: keypairWallet({ path: process.env.ATLAS_FUNDER_KEY_PATH! }),
  execution: 'requireApproval',
  async onApprove(review) {
    console.log(review.stage, review.channel, review.effect, review.feeLamports);
    console.log(review.simulation.err, review.simulation.logs);
    return false;
  },
});
```

`execution` is one of:

| Policy | What happens |
| --- | --- |
| `prepareOnly` | Build and simulate. `pay()` stops after the settle simulation. This is the default for the prepare-only example. |
| `requireApproval` | `onApprove(review)` must return true, and `executeSettlement` / `executeDistribution` must be called with `{ approval: 'settle' }` or `{ approval: 'distribute' }`. `pay()` passes those tokens and still calls `onApprove`. |
| `autoExecute` | After a successful simulation, broadcasts settle and then distribute. |

`createAtlasRail` and `requestPayment` never broadcast by themselves. `submit: true` on `createMandate`, `revokeMandate`, `anchorRoot`, `openChannel`, and `refundRemainder` does broadcast, including when the policy is `prepareOnly`.

`requireOnChainMandate` defaults to true. `requestPayment` and settlement then require `mandateAddress`. The client loads that PDA and refuses a missing, revoked, inactive, wrong-agent, wrong-mint, or over-cap account before it asks for a voucher, and it checks again before it broadcasts a settlement. Pass `requireOnChainMandate: false` only when there is no on-chain mandate.

### Create the mandate

`createMandate` writes the hash, the three keys, the gate authority, the mint, the caps, `notBefore`, and `expiresAt`. The PDA seed is `["mandate", mandate_hash]`. Recipients, resource URLs, and the UI label are not stored. Put them on the off-chain mandate document so the gate can read them.

`mandateHash` is 32 bytes. In production that is the SHA-256 of the off-chain mandate body. `maxPerPayment`, `maxPerWindow`, `windowSeconds`, `maxTotal`, `escalationThreshold`, `notBefore`, and `expiresAt` are bigints in base units or unix seconds. `escalationThreshold` cannot exceed `maxPerPayment`.

```ts
// The agent key stays in the signer. Use agent.publicKey as the agent on the off-chain mandate,
// and agent.signMessage for its acceptance signature.
const agent = await signerAgent({ signerUrl: process.env.ATLAS_SIGNER_URL!, mandateId: mandate.id });
const now = BigInt(Math.floor(Date.now() / 1000));
const created = await atlas.createMandate({
  owner,
  approver,
  agent,
  mandateHash,
  gateAuthority: gate.publicKey.toBase58(),
  mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  maxPerPayment: 1000n,
  maxPerWindow: 10000n,
  windowSeconds: 86400n,
  maxTotal: 10000n,
  escalationThreshold: 1000n,
  notBefore: now - 60n,
  expiresAt: now + 86_400n,
  submit: true,
});
```

`submit: false` returns `{ status: 'prepared', transactionBase64 }` and sends nothing. `submit: true` waits for confirmation and returns `{ status: 'confirmed', mandatePda, signature, account }`.

`loadMandate(mandatePda)` reads the account. It does not broadcast.

### Open the escrow

`openChannel` locks `deposit` in a new channel. `agent` is the mandate agent's public key. That key becomes the channel's authorized signer. `graceSeconds` is a whole number of 1 or more. The program stores it and will not shorten it later. Use `900` or more when a facilitator that follows the x402 spec will close the channel. The website rejects anything under 900. This client rejects only `0` and negative or non-integer values, because the program accepts `1`.

```ts
const opened = await atlas.openChannel({
  payee: payee.publicKey.toBase58(),
  mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  agent: agent.publicKey,
  deposit: 10_000n,
  graceSeconds: 900,
  submit: true,
});
```

A confirmed result has `channel`, `escrow`, `deposit`, `openSignature`, and `graceSeconds`.

### Ask, approve, and pay

Build the off-chain `mandate` with the same agent, mint, caps, recipients, and resources you intend the gate to enforce. `amount` is the cumulative voucher total in base units. It must be strictly above the channel's settled watermark. The gate scores only the slice above that watermark.

```ts
const paid = await atlas.pay({
  mandate,
  channel: opened.channel,
  recipient: payee.publicKey.toBase58(),
  mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  amount: 1000n,
  resourceUrl: process.env.ATLAS_RESOURCE_URL!,
  network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
  expiresAt: Math.floor(Date.now() / 1000) + 600,
  mandateAddress: created.mandatePda,
});
```

With `requireApproval`, `pay()` does this:

1. `requestPayment` asks the gate. A denial returns `{ status: 'denied', broadcast: false }` and has no signature. An allow returns `{ status: 'voucher_ready', paymentId }` and still has not broadcast.
2. `prepareSettlement` simulates. `onApprove` sees `review.stage === 'settle'`, the effect, the fee, and the simulation logs. Return false to stop. Return true to continue.
3. `executeSettlement` broadcasts the settle transaction. The fee payer signs the fee. The voucher signature is the Ed25519 precompile, already inside the transaction.
4. `prepareDistribution` simulates the payee payment. `onApprove` runs again with `review.stage === 'distribute'`.
5. `executeDistribution` broadcasts. A paid result includes `settleSignature`, `distributeSignature`, `payeeDelta`, and `escrowAmount`.
6. `pay()` then sends one `anchor_root_v2` for every distributed receipt of this mandate that has no root yet. The gate key attests those receipts and pays the RootV2 account rent. A confirmed root is `result.anchor`. A failed root leaves the payment `paid` and sets `anchorError`.

Call the stages yourself when you want to stop between them. `executeSettlement(paymentId, { approval: 'settle' })` rejects a missing or mismatched approval token under `requireApproval`. Those stage calls do not send `anchor_root_v2`.

An amount above `maxPerPayment` or `maxTotal` fails before a voucher is requested when `mandateAddress` is set. The status is `failed` and `broadcast` is false. Under the cap, the gate still applies the recipient list, the resource, and the window. A window overrun escalates. A lifetime overrun denies.

`pay()` does not open a channel. After the tokens move it sends `anchor_root_v2` for every distributed receipt of that mandate that has no root yet. `anchorVouchers(mandatePda)` is the same batch when you settled through the stage calls. The transaction stores the root, the leaf count, the batch-header hash, and the batch-file hash, and it has no memo. The result includes `rootPda`, the account at seeds `["root", mandate, seq]`. `refundRemainder` makes that same call after a confirmed refund if any receipt is still waiting. The gate key signs and pays the rent. Under `requireApproval`, `onApprove` runs with `review.stage === 'anchor'` for that one transaction.

`atlas.anchorRoot({ submit: true })` is still there for a root you already computed.

The API worker's own batch job still needs `ATLAS_ONCHAIN=1` and `ATLAS_ANCHOR_ROOT=1`.

### Owner approval, signed by the owner's wallet

Over-limit payments are blocked unless the API has `TELEGRAM_BOT_TOKEN` and `TELEGRAM_OWNER_CHAT_ID`. With both set, a payment above the agent's own limit (escalation threshold, window budget, price tolerance, or a service that always asks) is not signed. The owner gets one Telegram message with the amount, recipient, agent and reason. Telegram only notifies; it cannot approve. `pay()` returns `status: 'denied'` with `reason` and `approvalId`.

To approve, the owner's or an approver's wallet signs that exact payment:

1. `GET /v1/owner-approvals/:approvalId` returns `message`, the exact text to sign (approval id, mandate hash, amount, recipient, request hash, offer hash, expiry), and `signers`, the keys allowed to sign.
2. The wallet signs `message` as UTF-8 bytes (Ed25519, as Phantom's `signMessage` does).
3. `POST /v1/owner-approvals/:approvalId/signature` with `{ "scheme": "ed25519", "signer", "signature" }` in base58.

Then call `pay()` again with the same fields and `approvalId`. That approval covers this exact voucher (same channel, total and expiry) once. It never changes the mandate. Only the mandate's `OWNER` and `APPROVER` keys can sign, and only for roles listed in `escalation.approverRoles`; the agent's key is always refused. A different amount, a reused approval, or no signature before the mandate's `approvalTtlSeconds` is refused. The gate checks the signature again, and the signed decision, and so the receipt, carries it; `atlas verify` reports it as `OWNER_APPROVAL_SIGNATURE`.

`ATLAS_APPROVAL_URL`, when set, is the signing page the Telegram message links to (the id is appended).

### Refund

`refundRemainder` returns deposit minus settled to the payer, then closes the token escrow. The channel account remains until 1,500 slots after `open`. The next call after `reclaimAfterSlot` sends `reclaim` and returns that account's SOL rent.

Pass the payee `Keypair` while the channel is still open. The client sends `settle_and_seal`, `withdraw`, and a sealed `distribute` that closes the token escrow. The remainder moves without waiting for grace. The channel is sealed, so a normal settle of an already-signed voucher fails, and a later `settle_and_seal` of that voucher fails too. The result is `rent_pending` with `reclaimAfterSlot`. Call `refundRemainder` again after that slot. That call sends `reclaim`.

Omit the payee key and the client sends `request_close` when the wallet is the payer. The result is `{ status: 'waiting' | 'closing', graceEndsAt }`. Call `refundRemainder` again after `graceEndsAt`. The second call sends `seal`, `withdraw`, and the sealed `distribute`. During that wait the payee can still submit an already-signed voucher with `settle_and_seal`. The payment program has no mandate account, so that wait cannot be removed without upgrading that program. The channel rent still waits for `reclaim`.

```ts
const refunded = await atlas.refundRemainder({
  channel: opened.channel,
  payee,
  submit: true,
});
```

A `refunded` result has `signatures`, `payerDelta`, and `escrowAmount`.

### Revoke

`revokeMandate` needs the owner or the approver. It can run once.

```ts
await atlas.revokeMandate({
  mandatePda: created.mandatePda,
  authority: owner,
  channel: opened.channel,
  payee,
  submit: true,
});
```

With `channel` and a matching `payee`, the client seals the channel immediately after the revoke confirms. With `channel` and no payee key, the payer sends `request_close` and the grace window remains. A wallet that is not the channel payer gets `closeError` and does not close the channel.

The recovery channel and the saved evidence channel are refused by this close path. Do not point a refund at them.

## Website

```bash
pnpm --filter @atlas-rail/playground dev
```

Open `http://localhost:3200/mandate`. Connect Phantom on Devnet. Generate the approver, agent, and payee keys on the page and download the secrets. Review the form, then sign `create_mandate`. Phantom is the owner and the fee payer.

After the account is confirmed, the page shows deposit, grace seconds, and a payment amount. Grace defaults to 900 and the page API rejects a smaller grace. Open escrow, Pay, and Refund now call `POST /api/mandate/channel`. Pay checks the on-chain mandate and the recipient list, signs the 50-byte voucher with the session agent key, and returns a settle transaction and a distribute transaction for Phantom to fee-pay. Refund now and Revoke and seal use the session payee key, so the channel is sealed before the grace wait.

The page does not call `anchorRoot`. The browser bundle must not import `@atlas-rail/solana` or the `atlasrails` package index. Those load files from disk. The Node routes do that work.

`http://localhost:3200/fund` is the deposit page. It adapts `window.solana` to `WalletSigner` and calls `fundChannel`. It reads the Devnet genesis hash before it shows a review.

## Amounts

`ATLAS_DEPOSIT` and `ATLAS_SETTLED` are base units of the token, with 6 decimals on the Devnet USDC mint used in the recorded runs. `10000` is 0.01 of that token. It is not 10,000 lamports and it is not SOL. SOL leaves the fee payer for account rent and transaction fees.

With deposit `10000` and a settled cumulative amount of `1000`, the payee receives `1000` and the payer gets `9000` back when the refund completes.

## What is enforced where

The mandate account stores the owner, approver, agent, gate authority, mint, caps, window, expiry, and revoked flag. `create_mandate` requires the three signatures. `revoke_mandate` requires the owner or the approver, once. `anchor_root` requires the gate authority.

The gate, before any voucher signature, checks revoke, expiry, network, mint, recipient, resource, `maxPerPayment`, the window budget, and `maxTotal`. Recipients and resources exist only on the off-chain document and in that gate.

The channel program verifies the Ed25519 voucher, the channel status, and the watermark. It does not read the mandate account. This client refuses to broadcast a settlement when the channel is not open, and it rechecks the mandate account before that broadcast. A process that submits the signed voucher bytes directly can still settle them until the channel is sealed.

## Repeat a Devnet proof

These scripts send transactions only with `--execute`. Without that flag they exit and send nothing.

```bash
node scripts/devnet-mandate-package.mjs --execute
node scripts/devnet-client-open-refund.mjs --execute
```

Do not point them at the recovery channel or the saved evidence channel. The reports under `reports/devnet-*-2026-10-20.json` are the runs already recorded. Re-running the package script overwrites `reports/devnet-mandate-package-2026-10-20.json` when that is still the default output path.
