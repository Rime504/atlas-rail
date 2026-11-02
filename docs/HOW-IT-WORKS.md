# How Atlas Rail works

This is the engineering read of the system on `feat/payment-channels-client-mode`. It is a devnet prototype. It is not a claim that the system is production-ready.

Atlas Rail sits in front of an AI agent's wallet. A signed mandate says what the agent may spend. A gate checks each payment against that mandate before anything is signed. A receipt binds the mandate, the offer, the decision, and the settlement. Anyone can recompute those bindings and read the Solana transaction.

The path you can run is a payment-channels voucher. `createAtlasRail` in `packages/atlasrails` creates the on-chain mandate, opens the escrow, and asks the gate before a voucher is signed. With `execution: 'requireApproval'`, settle and distribute each wait for `onApprove`. `refundRemainder` returns the leftover, closes the token escrow, and a later call sends `reclaim` to return the channel rent. Pass the payee key and it seals immediately. The script helpers in `payment.mjs` and `examples/atlasrails-pay/agent-payment.ts` still run the older session. The playground page `/mandate` does the same steps with Phantom. `/demo` still runs `scripts/channel-voucher-devnet.mjs` and then the anchor script. See [`DEMO.md`](DEMO.md) and [`packages/atlasrails/MANUAL.md`](../packages/atlasrails/MANUAL.md).

An earlier exact-scheme run saved the $40 receipt under `reports/`. That settlement was one SPL `TransferChecked`. The voucher batch is a different root. The details of the saved receipt are in section 4.

## The pieces

| Piece | Where | What it does |
|---|---|---|
| Mandate | `packages/mandate` | Owner, independent approver, and agent each sign the spending rules. |
| Gate | `evaluateGate` in `packages/mandate/src/gate.ts` | Runs the rules. Returns ALLOW, ESCALATE, or DENY. |
| Gate service | `packages/mandate/src/service/gate-service.ts` | Serialises exact-scheme payments per mandate and reserves spend. Postgres uses an advisory lock. |
| Gated signer | `packages/x402-client/src/gated-signer.ts` | Signs only bytes covered by a fresh gate authorisation. |
| Receipt | `packages/receipt` | Binds the decision to the settlement and batches receipts into a Merkle tree. |
| Mandate program | `programs/atlas-mandate`, id `CnGoTE5Bxc8MFGaeK5LDv5uAZ7pNiktMunYy8JZcLY4k` | Devnet registry: create a mandate, revoke it, `anchor_root`. |
| Payment Channels program | `CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX` | Already on devnet. This branch did not deploy it and did not compare its ELF to a local build. |

Network for the recorded runs: `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` (Solana devnet). RPC used for the reads: `https://api.devnet.solana.com`.

## 1. The mandate

A mandate is a JSON document. The owner signs it, an approver who is not the owner signs it, and the agent signs it. `verifyMandateChain` checks those signatures and that the approver is independent of the owner and the agent.

The limits that matter for the stories below:

- `maxPerPayment` — hard ceiling for one payment.
- `maxPerWindow` and `windowSeconds` — autonomous spend inside a rolling window. Going over this **escalates**. It does not hard-fail.
- `maxTotal` — lifetime cap. Going over this **denies**.
- `escalation.thresholdBaseUnits` — above this amount, a human must approve that exact offer.
- Payee and resource allowlists. An unapproved recipient is a hard denial. A human approval cannot override it.

The mandate can be registered on the mandate program. Revocation is also on that account. A transient failure to read the account is not treated as "revoked".

## 2. The gate

`evaluateGate(mandate, offer, context)` is synchronous. The offer carries the amount, mint, recipient, and resource. The context carries the clock, revocation, spend already reserved or settled, an optional simulation, and an optional human approval.

Rule results are `PASS`, `FAIL`, `ESCALATE`, `OVERRIDDEN`, or `SKIPPED`.

