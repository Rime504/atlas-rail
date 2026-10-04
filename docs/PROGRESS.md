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
