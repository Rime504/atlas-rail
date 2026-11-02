# atlasrails SDK

Public client for Atlas Rail channel payments on Solana Devnet. The SDK asks the live voucher API (gate first), validates the 50-byte voucher, then prepares settlement and distribution under an explicit execution policy. It does not hold the voucher private key.

## Install

```bash
pnpm --filter atlasrails build
```

```ts
import {
  createAtlasRail,
  keypairWallet,
  AtlasRailError,
  verifySavedE2eEvidence,
} from 'atlasrails';
import { Connection } from '@solana/web3.js';
```

## Trust boundary

| Layer | Responsibility |
| --- | --- |
| Atlas Rail API + `evaluateGate` | Mandate rules (recipient, caps, resource, network). Must run before any voucher signature. |
| Signer service | Holds the voucher secret (`voucher-sessions` / agent key). Signs only after gate authorization. |
| Atlas Mandate program | Stores owner/agent/mint/limits/expiry/revoked. Does **not** check recipients or settle payments. |
| Payment-channels program | Verifies Ed25519 voucher bytes, channel status, watermarks. Does **not** read the mandate account. |
| Application wallet | Fee payer only for settle/distribute. Never receives the voucher secret. |

### On-chain mandate

Program `CnGoTE5Bxc8MFGaeK5LDv5uAZ7pNiktMunYy8JZcLY4k` on Devnet. The client calls the three instructions that program already has.

| Method | Instruction | Signers | Broadcast |
| --- | --- | --- | --- |
| `loadMandate(address)` | account read | none | never |
| `createMandate({ owner, approver, agent, ... })` | `create_mandate` | owner, approver, and agent, all distinct | only with `submit: true` |
| `revokeMandate({ mandatePda, authority })` | `revoke_mandate` | owner or approver, once | only with `submit: true` |
| `anchorRoot({ mandatePda, gate, merkleRoot, leafCount })` | `anchor_root` | gate authority stored on the account | only with `submit: true` |
| `openChannel({ payee, mint, agent, deposit, graceSeconds })` | payment-channel `open` | payer wallet | only with `submit: true` |
| `refundRemainder({ channel, payee? })` | `settle_and_seal` + `withdraw` + sealed `distribute`, or `request_close` then `seal` + `withdraw` + sealed `distribute`. A later call sends `reclaim` | payee for an immediate refund; payer alone starts the grace wait. `reclaim` needs no extra signer | only with `submit: true` |

`createMandate` writes the hash, the three keys, the gate authority, the mint, the caps, `notBefore`, and `expiresAt`. The PDA seed is `["mandate", mandate_hash]`. Recipients, resource URLs, and the UI label stay off the account. `anchorRoot` reads `nextRootSeq` and writes a Root PDA. `prepareOnly` blocks settle and distribute broadcasts. It does not block `submit: true` on these calls.

`openChannel` locks the upfront deposit in a new escrow. `graceSeconds` of 0 is rejected before anything is sent. The payment program stores the grace and will not shorten it later. Pass the payee `Keypair` to `refundRemainder` while the channel is still open to return `deposit − settled` without waiting. That call also closes the token escrow. The result is `rent_pending` until `reclaimAfterSlot`, which is `open_slot + 1500`. Call it again after that slot. `reclaim` deletes the channel account and returns its SOL rent to the rent payer. Without the payee key, the method starts the payer close and returns `waiting` until the stored grace ends. Call it again after that time.

```ts
const loaded = await atlas.loadMandate(mandatePda);

await atlas.requestPayment({
  mandate,
  channel,
  recipient,
  mint,
  amount,
  resourceUrl,
  network,
  expiresAt,
  mandateAddress: mandatePda,
});
```

`requireOnChainMandate` defaults to true. A payment that omits `mandateAddress` is rejected. A missing, revoked, inactive, wrong-agent, wrong-mint, or over-cap account fails before a voucher is requested, and settlement checks the same account again before it broadcasts. Pass `requireOnChainMandate: false` only when there is no on-chain mandate.

Pass `agent` and `gate` keypairs to `createAtlasRail` to sign vouchers in process. The HTTP API is not called on that path. Omit both to keep using the voucher API.

`ATLAS_ONCHAIN=1` turns on the API's registry read. `ATLAS_ONCHAIN_REQUIRE=1` fails closed when the account is missing, inactive, or the RPC decode fails. Without `REQUIRE`, a missing account falls back to the off-chain database. This client will not broadcast settlement for a revoked mandate. Pass the channel to `revokeMandate({ ..., channel, submit: true })`. Pass the payee `Keypair` as well and the client sends `settle_and_seal` immediately, so an already-signed voucher cannot be settled during grace. Without that key, the payer sends `request_close` and the payee can still submit the voucher with `settle_and_seal` until the grace stored at open ends. The payment program has no mandate account, so that remaining window cannot be removed without upgrading it.