- Any `FAIL` makes the decision `DENY`.
- Any remaining `ESCALATE`, with no `FAIL`, makes the decision `ESCALATE`.
- If a valid approval is present for **this exact offer**, every `ESCALATE` becomes `OVERRIDDEN` and the decision is `ALLOW` with kind `APPROVED`.
- If nothing escalated, the decision is `ALLOW` with kind `AUTONOMOUS`.

A hard `FAIL` stays a denial even when an approval is attached. The test "above hard max: denied, and a human cannot override it" covers that. An approval for a different amount is rejected.

### Why a $40 payment can pass a $5 window

The demo mandate's window budget is $5 (`5000000` base units of a 6-decimal mint). The $40 inference payment is `40000000` base units. `WINDOW_BUDGET` escalates. So does `ESCALATION_THRESHOLD`. A human approval of that exact offer overrides those rules. `MAX_PER_PAYMENT` is $50 and `maxTotal` is $100, so those hard caps still pass. The recorded decision is `ALLOW` / `APPROVED`, and `WINDOW_BUDGET` is `OVERRIDDEN`.

That is the receipt `rcp_bd0d86cdc1b8c4ea09d3245fcdae53ec`.

### Exact-scheme simulation

`AgentGateService` can still simulate a transaction before ALLOW. That simulation expects one SPL `TransferChecked` that matches the offer. Concurrent requests for one mandate take `runExclusive`. In Postgres that is `pg_advisory_xact_lock`. The in-memory store uses a promise queue with the same shape. Spend is reserved on ALLOW and released only when the chain shows the payment did not land. The caller's word is not enough.

The voucher path does not use that service. It calls `evaluateGate` with `requireSimulation: false`. See section 5. The playground walkthrough no longer submits a `TransferChecked` either.

## 3. The signer

`GatedSignerAdapter.signWithAuthorization` hashes the transaction message and calls `verifyGateAuthorization`. The authorisation must be signed by a trusted instance key, name this agent, match this message hash, and still be inside its time window (the wallet default is 120 seconds; voucher authorisations in the prototype default to 60).

`signMessage` on its own refuses voucher bytes and refuses a raw transaction message. There is a separate `signVoucherWithAuthorization` for the 50-byte channel voucher. It requires magic `56 01`, length 50, and `txMessageHash` equal to SHA-256 of those exact bytes.

The agent process is meant to hold the signer URL, not the key. `apps/signer` exposes `POST /v1/sign-voucher` for the voucher path.

## 4. Receipts and what a PASS means

`buildReceipt` runs only for an ALLOW. It binds:

- mandate hash
- offer
- decision hash
- settlement transaction signature
- response hash
- issued-at timestamp

`computeReceiptHash` is the canonical hash of that binding. The instance signs it under the domain `atlasrail/v0.1/receipt`. That hash is the Merkle leaf payload. The tree leaf is `SHA-256(0x00 || receiptHash bytes)`. An interior node is `SHA-256(0x01 || left || right)`, RFC 6962 shape, in `packages/receipt/src/merkle.ts`.

`verifyReceipt` then runs, in order:

| Check | What it does |
|---|---|
| `SCHEMA` | The JSON is a bound receipt. |
| `RECEIPT_HASH` | Recomputing the binding matches the stored hash, and the embedded mandate, offer, decision, and response hashes match the documents. |
| `INSTANCE_SIGNATURE` | The instance signature matches, and the key policy below holds. |
| `MANDATE_CHAIN` | Owner, approver, and agent signatures verify. |
| `DECISION_SIGNATURE` | The decision is signed by the instance key on the decision. |
| `DECISION_MATCHES_SCOPE` | Re-running the gate on the recorded inputs reproduces the same decision and the same rule results. |
| `DECISION_ALLOWED` | The decision is ALLOW. A DENY cannot be a payment receipt. |
| `ANCHOR_MERKLE` | The leaf, the sibling list, and `position: left` or `right` recompute the receipt's Merkle root. |
| `ANCHOR_ONCHAIN` | The anchor transaction succeeded and carries that root. Needs a chain client. |
| `SETTLEMENT_ONCHAIN` | The settlement transaction has exactly one matching transfer of the offer amount and mint to the offer recipient, paid by the mandate's agent. Needs a chain client. |

