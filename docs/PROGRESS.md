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