The owner page is `http://localhost:3200/mandate` (`pnpm --filter @atlas-rail/playground dev`). Phantom signs as the owner and the fee payer. The page generates the approver, agent, and payee keys in the browser. After the mandate is confirmed it can open the escrow, pay, refund now, and revoke and seal. Open rejects a grace under 900 seconds. Anchoring stays `anchorRoot` on this client. Setup and the approval sample are in [MANUAL.md](./MANUAL.md).

### Devnet run, 20 October 2026

`node scripts/devnet-mandate-package.mjs` refuses to send. `node scripts/devnet-mandate-package.mjs --execute` uses the funder wallet `2Qy24Ut2fDfj1SXBQbzBpvEEX8QZcStcZng6M3ravpsb`. The full record is [`reports/devnet-mandate-package-2026-10-20.json`](../../reports/devnet-mandate-package-2026-10-20.json). Genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`. Deposit 10000 base units. Cap 1000.

| Step | Result | Signature |
| --- | --- | --- |
| `create_mandate` | PDA `7RNyu1oyU85FHpLkkK23tzATGgLWPjvb7tWEkrnajZN3` | `2zjRncmYs1Yp1r9P8fwBGecMEJvWVLK1e3GzdWtrHN7qpvgi9tMXVh5vZR86XLPgK7GVvari5PGCqsz8U4VxYAts` |
| Open channel and escrow | channel `5Qy5BWbrKaQHnvdBZ7tta4x1DNgKD5zkFtQxwjSsyGrf`, escrow `3QzDYGXq5mKzocACFStR8MU32nDr9H18cCgbnPtZSyRU` | `3s7YAQnrN8fXJ1rRjjcR5NQ363YgphXxSf3Z83nPYJPdQ3LLagt1f9pz5xxkMYUt6MgvV2pV1kqhXoihSvcgTSZb` |
| 1001 to the payee | denied, no signature | |
| Unlisted recipient at 1000 | denied, no signature | |
| 500 to the payee | voucher only, not settled | message `3416a206e0480ba82230ea3414c5643c7359b1292140c98dcf61968989a61185` |
| 1000 to the payee | settled and paid. Payee delta 1000 | settle `3wrwVUqbhRwBiv39g5u82YprKLWpsyPqzBDJA3iceBUQJRWSWeDM7jQBZsx4s2YHyAf7381BcNrpPLCqMXngngsZ`, distribute `5jUhUsSkUHLzwQkciBoFKXfUKm4x51rg37XcgHUVMonVHkGFh72VE83x7aDqwhFn352TvJunVrWzyZmrFW47Ldsk` |
| `anchor_root` | receipt `rcp_0250f345fd17ea60` verified, `nextRootSeq` 1, root `779f67c064ad6a277ae8e71209daeed51dbc9af6ac81d60e79eccd48a42262f9` | `3rFfyHra4ZxFwScMDkx3cunHExqXoLoG1yGrbZZzsU6UPrGUPpKXpqK48PdK6iHpDGQqqogQGxGgkkLgJNW6pCkv` |

The voucher API on port 3001 was down, so allow and deny ran through `VoucherAuthorizer` in this package, which is the same gate the API calls. Two earlier crashes in that script opened channels `ALQzchsarCXwLe6dRctPQRk2tPSWDGUjipFq5a6V1s5a` and `8EeodLxNkFfprKB2ZwGSFrBUmrM6asJHmwKZtn5wdKj` before the agent key was saved. Those deposits are still in escrow. The recovery channel and the 20 October evidence channel `5R9dv5gj…` were not used.

`ATLAS_AGENT_SECRET_KEY`, keyring label `agent`, and `voucher:<mandateId>` in `voucher-sessions.json` are not interchangeable. The channel's on-chain `authorized_signer` must equal the key the API uses for that mandate.

## Execution policy

| Policy | Behavior |
| --- | --- |
| `prepareOnly` | Build + simulate only. `execute*` throws / returns `APPROVAL_REQUIRED`. **Default for examples.** |
| `requireApproval` | Requires `onApprove(review) => boolean` and `{ approval: 'settle' \| 'distribute' }` on execute. |
| `autoExecute` | After a successful simulation, broadcasts settle then distribute. Use only with a real wallet review path. |

The SDK never broadcasts on `createAtlasRail` or `requestPayment`.

## Lifecycle

```text
requestPayment → denied | voucher_ready
prepareSettlement → simulated | awaiting_approval
executeSettlement → partial (settled, receipt)   [policy gated]
prepareDistribution → simulated | awaiting_approval
executeDistribution → paid                       [policy gated]
pay, after paid, with the gate key → one anchor_root for this mandate
```

Statuses such as `paid` require finalized on-chain reads after broadcast. `ALLOW` or a successful simulation alone is never `paid`.

## Minimal prepare-only example

```ts
const connection = new Connection(process.env.SOLANA_RPC_URL!, 'confirmed');
const wallet = keypairWallet({ path: process.env.ATLAS_FUNDER_KEY_PATH! });

