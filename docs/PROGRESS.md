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
