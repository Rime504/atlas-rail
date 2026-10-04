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
- **Not yet done:** actual Vercel deployment (needs Rime to run `vercel login` first — see her message), and the phone/desktop screenshots of the *live* URL she asked for.
- Links: [PR #34](https://github.com/Rime504/atlas-rail/pull/34).