const atlas = createAtlasRail({
  apiUrl: process.env.ATLAS_API_URL!,
  connection,
  wallet,
  execution: 'prepareOnly',
});

const voucher = await atlas.requestPayment({
  mandate, // signed AgentMandate; agent.publicKey === on-chain authorized signer
  channel: process.env.ATLAS_CHANNEL!,
  recipient: process.env.ATLAS_PAYEE!,
  mint: process.env.SOLANA_USDC_MINT!,
  amount: 1000n,
  resourceUrl: process.env.ATLAS_RESOURCE_URL!,
  network: process.env.ATLAS_NETWORK!,
  expiresAt: Math.floor(Date.now() / 1000) + 600,
  feePayer: wallet.publicKey,
});

if (voucher.status === 'denied') {
  // No signature. Do not settle.
}

if (voucher.status === 'voucher_ready') {
  const review = await atlas.prepareSettlement(voucher.paymentId);
  // Inspect review.simulation; do not call executeSettlement under prepareOnly.
}
```

## Denied payments

A live gate denial returns `{ status: 'denied', hasSignature: false, broadcast: false }`. If a denial ever includes `signatureBase64`, treat it as a security failure (`GATE_DENIED`).

## Partial failure

If settlement confirms but distribution fails, the result carries `settleSignature` and `SETTLE_OK_DISTRIBUTE_FAILED`. Do not resubmit settlement. Retry `prepareDistribution` / `executeDistribution` only after checking signature status and balances.

## Receipts

After settlement, the SDK builds a bound receipt and runs `verifyReceipt`. A denied request never produces a success receipt. Simulated or unconfirmed transactions are never reported as `paid`.

## Saved Devnet evidence

```ts
import { Connection } from '@solana/web3.js';
import { verifySavedE2eEvidence } from 'atlasrails';

const check = await verifySavedE2eEvidence(
  new Connection('https://api.devnet.solana.com', 'confirmed'),
  'reports/devnet-e2e-new-channel-2026-10-20.json',
);
```

This is read-only. It does not open channels or move funds. The recovery channel `GEMPoRi8…` is out of scope.

## Clean-consumer pack (not public npm yet)

`atlasrails` is **not** published to the public npm registry. Workspace packages use `workspace:*`, so a lone `npm install atlasrails` from the registry will not work until those packages are published.

To exercise the intended install path locally:

```bash
node scripts/pack-sdk-consumer.mjs
```

That packs `atlasrails` and its `@atlas-rail/*` deps as tarballs under `.tmp/sdk-pack/`, installs them into `D:\\atlas-rail-sdk-consumer`, and runs a `prepareOnly` smoke test (deny → allow → simulate settle → refuse broadcast).

## Known limitations

- `openChannel` and `refundRemainder` are on `createAtlasRail`. Grace 0 cannot be stored. An immediate refund needs the payee key. A payer-only close waits for the grace written at open. The website open form uses a 900-second grace, the x402 facilitator minimum. The program still accepts any positive grace, including the 1-second proof.
- Does not implement a fee relayer or production KMS.
- Receipt instance attestation uses the gate key when that key is on the client. Otherwise it uses an ephemeral local key, and settlement signatures remain the on-chain evidence of payment.
- `pay()` sends one `anchor_root` after distribute when the gate key is on the client. A failed root leaves the payment `paid` and sets `anchorError`. Without that key the receipt stays on the client.
- Browser bundles must not import modules that load payer secret files; use a `WalletSigner` from the wallet adapter.
- `requireApproval` is an SDK policy hook; it is not by itself a human-reviewed, transaction-bound approval product.
- Allowed recipients, resources, and UI labels are **not** stored on the mandate account — gate-only.
- Create-mandate requires three distinct signers (owner + approver + agent); the playground generates approver/agent keys client-side for co-sign (download them; never collect seed phrases).
