# Progress log

Running log of work toward the Colosseum hackathon submission (due 11 October). Each phase gets a short entry: what changed, how it was tested, and links.

## Phase 0 — Status check (2026-10-04)

- PR #24 (on-chain grant/revoke wiring) was already merged; PR #27 (Rule 15 price limits) was open, reviewed and green.
- Found Divyesh's PR #29 (`anchor_root`) and issues #28, #30, #31 opened in the prior two days, all from his fork.
- Devnet balances checked directly via RPC (deploy authority, funder, gate-signer "instance", facilitator, merchant, agent) — all funded enough to run the demo.
- No tests run (status check only).
- Links: [PR #24](https://github.com/Rime504/atlas-rail/pull/24), [PR #27](https://github.com/Rime504/atlas-rail/pull/27), [PR #29](https://github.com/Rime504/atlas-rail/pull/29).

## Phase 1 — Finish what's open (2026-10-04)

- Merged PR #27 (Rule 15, per-resource price limits) into master.
- Reviewed PR #29 (`anchor_root`, Divyesh): sound PDA seeds, `INIT_SPACE`-derived account sizing, authorization scoped to each mandate's own `gate_authority` (narrows the single-key risk in issue #28), good test coverage (unauthorized/out-of-order/replay/empty-batch/anchor-after-revoke). Approved its CI run (fork PR, needed manual approval), both jobs passed, merged into master.
- Found and fixed a real crash: `scripts/embedded-postgres.mjs` did a bare top-level `await pg.start()` — when a stray postgres.exe survived a prior shutdown (a Windows-specific race in `taskkill /T /F` against Postgres's re-exec-per-worker model) the next run crashed with an uninformative `undefined` instead of a clear error. Added self-healing cleanup of stray instances before start, proper try/catch with a clear message, and removed a dead `instanceof Abort` check in `demo.mjs`. Verified with a forced-orphan repro and four consecutive clean `ATLAS_ONCHAIN=1` devnet demo runs. Merged via PR #32.
- Backed up `.demo/keyring.json` to `C:\Users\pc\keys\atlas-demo-keyring-backup-20261004-100416.json`.
- **Blocked, not done:** switching the live anchoring path from the SPL Memo to the new `anchor_root` program instruction (issue #31) needs a devnet program upgrade, which needs the program's upgrade-authority keypair (`3HBTbawevWEfPDLCs4FbBmfWMKUYwtja4VVmYS726nJq`) — not present on this machine (`.demo/keyring.json` or `C:\Users\pc\keys\`). Flagged to Rime; not attempting a redeploy or new authority key without sign-off, since that would change the program ID the README/spec already publish.
- Links: [PR #27](https://github.com/Rime504/atlas-rail/pull/27), [PR #29](https://github.com/Rime504/atlas-rail/pull/29), [PR #32](https://github.com/Rime504/atlas-rail/pull/32).

## Phase 2 — The public playground (2026-10-04)

- Built `apps/playground`: a standalone Next.js app, deployable to Vercel independently (same pattern as `apps/site`). Landing page + an 8-step guided story (meet the agent, sign and register a mandate, a normal payment, a prompt-injection attack, a seller price spike in both zones of rule 15, a human approval, a verifiable receipt, revocation) with a progress bar and Back/Next.
- Built on the **real** gate and receipt code (`evaluateGate`, `buildReceipt`/`verifyReceipt`), not a mock-up — runs server-side, in memory, no database. Default "instant" mode never touches a network. An optional "use real Solana devnet" toggle registers/revokes the mandate against the actually-deployed program using a server-held funded key, rate-limited (5 runs/IP/hour), 20s timeout, automatic fallback with a visible notice.
- Tests: a scripted run through all 8 steps against the live API (every rule-level outcome verified); a standalone test of the devnet path against the real deployed program; Playwright across desktop + mobile Chrome (6/6 passing); rate-limiter and timeout logic verified in isolation; devnet-unavailable fallback verified.
- Lighthouse (mobile): `/demo` 93 performance / 100 / 100 / 100. Landing page 86 performance / 100 / 100 / 100 — traced the remaining gap to Next.js/React's own hydration cost under Lighthouse's throttled-mobile simulation (confirmed via bootup-time breakdown), not page content; dropping to one font family already closed most of the original gap (78→86).
- Links: [PR #34](https://github.com/Rime504/atlas-rail/pull/34).

## Phase 2 follow-up — deploy, devnet key, program upgrade, anchor_root wiring (2026-10-04)

- Deployed `apps/playground` to Vercel as its own project: **https://atlas-rail-playground.vercel.app** (linked to GitHub, auto-deploys on push to master; had to explicitly set Root Directory via the API since CLI-deploy-from-subdirectory doesn't upload the monorepo context, and disable the default SSO wall that Vercel puts on new projects — it would have blocked every judge). Verified live: full 8-step scripted run against the production API, Playwright, desktop + phone screenshots.
- Generated a fresh devnet-only keypair for the playground's devnet-mode registrations (never reusing the deployer/upgrade-authority key): `BdPp5AziMgiHg1JkdQRS1hyQ6cnWXCHLrAw3EMYCrB9C`. Secret saved to `C:\Users\pc\keys\playground-devnet-owner.json`, never printed. Sent the address to Rime to fund; added it to Vercel as `PLAYGROUND_DEVNET_OWNER_SECRET_KEY` (encrypted env var, via the API, secret never left memory) so devnet mode works as soon as it's funded — not funded yet as of this entry.
- Rebuilt and upgraded the deployed program (WSL, `~/atlas-rail`, upgrade authority `3HBTbawevWEfPDLCs4FbBmfWMKUYwtja4VVmYS726nJq`) **in place — same program ID** `CnGoTE5Bxc8MFGaeK5LDv5uAZ7pNiktMunYy8JZcLY4k` — to include `anchor_root`. Verified first: 10 Rust unit tests + 27 LiteSVM integration tests (9 of them `anchor_root`-specific) against the freshly-built binary, all passing. Upgrade tx: `4giCwqh2aWuATJ5aisSiYMXZ8J8L62TjchsvcE3FKFF9g9vvLA575bpbxWtJ4dRU7ya1NKBRT9p79bTKNZwmwJnA`.
- Wired `anchor_root` into live receipt anchoring (closes issue #31): `AnchorService` can now anchor per-mandate via the registry's `anchor_root` instruction instead of an SPL Memo, behind `ATLAS_ANCHOR_ROOT=1` (needs `ATLAS_ONCHAIN=1`); `verifyReceipt`/`atlas verify` check the on-chain Root PDA. Fully backward compatible — Memo-anchored receipts still verify unchanged. 285 repo-wide tests pass (26 new: `checkRootAnchor` unit tests, root-mode `AnchorService` tests, config flag test). PR [#48](https://github.com/Rime504/atlas-rail/pull/48), narration follow-up [#49](https://github.com/Rime504/atlas-rail/pull/49).
- Ran the real demo end to end on devnet with `ATLAS_ONCHAIN=1 ATLAS_ANCHOR_ROOT=1`: `atlas verify` reports `PASS — anchor_root recorded this Merkle root on-chain for mandate 79EvgAgQbBMSNc4kCadRnfVVGA1yPtQLnF9P7ckSCHC at seq 0`. Anchor tx: https://explorer.solana.com/tx/2PTLcdZ5ghZ4axrGhEyYzihRnaM7cLKSZWAVVcZEAXJubRoJnHA7MteRNcAUGuCs996JxakuHS6mychAXUrGKF6?cluster=devnet
- Deleted the two leftover `.patch` files in the repo root and moved `data_pipeline/` out to `C:\Users\pc\Documents\cryptoproject\data_pipeline\` (unrelated scaffold, not part of this repo).
- Links: [PR #34](https://github.com/Rime504/atlas-rail/pull/34), [PR #48](https://github.com/Rime504/atlas-rail/pull/48), [PR #49](https://github.com/Rime504/atlas-rail/pull/49).

## Phase 3 — Judge-ready polish (2026-10-04)

- README top rewritten: playground link first, a recorded GIF (`docs/assets/playground-demo.gif`, via Playwright video capture + ffmpeg), a 30-second pitch, a compact architecture mermaid diagram, the devnet program ID with its Explorer link, the one-command local run, and first-name team credits (Rime, Kamelia, Divyesh). Also fixed a stale claim further down that the on-chain registry was "not yet wired into the policy gate" — it has been since Phase 1/2.
- `apps/site`'s hero CTA now links to the live playground instead of a disabled "video coming soon" placeholder. Verified locally (lint/typecheck/build clean, screenshotted).
- New `docs/HACKATHON.md`: before/during-the-hackathon split with real commit links, matching the actual git history (treasury engine 7 Sept, Agent Mandates first pass 24–25 Sept, everything from 28 Sept onward built during the hackathon).
- New `docs/THREAT_MODEL.md`: a judge-facing companion to the existing formal threat table — the specific attacks requested (overpay, wrong seller, wrong asset, budget drain, seller price inflation/creep, revoked mandate, tampered receipt, replayed approval, prompt injection) each mapped to the exact gate rule and where to see it in the playground, plus an honest limits section.
- CI green on master throughout.
- Links: [PR #51](https://github.com/Rime504/atlas-rail/pull/51).

## Phase 4 — Demo video script (2026-10-04)

- `docs/DEMO_VIDEO.md`: a timestamped script under 3 minutes for a screen recording of the playground (what to say, what to click, when, including an optional devnet-mode variant), plus a 2-minute pitch outline for talking about Atlas Rail without the screen.
- Links: [PR #52](https://github.com/Rime504/atlas-rail/pull/52).

---

# Round 2: post-submission-prep build (Divyesh now a collaborator; deadline 12 Oct, treating 11 Oct as ours)

A new phase sequence, starting over at Phase 0 — distinct from the phases above. See `docs/PRODUCT_SPEC.md` for the full product spec this round works from.

## R2 Phase 0 — Setup and quick fixes (2026-10-04)

- `docs/PRODUCT_SPEC.md` added, kept accurate going forward.
- `/demo` progress bar: "Step X of 8" and the percentage are now clearly separate for screen readers (explicit `aria-valuetext`, the sighted-only row marked `aria-hidden` so it isn't announced twice) as well as visually (already were). New Playwright test.
- Playground devnet key (`BdPp5AziMgiHg1JkdQRS1hyQ6cnWXCHLrAw3EMYCrB9C`) was already funded (2.5 SOL) by the time I checked — no transfer needed. "Use real Solana devnet" tested live: mandate registered on-chain ([tx](https://explorer.solana.com/tx/3KER4auM6ewNqDCrVC5knQvAtuP6uJCzJXGP6yN6CYRVj89kYLXS3nLVndPdnycC4jCTGaEx8LiitnVmA2Ea8ekG?cluster=devnet)) and revoked on-chain ([tx](https://explorer.solana.com/tx/tEgp7CdcEBst48LbnB4QhRTPpAnS1bR2ogQtTgkQsg3pxLkD8zjGP8guvFwMiF9FPoeY1d64WGGakgdkf11Jvbx?cluster=devnet)), both real, no fallback.
- Tagged `v0.1.0` at master ("Hackathon baseline: on-chain mandates, anchor_root, public playground") with a GitHub Release; closed issue #30.
- Plugin install (`/plugin`) is a chat-level command I can't run myself — gave Rime the commands to type. `code-review`/`security-review` already work for me as skills with no install needed.
- Links: [PR #54](https://github.com/Rime504/atlas-rail/pull/54), [v0.1.0](https://github.com/Rime504/atlas-rail/releases/tag/v0.1.0).

## R2 Phase 1 — Real AI agent + end-to-end devnet test (2026-10-04)

- `apps/demo-agent/src/llm-model.ts`: a real, stateful Anthropic/OpenAI tool-calling `AgentModel` (raw `fetch`, no SDK). `AGENT_MODE=llm`/`AGENT_PROVIDER`/`AGENT_MODEL` select it; no key → falls back to the scripted agent per-step with a visible notice. The model gets exactly two tools (`fetch_page`, `fetch_paid_resource`) and never sees a payment key.
- `scenes.ts` now tracks a full-run `timeline` of client events and reports `summary.metrics`: gate-decision and payment-confirmation latency (p50/p95), and — when `ATLAS_ANCHOR_ROOT` anchored this run — the `anchor_root` transaction's compute units and fee. Every scene's on-chain transaction (grant, pay, escalate, anchor, revoke) is now captured in the summary, not just printed to the console.
- New `pnpm agent:e2e` (`scripts/agent-e2e.mjs`): forces real devnet with `ATLAS_ONCHAIN=1 ATLAS_ANCHOR_ROOT=1`, runs all six scenes unattended, and writes `reports/e2e-<date>.md` with every Explorer link and the latency/fee numbers above. 3-command guide for Divyesh added to `docs/DEMO.md`.
- Tests: 11 new unit tests for `llm-model.ts` (tool-call parsing, final answers, malformed-arguments handling, API-error handling for both providers, no network/keys needed) — 296 vitest total, all passing. Full repo typecheck/lint/build clean.
- Ran `pnpm agent:e2e` on real devnet 3 times in a row, scripted mode — all green: [run 1](https://explorer.solana.com/tx/gwgVYzDGjtfPEyNNeWJD4QFQ5GL4dNcySrZi79yN7sePJjetox1dwdAAS8UYAtCv5ZCwkEC31cngzW5G3CBdj5W?cluster=devnet), [run 2](https://explorer.solana.com/tx/4yAUWwmfsVbocVKKVu4AtvuZHtABpfgCrJxojmu7QMYDJuBJ1ys6qMR1XXiZWGwvr7xsK5hZKCz5an2PNM2FvFWr?cluster=devnet), [run 3](https://explorer.solana.com/tx/wMXziBrf8XCngu4KCY2TTpveuP9oykiwPfNGSr835traFRFEPs9W3g39U3hcfKs25uBHCAFdbWNtBg9eC3qUMj3?cluster=devnet) (each link is that run's revoke tx; the 3rd run's full report is committed at `reports/e2e-2026-10-04.md`). Gate latency across the 3 runs: p50 414–542ms, p95 776–1060ms. Done-when for scripted mode is met.
- **Not yet done:** llm-mode devnet testing — blocked on an API key per the ground rules (STOP and ask). Asked Rime for one; will run it once provided.
- Links: [PR #56](https://github.com/Rime504/atlas-rail/pull/56).

---

# Round 3: final build order (Crypto World's Fair, deadline 2026-10-13 06:59 UTC)

Supersedes Round 2's phase numbering — see `AGENTS.md`/`GEMINI.md` for the handoff summary and `docs/COMPETITIVE.md` for the competitive research behind this round's priorities.

## T0.1 — Handoff files (2026-10-04)

- `AGENTS.md` and `GEMINI.md` (identical content): what Atlas Rail is, repo map, exact commands, the non-negotiable rules, the ownership table, and a pointer to continue from `docs/PROGRESS.md`.
- Tests: docs-only, no code touched.
- Links: [PR #58](https://github.com/Rime504/atlas-rail/pull/58).
- Gaps: none — a fresh agent should be able to continue from these files alone.
- Next: T0.2 (playground fixes).

## T0.2 — Playground fixes (2026-10-04)

- Rule list: amounts are formatted as dollars everywhere (`formatUsd`), never base units — including inside each rule's "show details" panel, which previously showed the gate's raw base-unit message. `PRICE_LIMIT`'s vacuous pass (no price limit configured for this resource, e.g. the attack step) now shows as "not applicable" with a neutral dash, not a green tick.
- Fixed a real overflow bug: `NETWORK_ALLOWED`/`ASSET_ALLOWED`'s rule label embedded the full mint address / CAIP-2 network id as an unbreakable string, overflowing the page at 360px width. Gave them short human labels like every other rule; added `break-words` defensively to both the label and detail text. `MonoAddress` is now tap-to-copy. New Playwright test walks all 8 steps at 360px asserting no horizontal overflow — this is what caught the bug.
- Landing headline gradient's purple end (`#9945FF`) was ~3.65:1 contrast against the background, short of WCAG AA; added `solana-gradient-text`, a lightened variant (`#B98CFF`→`#14F195`) that clears ~6.5:1 everywhere along the gradient.
- Mode (Instant/Real devnet) now shows as a persistent badge on every step, not just the step-1 toggle; proven to persist in a new Playwright test.
- Devnet mode now actually attempts real settlement (steps 3 and 6, an SPL `TransferChecked` on devnet) and real `anchor_root` anchoring (step 7), with Explorer links shown in the UI when they succeed, falling back to the synthetic path with a visible reason otherwise — same pattern already used for mandate register/revoke. Also fixed a latent bug: the devnet rate limit was being re-spent on every on-chain action (register, now also 2 settlements + an anchor + revoke = 5 instead of the intended "5 runs/hour"); it's now decided once per run and reused.
- Rule 15 boundary: added a dedicated unit test (`amounts.test.ts`) asserting the moderate spike is in the escalate zone and the severe spike is unconditionally above the hard max — both already were, but nothing enforced it before.
- Tests: 299 vitest (3 new), Playwright 7 tests × 2 projects = 14 (3 new: mode badge persists, not-applicable rendering, 360px no-overflow), all passing. Full repo typecheck/lint/build clean.
- Links: [PR #59](https://github.com/Rime504/atlas-rail/pull/59).

## T0.2 follow-up — real devnet proof verified end to end (2026-10-05)

- Rime funded `PLAYGROUND_DEVNET_AGENT_SECRET_KEY`'s address with 20 devnet USDC. Verifying the devnet settlement/anchor path against real devnet found and fixed two real bugs: (1) `anchor_root` was being sent the receipt's raw hash instead of `merkleRoot([receiptHash])` (the actual Merkle root — leaf hashing isn't the identity function even for a single-leaf tree), so `ANCHOR_ONCHAIN` failed every time; (2) a step's devnet fallback notice persisted on every later step instead of describing only its own attempt, so a step-3 RPC hiccup kept showing over a fully-passing step 7.
- Verified clean on real devnet, production: all 10 `atlas verify`-equivalent checks PASS, both on-chain checks included, no fallback banner. One run did fall back to synthetic on a transient public-devnet-RPC 429 — confirmed that's the honest fallback behavior working as designed, not a bug (same request succeeded on retry).
- Tests: 299 vitest, full typecheck/lint/build clean (no new tests needed — this was a devnet-only code path no unit/Playwright test can exercise without real RPC access).
- Links: [PR #61](https://github.com/Rime504/atlas-rail/pull/61).

## N1 — Self-proving payments: the receipt is named in its own payment memo (2026-10-05)

- Every payment `createAtlasFetch` builds now carries `atlasrail:receipt:<id>` in the x402 exact transaction's Memo instruction, generated client-side before the gate even sees the transaction (the gate signs over exact bytes, so the memo can't be chosen later) and reused across an escalation rebuild. `ReceiptService.issue` reads that same memo back off the *settled* transaction and uses it as the receipt's actual id — so the id in the memo and the id of the receipt it names are the same value by construction, not by trusting either side's say-so. A settled transaction naming an id that already belongs to another receipt is never trusted (replay/bug protection) — a fresh id is minted instead, same as if there were no memo at all.
- Only happens when the seller hasn't already claimed the transaction's one memo slot for its own `extra.memo` (the exact layout allows exactly one) — confirmed against the real `@x402/svm` facilitator package, not just our own test seller: `apps/demo-api/src/official-stack.test.ts` now asserts the memo lands and matches. The demo's own sellers never set `extra.memo`, so every demo-agent payment is self-proving today.
- Format defined once in `@atlas-rail/mandate` (`formatReceiptMemo`/`parseReceiptMemo`), shared by the client (writer) and `ReceiptService` (reader) so they can't drift apart. `AtlasPaymentInfo.expectedReceiptId` surfaces it to callers; `demo-agent`'s console narration and `pnpm agent:e2e`'s written report now show the memo next to each payment's Explorer link.
- Tests: 307 vitest (8 new — memo format round-trip, `ReceiptService` using/ignoring/not-colliding on a memo'd id, client injects/omits the memo correctly across a normal payment, an escalation rebuild and a seller-claimed-memo scenario), plus 2 new assertions in the real-facilitator test. Full repo typecheck/lint/build clean.
- **Not yet done:** the playground's own devnet settlement path (`apps/playground/src/lib/devnet.ts`) calls `buildExactPaymentTransaction` directly, not `createAtlasFetch`, so it doesn't get a self-proving memo yet — out of scope for this task (DONE WHEN only named `agent:e2e`), but N2's "paste any payment" verifier will show NO PROOF for the playground's own devnet payments until that's wired up too. Flagging for N2/N3.
- Links: [PR #63](https://github.com/Rime504/atlas-rail/pull/63).

## N1 follow-up — real devnet proof found 3 real bugs, all fixed (2026-10-05)

Verifying N1 against real devnet (not the in-memory test chain) took 4 runs and surfaced three genuine, unrelated bugs — worth recording honestly since each one would have shipped silently otherwise:

1. **The actual root cause — compute budget too tight for the memo.** `TRANSACTION_SIMULATION` failed every real-devnet attempt with `{"InstructionError":[3,"ProgramFailedToComplete"]}` — instruction 3 is the Memo. `X402_DEFAULT_COMPUTE_UNIT_LIMIT` (`packages/solana/src/x402-payment.ts`) was `20_000`, evidently tuned right at the edge for the old ~32-byte random-nonce memo; the ~54-byte `atlasrail:receipt:<id>` memo pushed it over. Bumped to `40_000` (still a small fraction of the 400k max). Found by reading the gate's own rule failure message, not by guessing.
2. **A pre-existing, unrelated bug this exposed:** `scenes.ts`'s ESCALATE scene matched its receipt by `amount === '40000000'` with no scoping to the current mandate or run. The embedded Postgres persists between `pnpm agent:e2e` invocations, so it was silently matching a stale $40 receipt from an much earlier (R2 Phase 1) run and reporting success on runs that had actually failed to settle — confirmed by checking the matched receipt's `mandate.id` against the run's own freshly-drafted mandate id: they never matched. Fixed by using `last.paid` (this run's own record, same pattern scene 2 already used) instead of an amount-based lookup.
3. **Errors were being swallowed silently.** `runAgent` (`model.ts`) catches a tool's exception and records it as `TOOL_ERROR: ...` in the trace instead of propagating it — correct for the agent's own flow, but `scenes.ts` never printed that detail, so a real settlement failure showed as a bare "no receipt was issued" with zero diagnostic information. This is what made bug #1 take 4 runs instead of 1 to find. Added `toolError(trace)` so PAY/ESCALATE failures now show the actual reason.

Verified clean, independently, after all three fixes: both the scene-2 and scene-4 transactions were read back via a direct `getTransaction` RPC call (not Atlas Rail's own code) — both `err: null`, and the on-chain memo matches `atlasrail:receipt:<id>` exactly: [scene 2 tx](https://explorer.solana.com/tx/4TWTbFyUbcEMsu2KbV64S5zA414dQxHqrhKxZeQF9u7a5DapV6uUAA2ryM1oKLyehHKcBK1KRKifXEkny3rK4JT1?cluster=devnet), [scene 4 tx](https://explorer.solana.com/tx/64TDc5TE2ADGKrV3ZAsgEXtiidduuc1Pb1yrLRh9Jzigw57TYKSmDbevJeRR5xcVZzDF7xUMiZ8yHHbwaYtyyUSn?cluster=devnet).
- Tests: 307 vitest (unchanged — these were real-devnet-only failures no unit/in-memory test could have caught; the compute budget isn't asserted anywhere, the stale-receipt bug only manifests with cross-run DB state, and the silent-error gap only manifests when something actually fails). Full repo typecheck/lint/build clean.
- Links: same [PR #63](https://github.com/Rime504/atlas-rail/pull/63).

## N2 part 1 — public receipt table + playground self-proving memo (2026-10-05)

- apps/api: `PublicReceipt` table plus unauthenticated `POST /v1/public/receipts` (accepted only when `verifyReceipt`'s offline checks all pass; rate-limited per IP) and `GET /v1/public/receipts/:id`. Every receipt the main demo-agent issues is auto-published there.
- Playground devnet settlement now writes `atlasrail:receipt:<id>` in the payment memo, same as N1.
- apps/api is not hosted anywhere public, so this table is reachable only from a local `pnpm demo`. The public store for the hackathon moves into the playground's Vercel project instead (see the sprint entry below).
- Tests: 312 vitest (5 new, Prisma mocked, since CI has no database). Links: [PR #64](https://github.com/Rime504/atlas-rail/pull/64).

## apps/api deploy prep (2026-10-05)

- `Dockerfile.api` builds only `@atlas-rail/api` and its workspace deps, runs `prisma migrate deploy` before start, and starts the compiled `dist/main.js`. `main.ts` listens on `$PORT` when a host sets it. Kept for a later public API deployment; not used for the hackathon.
- Links: [PR #65](https://github.com/Rime504/atlas-rail/pull/65).

## Divyesh's merges (2026-10-06 to 2026-10-08)

- [#37](https://github.com/Rime504/atlas-rail/pull/37) daily/monthly payout limits now load real rolling spend · [#41](https://github.com/Rime504/atlas-rail/pull/41) policy `allowedRecipientIds` enforced · [#39](https://github.com/Rime504/atlas-rail/pull/39) agent spend stays RESERVED until released, closing an overspend window (touched `fetch.ts` and the gate controller; the N1 memo and the public-receipt hook are intact) · [#45](https://github.com/Rime504/atlas-rail/pull/45) no payout double-submit once an on-chain signature exists · [#43](https://github.com/Rime504/atlas-rail/pull/43) webhook URLs reject private, metadata and IPv4-mapped (`::ffff:`) hosts.
- Also: [#66](https://github.com/Rime504/atlas-rail/pull/66) playground GIF white flash · [#67](https://github.com/Rime504/atlas-rail/pull/67) mobile nav clipping · [#68](https://github.com/Rime504/atlas-rail/pull/68) DB indexes for list/auth/housekeeping paths · [#69](https://github.com/Rime504/atlas-rail/pull/69) `.dockerignore`.
- Still open, owned by Divyesh: #46 (Root-PDA anchoring; adds a second flag next to the merged `ATLAS_ANCHOR_ROOT`) and #47 (GateAuthorization requires ALLOW + mandate replay). Both conflict with master and are being rebased by him.
- After these merges: master builds clean (39/39) and 321/321 vitest pass. Devnet `pnpm agent:e2e` re-run after #39 and #43 (2026-10-08): PASS, all six scenes. Independent `getTransaction` reads: [pay](https://explorer.solana.com/tx/3Yvr5NDstdpuAbu56CVZ94F5qNSjy2eDhShLh3pFa7XzUL4RLTKMG3Ejhmeiu9VrfPP7FHAspnjM1KqBTPFqKRxc?cluster=devnet) and [escalate](https://explorer.solana.com/tx/2hQLHYmHCAUvGcPbmG6SNQ5gqvcKQs6isdQkYGwauJHzVPmjWvbZwy3XRY3LUpRzcW8smHpa9H3e2XR1BYC8BYA5?cluster=devnet) both `err: null`, memos match their receipts. Report: `reports/e2e-2026-10-08.md`.