`pass` is true when no check is `FAIL`. A `SKIP` does not fail the receipt. Without a chain client, the two on-chain checks are skipped.

### Trusted instance keys

The signature check has three states.

- **No `trustedInstanceKeys`.** The check fails: "Trusted instance keys must be configured." A mathematically valid signature is not enough.
- **A non-empty list.** The receipt's instance public key must be in the list, and the signature must verify for that key. Several keys may be listed. That is how a rotation is expressed: add the new key, and remove the old one when receipts it signed should stop verifying. There is no on-chain registry of instance keys.
- **`untrusted: true` and an empty list.** The signature is checked against the key inside the receipt. The message says "Untrusted verification". This is the diagnostic path. The public receipt publisher uses it and says so in `apps/api/src/agent/public-receipts.service.ts`. `atlas verify` and `provePayment` do not. The CLI flag is `--untrusted`. `--trusted-key` may be repeated.

The $40 receipt's instance key is `3tDjoLJaTAhCwxQf6veR636MLEwpukaNu9gQc48ZQer3`. That key is not hard-coded. The saved run passed it in.

A trusted key does not, by itself, prove the policy decision was right. `DECISION_MATCHES_SCOPE` reruns the rules. The on-chain settlement proves the token move. The Merkle anchor proves the receipt was in a batch. Those are separate checks.

### The $40 receipt, recomputed

Saved at `reports/receipt-40-devnet-verify.json`.

