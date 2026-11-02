# Payment-channels client-mode prototype

The caller package is now `createAtlasRail` in `packages/atlasrails`. Setup, approval, open, pay, and refund are in [`packages/atlasrails/MANUAL.md`](../packages/atlasrails/MANUAL.md). The 20 October 2026 Devnet runs are `reports/devnet-mandate-package-2026-10-20.json` and `reports/devnet-client-open-refund-2026-10-20.json`. The notes below are the earlier prototype record.

Atlas Rail signs x402 Payment Channels vouchers only after the existing mandate gate allows the spend. This is a local prototype on a feature branch. It does not deploy a program and does not change the live site.

Client mode here is SVM `batch-settlement` with `voucherSigner` omitted or `"client"`. The channel `authorized_signer` is the Atlas Rail key (`payerAuthorizer`). SVM `upto` is a different mode: the server `receiverAuthorizer` signs the voucher and the client only signs `open`.

## What was verified

Devnet account `CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX` (RPC `getAccountInfo` on `https://api.devnet.solana.com`, slot 511483191):

| Field | Value |
|---|---|
| Owner | `BPFLoaderUpgradeab1e11111111111111111111111` |
| Executable | true |
| Program data | `CghQXkmw2F6p1exMETiZdNeUx9QGraWsNZ4eom1Cuiw1` |
| Program data length | 66285 bytes |
| Last deploy slot | 480232051 |
| Upgrade authority | `4zTeC5mVqWLruDexgU2mV66p9t5vCA9JyiZqdGDUspap` |

`solana program show` later read the same account from `D:\vendor\solana-cli`. The account exists, and the settlement transaction below was accepted by that deployed program. The deployed ELF was not compared with a local build: `just build-devnet` refuses to compile while `TREASURY_OWNER` in `program/payment_channels/src/constants.rs` is still the `0xBEEF` placeholder. No program was deployed from this prototype.

The voucher message is the 50-byte layout in the payment-channels README and `typescript/packages/mechanisms/svm/src/payment-channels/voucher.ts`: magic `56 01`, 32-byte channel id, `u64` LE cumulative amount, `i64` LE `expires_at`.

`pnpm demo:rehearse` completed with every scene passing before this adapter was treated as done.

## Layout

- `packages/x402-client/src/voucher.ts` — encodes the 50 bytes, calls `evaluateGate`, and binds `GateAuthorization.txMessageHash` to SHA-256 of those bytes. The gate sees the delta above the channel watermark. An ALLOW reserves that delta before the first await. A later request on the same channel sees it. A request already queued on that channel does not. `MAX_PER_PAYMENT` / `MAX_TOTAL` / `WINDOW_BUDGET` apply to that new spend. `requireSimulation` stays false only on this path; the exact-scheme rule still requires one SPL transfer. The watermark limit below still applies.
- `GatedSignerAdapter.signVoucherWithAuthorization` — rejects anything that is not 50 bytes of magic `V\x01`, then runs `verifyGateAuthorization` before `signMessage`. `signMessage` on its own still refuses voucher bytes.
- `POST /v1/sign-voucher` on `apps/signer` — same check. The agent gets the URL, not the key.
- A denial is a signed DENY decision (`proveBlockedAttempt`). `buildReceipt` still throws for non-ALLOW decisions.
- An allow can be wrapped with `recordAllowedReceipt` and anchored with the existing `AnchorService` `mode: 'root'` (`ATLAS_ONCHAIN` + `ATLAS_ANCHOR_ROOT` in the API/worker). The voucher test calls that service against a mocked mandate account; it does not only set the env vars.

## Run the offline proof

```bash
pnpm test
```

