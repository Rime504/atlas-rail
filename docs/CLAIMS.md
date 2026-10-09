# Claims audit

Every factual claim in the README, the playground, the site and the
judge-facing docs, mapped to the test, report or Explorer link that backs it. Audited 2026-10-08.
Status: **Sourced** (backed as written), **Fixed** (wording changed in this audit to match the source),
**Needs source** (no source found; to be sourced or removed before the release).

## Measured numbers

| Claim | Where | Source | Status |
|---|---|---|---|
| 439 automated tests pass | README | `pnpm test` (439 passed, 1 skipped: the Postgres concurrency test, which needs a database); CI | Sourced |
| Red team: 51 attack types, 1,014 attempts, 0 attack signatures, $0.00 outside the mandate | README, THREAT_MODEL, DEMO_VIDEO | [reports/redteam-2026-10-08.md](../reports/redteam-2026-10-08.md); `apps/demo-agent/src/redteam/redteam.test.ts` in CI | Sourced |
| Red team on real devnet: 16 attack types, $0.00 outside the mandate | README, THREAT_MODEL | same report, devnet section | Sourced |
| 100 simultaneous payments vs a $5 cap spend $5.00 (in-memory and Postgres); $10.00 without the lock | README, THREAT_MODEL, DEMO_VIDEO | same report; `concurrency.test.ts` (Postgres variant run locally) | Sourced |
| Gate decision on devnet: p50 351 ms, p95 1,613 ms | README, DEMO_VIDEO, PRODUCT_SPEC | [reports/e2e-2026-10-08.md](../reports/e2e-2026-10-08.md) (5 samples) | Sourced |
| Payment confirmation on devnet: p50 1,646 ms | README | same report (2 samples) | Sourced |
| `anchor_root`: 10,822 compute units, 5,000-lamport fee | README, DEMO_VIDEO | same report; [anchor tx](https://explorer.solana.com/tx/gtP2SkfSRAGZRM22uucbkquNDpAEzZASYGuZUSZjTL7hWY1848s1A9mLRmnErfkBtW8LVB5doSnpm7XJjXZbY89?cluster=devnet) | Sourced |
| "p95 < 50 ms measured" | PRODUCT_SPEC | No measurement of that existed; measured end-to-end figures above replace it | Fixed |
| 10 Rust unit + 27 LiteSVM integration tests | README | [PROGRESS.md, Phase 2 follow-up](PROGRESS.md): run 2026-10-04 before the in-place program upgrade ([upgrade tx](https://explorer.solana.com/tx/4giCwqh2aWuATJ5aisSiYMXZ8J8L62TjchsvcE3FKFF9g9vvLA575bpbxWtJ4dRU7ya1NKBRT9p79bTKNZwmwJnA?cluster=devnet)); `lib.rs` has 10 `#[test]`s. Not re-run in this audit (needs WSL + Anchor; not in CI) | Sourced (dated) |
| "285 automated tests" | the previous README (now `docs/README_previous.md`) | Stale; 439 today | Fixed: README replaced 2026-10-09 |

## Product behaviour

| Claim | Where | Source | Status |
|---|---|---|---|
| Owner, independent approver and agent each sign the mandate | README, playground step 2, site | `verifyMandateChain` (`packages/mandate/src/mandate.ts`); `mandate.test.ts` | Sourced |
| 15-rule gate before any signature | README, DEMO_VIDEO | `evaluateGate` (`packages/mandate/src/gate.ts`); `verifyReceipt` re-runs "all 15 rule results" | Sourced |
| The wallet refuses anything the gate did not authorise, byte for byte, within 120 s | README, THREAT_MODEL | `GatedSignerAdapter` + `verifyGateAuthorization`; red-team cases I1, I2, J1–J4, M1–M3, N1, N2 | Fixed: until 2026-10-08 `signMessage` signed arbitrary bytes, so a payment's message bytes could be signed with no gate (case N2 moved $60 on the in-memory cluster against the old code); it now signs only the agent's domain messages |
| In `pnpm demo` the agent reaches its key only over HTTP | README, INTEGRATE | `apps/signer`, `scripts/demo.mjs`, `scenes.ts` (`HttpSignerClient`); `signer-service.test.ts`; `pnpm demo:rehearse` | Sourced (with the same-user file-access limit stated) |
| A spend reservation is freed only when the chain shows the payment failed or can no longer land | README, THREAT_MODEL, INTEGRATE | `resolveSpend` (`gate-service.ts`), `findPaymentOutcome` (`payment-outcome.ts`); red-team case Q1; `fetch.test.ts` | Fixed: until 2026-10-08 `releaseSpend` freed it on the caller's word (#88) |
| Each allowed payment names its receipt in its on-chain memo | README, playground, DEMO_VIDEO | `fetch.ts` + `ReceiptService.issue`; `official-stack.test.ts`; independent `getTransaction` reads in [PROGRESS](PROGRESS.md) | Fixed: qualified "unless the seller requires a memo of its own" |
| Anyone can verify a payment from its transaction alone | README, `/verify`, INTEGRATE | `provePayment` (`packages/receipt/src/proof.ts`, `proof.test.ts`); live `/verify` Playwright tests; CLI run against devnet (PROVEN / NO PROOF) | Sourced |
| "/verify: every check links to the chain" | `/verify` intro | Only the payment and the anchor are on-chain; the rest is signature math | Fixed |
| A blocked attempt has a signed decision as its proof | `/verify`, `/break` | `proveBlockedAttempt`; published record `dec_01M4DCM6QVB8HF8QX6399TAK9K` | Sourced |
| DENY produces "a receipt" | PRODUCT_SPEC | A denial produces a signed decision record; receipts require settlement | Fixed |
| Price creep: above tolerance goes to a human, above the hard max is refused | README, playground step 5, THREAT_MODEL | `PRICE_LIMIT` rule; `amounts.test.ts`; red-team C1–C4 | Sourced |
| Human approval is bound to one exact payment and can't be reused | README (Built), THREAT_MODEL | Approvals are bound to the offer hash and consumed once (`gate-service.ts`, `approvals.consume`); red-team H1–H3, K2 | Sourced |
| The public receipt store only accepts receipts that pass every check | README (Built) | `publishReceipt` (`apps/playground/src/lib/receipt-store.ts`); `receipt-store.test.ts` (refuses un-anchored and tampered receipts) | Sourced |
| On-chain mandate registry: registration and revocation recorded on devnet | README (Built), How it works | Program `CnGoTE5B…LcY4k`; [grant tx](https://explorer.solana.com/tx/5uqDSZfxEGgLcDjdsooG8nASoqDexxdqDZf73rDmWzCw1anctHFHbgiqP4LSiHVfspktBtBcASTemzKLXYeVG8zq?cluster=devnet) and [revoke tx](https://explorer.solana.com/tx/4ysaGitd9eJL6kwGpPHtLmUJDYcmzkhvnWnLHDJ4aGErAPmsBNr2sPsoUjLX8QqWn4YxJLgBgpM3Dj8gUehs5PeE?cluster=devnet) in [reports/e2e-2026-10-08.md](../reports/e2e-2026-10-08.md) | Sourced |
| `wrapFetch` and an MCP `pay` tool | README (Built), INTEGRATE | `packages/agent/src/index.test.ts` (pays within the mandate; `AtlasDenied` and no signature otherwise); `apps/mcp/src/mcp.test.ts` (stdio smoke test) | Sourced |
| Business model and roadmap | README | Stated as plans ("planned", "will"); no revenue, users or partners are claimed | Not a factual claim |
| Revocation takes effect on the very next payment | README, playground step 8, site | `MANDATE_NOT_REVOKED`; red-team K1, K2; e2e scene 6 | Sourced (with the 120 s authorization window stated in THREAT_MODEL and README) |
| Devnet only; the server refuses mainnet RPC endpoints | README, site, THREAT_MODEL | `assertNotMainnet` (`packages/solana`), env validation; ADR 0004 | Sourced |
| Not audited | README, site, THREAT_MODEL | Statement of fact | Sourced |
| Playground runs the real gate and receipt code | playground landing | `apps/playground/src/lib/scenario.ts` imports `evaluateGate`, `buildReceipt`, `verifyReceipt` | Sourced |
| `/break`: the real gate decides, $5 per payment, $20 an hour, two sellers | `/break` | `tryToBreak` (`scenario.ts`), `amounts.ts`; `break.spec.ts` | Sourced |
| Spec test vectors are generated from the implementation and checked in CI | site | `spec/test-vectors`, `packages/mandate/src/vectors.test.ts` | Sourced |
| May 2026: a Bankr wallet associated with Grok was reportedly tricked by an encoded prompt; about $150–175k reportedly drained, reportedly returned afterwards | site (sources linked next to the line), `apps/demo-agent` scene 3 narration, `docs/VIDEO_SCRIPT.md` | [OECD.AI incident record](https://oecd.ai/en/incidents/2026-05-04-4a73), [The Crypto Times](https://www.cryptotimes.io/2026/05/04/xais-grok-ai-loses-175k-in-crypto-heist-via-clever-prompt-injection-then-gets-it-all-back/), [BeyondMachines](https://beyondmachines.net/event_details/prompt-injection-attack-drains-155000-from-grok-linked-bankr-crypto-wallet-x-q-p-c-p); all three checked to load | Fixed: sources added, wording aligned with them ("reportedly returned afterwards" replaces "most was reportedly returned") |
| Positioning: proof of permission for every AI agent payment on Solana; team Rime, Kamelia, Divyesh | site hero, metadata and footer, playground metadata | Aligned with the README (was "policy and evidence layer"; the site footer named only Rime) | Fixed |
| "An open standard for delegated spending authority" | README opening | A published, versioned, Apache-2.0 specification ([`spec/agent-mandate-v0.1.md`](../spec/agent-mandate-v0.1.md)) with test vectors checked in CI; not adopted or endorsed by any standards body | Sourced (as an open specification) |
| "Verify it … without trusting us" | README opening, `/verify` | `provePayment` re-checks signatures and reads the payment and anchor from Solana; the receipt JSON can come from anywhere and is verified on its own (`atlas verify <file>`). The public receipt store is ours, a stated limit | Sourced |
| Pay, then verify from the chain on real devnet: PROVEN, 3 of 3 | README opening and proof table | [reports/playground-live-2026-10-08.md](../reports/playground-live-2026-10-08.md), each transaction re-read from the public devnet RPC | Sourced |
| Answers x402 issue #3500 (not endorsed) | site | [x402-foundation/x402#3500](https://github.com/x402-foundation/x402/issues/3500), checked to exist | Sourced |

## Needs a source or a decision

| Claim | Where | Problem |
|---|---|---|
| "Organizations are giving agents tools, keys and money faster than they can prove what those agents were allowed to do" | site | An opinion, not a measurement; fine as framing but reads like a fact. |