| Fact | Value |
|---|---|
| Receipt | `rcp_bd0d86cdc1b8c4ea09d3245fcdae53ec` |
| Amount | `40000000` base units |
| Decision | `ALLOW`, kind `APPROVED`, `WINDOW_BUDGET` is `OVERRIDDEN` |
| Settlement | [`4RnVyRNTcssW1kAv9dL8xjbbhF8Ft6ZGomv7Msr1NGrTSgLKjQNafDcuK3B34ZVvmHYjhkfH78xZvG5PE5RiR1rU`](https://explorer.solana.com/tx/4RnVyRNTcssW1kAv9dL8xjbbhF8Ft6ZGomv7Msr1NGrTSgLKjQNafDcuK3B34ZVvmHYjhkfH78xZvG5PE5RiR1rU?cluster=devnet), slot `508767747` |
| Payee | `J9is8n6obKxjDJos9SbK6k6Lo1YLPV8NhN6YuDfVTvd8` |
| Mint | `8Y7ymTsoAh5ceaJ3Gf6h4Zd6eAfAFeNnzYgWo6gRnNXM` |
| Payer | the mandate's agent, `6RUPuaztaMivBKYxv7w34xzrdE6azUqgZ6T3yb8oLWZy` |
| Receipt hash | `ea5f3869fe9503426a472c5c7e9da61a24f9c7b4c9e9ff3dc3ea644b1a784be4` |
| Leaf | index 1 of 2 |
| Sibling | `658e6678db4a87e682164e16563ab5b72ce718f2784bac09b338b34c5db16e9c`, `position: "left"` |
| Other leaf | `rcp_7209f61cfc97bfe550cc86d642eacedc` (the autonomous $0.01 payment) |
| Root | `8709a295b80ac8a995dbd5246545616ca9f352b135ebb24bb9e0ca6a84ca925d` |
| Anchor | [`gtP2SkfSRAGZRM22uucbkquNDpAEzZASYGuZUSZjTL7hWY1848s1A9mLRmnErfkBtW8LVB5doSnpm7XJjXZbY89`](https://explorer.solana.com/tx/gtP2SkfSRAGZRM22uucbkquNDpAEzZASYGuZUSZjTL7hWY1848s1A9mLRmnErfkBtW8LVB5doSnpm7XJjXZbY89?cluster=devnet), slot `508767753`, sequence 0 |
| Root account | `HSnGLqgDHdpc3y6pcDjvEo1YVEGK5ZvBCgAGMUxGTEPd` |
| Mandate PDA | `33sMH7vEwe1Js7ZwujZ8kGYz7f42hoaQn8hLYZJiidxb` |

Recomputing both leaves and combining them with the stored sibling direction produces that root. A later `verifyReceipt` call with a devnet chain client and this instance key pinned returned `pass: true` on every check, including settlement and `anchor_root`. The report file itself was written before trusted keys became mandatory, so its notes describe the pin as it was invoked for that run.

The anchor commits to the receipt batch. The settlement transaction proves the token transfer. Neither replaces the other.

### The other Merkle root

Do not substitute this root for the payment-channels batch.

| | $40 demo | Payment-channels prototype |
|---|---|---|
| Root | `8709a295…ca925d` | `c0c1c6e5…3677c7` |
| Anchor tx | `gtP2SkfS…` | [`BL6Ubi3oJt4mP4VpY9X8uasVYmJCYEm3M6SkeY341Y4tXrWyxZGNKF7VYjZMx41AbSEk6AbAt991NwM2gTRtQyW`](https://explorer.solana.com/tx/BL6Ubi3oJt4mP4VpY9X8uasVYmJCYEm3M6SkeY341Y4tXrWyxZGNKF7VYjZMx41AbSEk6AbAt991NwM2gTRtQyW?cluster=devnet) |
| Leaves | 2 | 1 |
| Root account | `HSnGLqgD…` | `Fu9zto1sWKMTRdsVrn5nHtcJFb9rbMLw5QjJoBZmGsz5` |
| Slot | `508767753` | `511500972` |

Both were read back from the `AnchorRoot` instruction and from the root account bytes (merkle at offset 48).

## 5. Payment Channels, client mode

SVM x402 `batch-settlement` with `voucherSigner` omitted or `"client"` means the channel's `authorized_signer` is the Atlas Rail key. SVM `upto` is a different mode: the server signs the voucher and the client only signs `open`.

The voucher is 50 bytes: magic `56 01`, 32-byte channel id, `u64` little-endian cumulative amount, `i64` little-endian expiry. Zero and past expiries are rejected.

The gate sees the increment: cumulative amount minus the channel watermark. `MAX_PER_PAYMENT`, `MAX_TOTAL`, and `WINDOW_BUDGET` apply to that increment. On one authorizer, an ALLOW reserves the increment before the first `await`. A later request on that channel sees the reservation. A request already in flight on that channel does not, because same-channel requests run one at a time through signing. Different channels can sign at the same time, and each sees budget the other has already reserved. Two `VoucherAuthorizer`s share that budget only when they are given the same `VoucherBudgetLedger`.

If the gate denies, the authorisation is stale, or signing throws before a signature exists, the reservation is rolled back. If a signature was produced, the charge stays even when receipt recording fails or the caller retries. The same voucher bytes are rejected and are not signed again.

An earlier run of the devnet script opened channel `7rQzEFbeUHR4SDCbUj6qyaF7obQXKR52LwGsiFqvJ1iM`, settled cumulative `10000`, and recorded settle [`5A6PE6BD33tWXhw4BPcaT1WBXoLMQBdvXAb6PRMgSwAcpxQD4ZCzbsGxpf16XAJm6vzp5h4v7rXz6g8ADCVdXcuW`](https://explorer.solana.com/tx/5A6PE6BD33tWXhw4BPcaT1WBXoLMQBdvXAb6PRMgSwAcpxQD4ZCzbsGxpf16XAJm6vzp5h4v7rXz6g8ADCVdXcuW?cluster=devnet). One denial in that run produced no signature and is not in the anchored batch. The on-chain settlement proves the Payment Channels program accepted the voucher under its rules. It does not prove the off-chain policy decision was correct. The current script takes the payer, payee, amounts, and seeds from the caller. It mints the voucher key through the signer instead of reading a shared seed file.

`reports/channel-voucher-devnet.json` is marked `historical` and its `receipt` is null. `reports/channel-voucher-anchor.json` is marked `reconstructed` and its `receipt` is null. The October 16 receipt object was rebuilt from the settled transaction. It is not the original object. A later settle writes `evidence: "original"` with the voucher bytes, signature, decision, and receipt from that run. Do not rerun the scripts just to refresh those files: the channel is already settled and the mandate account already exists.

### What the voucher signer does not do

- It does not open its own RPC client. When `settledWatermark` is set, the first request uses that settled u64 and rejects a lower caller amount. With no reader, the first request still uses the caller-supplied amount.
- `POST /v1/channel-voucher` keeps every signed voucher in the `VoucherSpend` table and checks and records under a Postgres advisory lock per mandate. A restart or a second API process sees the same window total, lifetime total and channel watermark. `apps/api/src/agent/voucher-spend.db.test.ts` runs that against a real Postgres: a restart, two processes at once, and the window freeing after it passes. `VoucherBudgetLedger` on its own is still process-local.
- The deployed program ELF was not compared with a local build. `just build-devnet` refuses to compile while `TREASURY_OWNER` is the `0xBEEF` placeholder. No program was deployed from this branch.

Local timings, 60 samples, no RPC and no simulation: gate p50 5.6 ms / p95 7.4 ms, sign p50 15.8 / p95 20.5, request-to-voucher p50 22.6 / p95 28.0. One observed settlement, submission plus confirmation together, was 851 ms. That is one transaction, not a percentile. A separate 1-lamport transfer was 49 ms to submit and 786 ms to confirm. Those numbers are not a breakdown of the 851 ms.

The short handoff with the same limits is [`PAYMENT_CHANNELS.md`](PAYMENT_CHANNELS.md). Its suite count (500 passed) is from before the trusted-key fail-closed test was added.

## 6. What has been run

On 2026-10-16, after trusted instance keys became mandatory unless `untrusted` is set, `pnpm test` was **46 files passed, 502 tests passed, 1 skipped**. The skip is `apps/demo-agent/src/redteam/concurrency.test.ts`, the Postgres case, which runs only when `ATLAS_CONCURRENCY_DATABASE_URL` is set. It was not run.

Those tests cover the rules, the receipt tamper cases, the pinned-key cases, the voucher allow/deny/race cases, and the MCP `pay` tool. They do not establish that every attack is prevented.

The runnable path is in [`DEMO.md`](DEMO.md): `examples/atlasrails-pay/agent-payment.ts`, or `scripts/channel-voucher-devnet.mjs` and then `scripts/channel-voucher-anchor.mjs`. The playground `/demo` runs those two scripts. The gate runs before the voucher is signed.

Verify the $40 settlement from a built CLI. Pass the instance key. Without `--trusted-key` the instance check fails.

```bash
pnpm turbo run build --filter=@atlas-rail/cli...
node apps/cli/dist/main.js verify --tx 4RnVyRNTcssW1kAv9dL8xjbbhF8Ft6ZGomv7Msr1NGrTSgLKjQNafDcuK3B34ZVvmHYjhkfH78xZvG5PE5RiR1rU --trusted-key 3tDjoLJaTAhCwxQf6veR636MLEwpukaNu9gQc48ZQer3
```

## 7. What is still open

- No on-chain registry for instance-key rotation or revocation. Trust is the list the verifier was given.
- Voucher budget reservations do not cross processes.
- The channel watermark is caller-supplied.
- The deployed Payment Channels ELF was not diffed against a local build.
- The October 16 channel receipt files are historical or reconstructed. They are not original receipt objects.
- The Postgres concurrency test for the exact-scheme gate was not run in these sessions.