On 2026-10-16, after the in-process voucher reservation, `pnpm test` was 46 files passed, 500 tests passed, 1 skipped. The voucher file covers allow, unapproved recipient, over-budget, the cumulative watermark, an understated on-chain watermark when a reader is set, expired, non-monotonic, stale authorisation, repeated bytes, raw `signMessage` bypass, no receipt on DENY, one mocked `anchor_root` batch, and the concurrent reservation cases below. The signer accepts a voucher only when it is exactly 50 bytes beginning `56 01` and the authorisation's `txMessageHash` is SHA-256 of those bytes. A tampered message, a missing authorisation, and an authorisation that is already stale at the signer are refused before a signature. In that same run `apps/mcp/src/mcp.test.ts` passed both tests, including the stdio server at `dist/main.js`, which advertises one tool, `pay(url)`. The remaining skip is the Postgres concurrency case, which runs only when a database URL is set. That case was not run: no database URL was set, and the voucher ledger was not put on Postgres. The voucher tests do exercise two authorizers sharing one in-memory ledger. These tests support the checks that were implemented. They do not establish that every possible attack is prevented, and they are not a production-security assessment.

Vitest maps `@atlas-rail/agent` to `packages/agent/src/index.ts`. The package `exports` still point at `./dist/index.js`.

## Authorization limits

- **On-chain settled watermark.** `VoucherAuthorizer` takes an injected `settledWatermark` reader and does not add an RPC client of its own. When that reader is set, the first request for a channel uses the returned settled u64. A caller-supplied settled amount below that value is rejected and is not signed. A later caller amount that disagrees with the watermark this process already accepted is rejected. The devnet and anchor scripts set the reader from `getAccountInfo`, channel data offset 20, u64 little-endian. With no reader, the first request still uses the caller-supplied amount. The reservation below is still process-local.
- **Spend memory.** The API voucher ask seeds each authorizer from the `VoucherSpend` table (window total by time, lifetime total, highest signed cumulative per channel) and records the new voucher under a Postgres advisory lock before the signature leaves the process.
- **Process-local reservation.** `VoucherBudgetLedger` reserves an allowed delta before any await, on one in-memory ledger. Requests for the same channel run one at a time. Requests for different channels can sign together, and each sees budget the other has already reserved. Two authorizers in one process share that ledger only when they are given the same object. A signing failure, a stale authorisation, or a gate denial releases that request's reservation. A signature stays charged if receipt recording fails or the caller retries: the same voucher bytes are rejected and are not signed again. This is not shared across processes. The API's Postgres advisory lock covers the existing gate service, not this voucher ledger. No cross-process test was run.

## Run one devnet settle

The caller path is `examples/atlasrails-pay/agent-payment.ts`, after `pnpm --filter atlasrails build` and with the API and signer running. The manual is `packages/atlasrails/MANUAL.md`. From the repo root the same payment is:

```bash
node scripts/channel-voucher-devnet.mjs <fee-payer-address>
```

