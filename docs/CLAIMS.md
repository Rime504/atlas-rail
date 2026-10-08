# Claims audit

Every factual claim in the README (`README_NEW.md`, pending the swap), the playground, the site and the
judge-facing docs, mapped to the test, report or Explorer link that backs it. Audited 2026-10-08.
Status: **Sourced** (backed as written), **Fixed** (wording changed in this audit to match the source),
**Needs source** (no source found; to be sourced or removed before the release).

## Measured numbers

| Claim | Where | Source | Status |
|---|---|---|---|
| 429 automated tests pass | README_NEW | `pnpm test` (429 passed, 1 skipped: the Postgres concurrency test, which needs a database); CI | Sourced |
| Red team: 50 attack types, 1,011 attempts, 0 attack signatures, $0.00 outside the mandate | README_NEW, THREAT_MODEL, DEMO_VIDEO | [reports/redteam-2026-10-08.md](../reports/redteam-2026-10-08.md); `apps/demo-agent/src/redteam/redteam.test.ts` in CI | Sourced |
| Red team on real devnet: 15 attack types, $0.00 outside the mandate | README_NEW, THREAT_MODEL | same report, devnet section | Sourced |
| 100 simultaneous payments vs a $5 cap spend $5.00 (in-memory and Postgres); $10.00 without the lock | README_NEW, THREAT_MODEL, DEMO_VIDEO | same report; `concurrency.test.ts` (Postgres variant run locally) | Sourced |
| Gate decision on devnet: p50 351 ms, p95 1,613 ms | README_NEW, DEMO_VIDEO, PRODUCT_SPEC | [reports/e2e-2026-10-08.md](../reports/e2e-2026-10-08.md) (5 samples) | Sourced |
| Payment confirmation on devnet: p50 1,646 ms | README_NEW | same report (2 samples) | Sourced |
| `anchor_root`: 10,822 compute units, 5,000-lamport fee | README_NEW, DEMO_VIDEO | same report; [anchor tx](https://explorer.solana.com/tx/gtP2SkfSRAGZRM22uucbkquNDpAEzZASYGuZUSZjTL7hWY1848s1A9mLRmnErfkBtW8LVB5doSnpm7XJjXZbY89?cluster=devnet) | Sourced |
| "p95 < 50 ms measured" | PRODUCT_SPEC | No measurement of that existed; measured end-to-end figures above replace it | Fixed |
| 10 Rust unit + 27 LiteSVM integration tests | README_NEW | [PROGRESS.md, Phase 2 follow-up](PROGRESS.md): run 2026-10-04 before the in-place program upgrade ([upgrade tx](https://explorer.solana.com/tx/4giCwqh2aWuATJ5aisSiYMXZ8J8L62TjchsvcE3FKFF9g9vvLA575bpbxWtJ4dRU7ya1NKBRT9p79bTKNZwmwJnA?cluster=devnet)); `lib.rs` has 10 `#[test]`s. Not re-run in this audit (needs WSL + Anchor; not in CI) | Sourced (dated) |
| "285 automated tests" | README.md (current) | Stale; 429 today | Fixed in README_NEW (swap pending) |

## Product behaviour

| Claim | Where | Source | Status |
|---|---|---|---|
| Owner, independent approver and agent each sign the mandate | README_NEW, playground step 2, site | `verifyMandateChain` (`packages/mandate/src/mandate.ts`); `mandate.test.ts` | Sourced |
| 15-rule gate before any signature | README_NEW, DEMO_VIDEO | `evaluateGate` (`packages/mandate/src/gate.ts`); `verifyReceipt` re-runs "all 15 rule results" | Sourced |
| The wallet refuses anything the gate did not authorise, byte for byte, within 120 s | README_NEW, THREAT_MODEL | `GatedSignerAdapter` + `verifyGateAuthorization`; red-team cases I1, I2, J1–J4, M1–M3, N1 | Sourced |
| Each allowed payment names its receipt in its on-chain memo | README_NEW, playground, DEMO_VIDEO | `fetch.ts` + `ReceiptService.issue`; `official-stack.test.ts`; independent `getTransaction` reads in [PROGRESS](PROGRESS.md) | Fixed: qualified "unless the seller requires a memo of its own" |
| Anyone can verify a payment from its transaction alone | README_NEW, `/verify`, INTEGRATE | `provePayment` (`packages/receipt/src/proof.ts`, `proof.test.ts`); live `/verify` Playwright tests; CLI run against devnet (PROVEN / NO PROOF) | Sourced |
| "/verify: every check links to the chain" | `/verify` intro | Only the payment and the anchor are on-chain; the rest is signature math | Fixed |
| A blocked attempt has a signed decision as its proof | `/verify`, `/break` | `proveBlockedAttempt`; published record `dec_01M4DCM6QVB8HF8QX6399TAK9K` | Sourced |
| DENY produces "a receipt" | PRODUCT_SPEC | A denial produces a signed decision record; receipts require settlement | Fixed |
| Price creep: above tolerance goes to a human, above the hard max is refused | README_NEW, playground step 5, THREAT_MODEL | `PRICE_LIMIT` rule; `amounts.test.ts`; red-team C1–C4 | Sourced |
| Revocation takes effect on the very next payment | README_NEW, playground step 8, site | `MANDATE_NOT_REVOKED`; red-team K1, K2; e2e scene 6 | Sourced (with the 120 s authorization window stated in THREAT_MODEL and README_NEW) |
| Devnet only; the server refuses mainnet RPC endpoints | README_NEW, site, THREAT_MODEL | `assertNotMainnet` (`packages/solana`), env validation; ADR 0004 | Sourced |
| Not audited | README_NEW, site, THREAT_MODEL | Statement of fact | Sourced |
| Playground runs the real gate and receipt code | playground landing | `apps/playground/src/lib/scenario.ts` imports `evaluateGate`, `buildReceipt`, `verifyReceipt` | Sourced |
| `/break`: the real gate decides, $5 per payment, $20 an hour, two sellers | `/break` | `tryToBreak` (`scenario.ts`), `amounts.ts`; `break.spec.ts` | Sourced |
| Spec test vectors are generated from the implementation and checked in CI | site | `spec/test-vectors`, `packages/mandate/src/vectors.test.ts` | Sourced |
| May 2026: a Bankr wallet associated with Grok was reportedly tricked by an encoded prompt; about $150–175k reportedly drained, reportedly returned afterwards | site (sources linked next to the line), `apps/demo-agent` scene 3 narration, `docs/VIDEO_SCRIPT.md` | [OECD.AI incident record](https://oecd.ai/en/incidents/2026-05-04-4a73), [The Crypto Times](https://www.cryptotimes.io/2026/05/04/xais-grok-ai-loses-175k-in-crypto-heist-via-clever-prompt-injection-then-gets-it-all-back/), [BeyondMachines](https://beyondmachines.net/event_details/prompt-injection-attack-drains-155000-from-grok-linked-bankr-crypto-wallet-x-q-p-c-p); all three checked to load | Fixed: sources added, wording aligned with them ("reportedly returned afterwards" replaces "most was reportedly returned") |
| Positioning: proof of permission for every AI agent payment on Solana; team Rime, Kamelia, Divyesh | site hero, metadata and footer, playground metadata | Aligned with README_NEW (was "policy and evidence layer"; the site footer named only Rime) | Fixed |
| Answers x402 issue #3500 (not endorsed) | site | [x402-foundation/x402#3500](https://github.com/x402-foundation/x402/issues/3500), checked to exist | Sourced |

## Needs a source or a decision

| Claim | Where | Problem |
|---|---|---|
| "Organizations are giving agents tools, keys and money faster than they can prove what those agents were allowed to do" | site | An opinion, not a measurement; fine as framing but reads like a fact. |