The script re-exports `packages/atlasrails/payment.mjs`. The fee payer is `DEMO_FUNDER_SECRET_KEY`, and the address you pass has to match it. The payee, deposit, settled amount, caps, seeds, denied recipient, and service URLs come from the environment. The script mints a 6-decimal token, opens one channel for that payee, and asks the signer to mint the voucher key for the mandate. It asks the API to refuse the denied recipient, then submits Ed25519 precompile + `settle` (discriminator 2, watermark only). It then calls `distribute` (discriminator 7, empty recipient list, so the payee's implicit 10,000 bps share leaves the channel token account) and, after payee-signed `settleAndSeal` (discriminator 4, `has_voucher = 0`) moves the channel to `SEALED`, `withdrawPayer` (discriminator 8) for the unspent deposit. The report stores the voucher bytes, signature, gate decision, and receipt. It does not print secret keys.

The paragraphs below are earlier runs. Do not rerun the script only to refresh the 2026-10-16 reports.

The devnet run on 2026-10-16 used the funded CLI wallet as channel payer and rent payer, and a separate recipient as payee. Channel `7rQzEFbeUHR4SDCbUj6qyaF7obQXKR52LwGsiFqvJ1iM` has deposit 10000 and settled 10000. Settle `5A6PE6BD33tWXhw4BPcaT1WBXoLMQBdvXAb6PRMgSwAcpxQD4ZCzbsGxpf16XAJm6vzp5h4v7rXz6g8ADCVdXcuW` is finalized. The voucher bytes in that transaction hash to the hash in `reports/channel-voucher-devnet-2026-10-16.json`. That run did not call `distribute` or `withdrawPayer`.

`scripts/channel-voucher-anchor.mjs` registered the mandate and anchored one receipt for that channel. Root account `Fu9zto1sWKMTRdsVrn5nHtcJFb9rbMLw5QjJoBZmGsz5` is sequence 0, one leaf, merkle root `c0c1c6e5165f4e1e1345a512d6c562165cb4727819e3610a1a11a808d33677c7`. Anchor `BL6Ubi3oJt4mP4VpY9X8uasVYmJCYEm3M6SkeY341Y4tXrWyxZGNKF7VYjZMx41AbSEk6AbAt991NwM2gTRtQyW` is finalized. The receipt id and voucher hash match the settlement.

A later close-out on channel `4frLuPzuJndAmgWSquCJdPxzYjU4sZ5yeFk5RDfEfsWG` deposited 20000, settled cumulative 10000, distributed the payee share, and withdrew the 10000 remainder. Settle `poQF4vmHcdHV3xqSy49gENgrb9dmSJTD5k86MAkDpbZZGqBU73WEYE24u4s6B7ZXf9bBQurZYoprLhZGbtq5YF7`, distribute `XhkrtX18hNtv7SzhZPwAZimHfV2udF3WVCHeT9KAL3hYKFyPshig94sTG1McFVZEaWTqgA5fGzaqRd4HZ4XFh7a`, withdraw `FaBMgRqH9XiTfwJXtmsinsFBVCece84v5LGy2fELMUR4igP49BMUucinYrgpDAwruzCAX5B9LouAdRUr5ouNL3T`. After distribute the payout watermark was 10000 and the payee token account had received 10000. Anchor `3aZ8Bbw4baaJLQitRRoyjZ8s1RZ32CSF7Wrm4MWDXKU3xjWtTG3dibCYrFkD4v4MFeXKkCBKidbvqZ3Wj1UozpHk` is `anchor_root` on root `99CUfz9S5w7umvMZ8KR9GnTFA2izttggvX9pNbJdSD88`. An understated settled amount and an unknown recipient were both refused with no signature. The allowed voucher was signed only after the gate allowed it.

The 2026-10-16 settlement report is marked `historical` and its `receipt` is null. The anchor report is marked `reconstructed` and its `receipt` is null. Neither file contains the original receipt object. A later settle run writes `evidence: "original"` with the voucher bytes, signature, gate decision, and receipt from that run.

The unknown-recipient denial is a local gate result. It produced no signature and is not in the anchored batch. The on-chain settlement proves that the deployed Payment Channels program accepted the signed voucher under its settlement rules. It does not independently prove that Atlas Rail's off-chain policy decision was correct.

## Latency (60 local requests, channel open excluded)

No RPC and no transaction simulation. The published gate baseline (p50 351 ms, p95 1,613 ms) includes simulation; this path does not.

| Measurement | p50 | p95 |
|---|---:|---:|
| Gate | 5.6 ms | 7.4 ms |
| Signing (authorisation check + Ed25519) | 15.8 ms | 20.5 ms |
| Request to voucher | 22.6 ms | 28.0 ms |

Single observed settlement: 851 ms (submission + confirmation). That is one devnet transaction, not a p50.

Separate 1-lamport transfer, not a breakdown of the 851 ms settlement: submission 49 ms, confirmation 786 ms. Ten reads of the channel account were 48 ms p50 and 50 ms max. These are devnet timings.

## Key handling

The voucher key for this devnet run is a throwaway seed file in `.demo/` (gitignored), loaded only through `DevnetKeypairSigner`. That is not `ExternalCustodySignerAdapter`: the adapter still throws until a custody vendor is configured. The agent process only has the signer URL. Authorisations expire (default 60 seconds) and must match the voucher hash, channel bytes, and agent public key. Secrets are not logged or committed.
