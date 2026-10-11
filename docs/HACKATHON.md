# What was built for the hackathon, and what came before it

Atlas Rail started as a treasury payout engine. Agent Mandates — the policy gate, signed mandates,
receipts, the on-chain registry, and the public playground — is what was built around it for the
Colosseum hackathon (submission: 11 October 2026). This page draws the line honestly, with commit
links, so judges can see exactly what's new.

## Before the hackathon

**Treasury payout engine — 7 September 2026.** The underlying platform: spend limits, multi-person
approval, a payout state machine, a pre-flight simulator, an append-only audit ledger, signed
webhooks. Three commits:
[`b76fdb6`](https://github.com/Rime504/atlas-rail/commit/b76fdb6) worker + build fixes,
[`c546206`](https://github.com/Rime504/atlas-rail/commit/c546206) README,
[`3f35540`](https://github.com/Rime504/atlas-rail/commit/3f35540) repo setup.
See [Treasury payouts](../README.md#treasury-payouts) in the main README.

**Agent Mandates, first pass — 24–25 September 2026.** The core of what Agent Mandates is: the
signed delegation chain, the policy gate, x402 integration, bound receipts, the demo infrastructure,
and the console UI for it — built in one concentrated push, merged as
[PR #9](https://github.com/Rime504/atlas-rail/pull/9):
- [`8d2a1c5`](https://github.com/Rime504/atlas-rail/commit/8d2a1c5) `packages/mandate`: JCS canonicalisation, Ed25519 delegation chain, the policy gate, decision records
- [`b724824`](https://github.com/Rime504/atlas-rail/commit/b724824) gate/lifecycle services, x402 payment builder and analyzer, chain client
- [`e85a233`](https://github.com/Rime504/atlas-rail/commit/e85a233) `packages/receipt`: bound receipts, RFC 6962 Merkle batching, the offline verifier
- [`7e7b4c9`](https://github.com/Rime504/atlas-rail/commit/7e7b4c9) `@atlas-rail/x402`: `atlasFetch`, the gated signer adapter, gate clients
- [`1fadc69`](https://github.com/Rime504/atlas-rail/commit/1fadc69) `demo-api`: paid x402 endpoints and a local facilitator on the official `@x402/svm` scheme
- [`4ad1e2f`](https://github.com/Rime504/atlas-rail/commit/4ad1e2f) Postgres stores, migrations, the API module, an in-memory Solana cluster over JSON-RPC
- [`faea69b`](https://github.com/Rime504/atlas-rail/commit/faea69b) the `atlas` CLI, the scripted demo agent, the one-command demo orchestrator
- [`0ac9194`](https://github.com/Rime504/atlas-rail/commit/0ac9194) console: responsive shell, Mandates, Live Decisions (SSE), Approvals, Receipts with Verify
- [`e36ded5`](https://github.com/Rime504/atlas-rail/commit/e36ded5) the worker's anchor job
- [`f09aa38`](https://github.com/Rime504/atlas-rail/commit/f09aa38) `spec/agent-mandate-v0.1.md`: the proposal, data model, verification algorithm, threat table
- [`4994477`](https://github.com/Rime504/atlas-rail/commit/4994477) docs, CI, the end-to-end CI job

Also on 25 September: `apps/site` (the marketing site, [PR #17](https://github.com/Rime504/atlas-rail/pull/17)) and making Agent Mandates the README's front door ([PR #19](https://github.com/Rime504/atlas-rail/pull/19)).

## During the hackathon (28 September – 4 October 2026)

**Demo Lab: run the demo from the console UI, not just the CLI** — [PR #21](https://github.com/Rime504/atlas-rail/pull/21), 28 Sept.

**README leads with Agent Mandates for judges** — [`33010aa`](https://github.com/Rime504/atlas-rail/commit/33010aa), 30 Sept.

**On-chain mandate registry, Milestone 1** — [`967e1a5`](https://github.com/Rime504/atlas-rail/commit/967e1a5), 1 Oct. A new Anchor program, `programs/atlas-mandate`: `create_mandate` (owner, independent approver and the agent itself must all sign) and `revoke_mandate`. 10 Rust unit tests, 18 TypeScript/LiteSVM integration tests.

**2 October — on-chain goes live:**
- Deployed to devnet: [`45bffa9`](https://github.com/Rime504/atlas-rail/commit/45bffa9). Program ID `CnGoTE5Bxc8MFGaeK5LDv5uAZ7pNiktMunYy8JZcLY4k`.
- Wired into the policy gate behind `ATLAS_ONCHAIN=1` (Milestone B) — [PR #24](https://github.com/Rime504/atlas-rail/pull/24): on-chain revocation is checked, mandates are registered and revoked on-chain, not just in Atlas Rail's own database.
- Rule 15, per-resource price limits (Milestone C) — [PR #27](https://github.com/Rime504/atlas-rail/pull/27): a seller can't creep its price up a little at a time: a fixed, owner-signed expected price with a tolerance band and a hard maximum.
- Windows CLI fix: no `process.exit()` right after async work — [PR #26](https://github.com/Rime504/atlas-rail/pull/26).

**2–3 October — `anchor_root`**, contributed by Divyesh (fork PR [#29](https://github.com/Rime504/atlas-rail/pull/29), issue [#23](https://github.com/Rime504/atlas-rail/issues/23)): a third program instruction that records a Merkle root for a batch of receipts in a per-mandate PDA, instead of an SPL Memo — reviewed and merged after CI ran clean on the fork.

**4 October — the playground, and wiring `anchor_root` into the live path:**
- `apps/playground` — [PR #34](https://github.com/Rime504/atlas-rail/pull/34): a public, no-login, 8-step guided walkthrough built on the real gate and receipt code, deployed to Vercel on its own at [atlas-rail-playground.vercel.app](https://atlas-rail-playground.vercel.app).
- Fixed a real crash in the demo orchestrator (a Windows-specific race leaving a stray embedded-Postgres process that broke the next run) — [PR #32](https://github.com/Rime504/atlas-rail/pull/32).
- The devnet program upgraded in place (same program ID, no redeploy) to include `anchor_root`, and `anchor_root` wired into live receipt anchoring behind `ATLAS_ANCHOR_ROOT=1` (closes issue [#31](https://github.com/Rime504/atlas-rail/issues/31)) — [PR #48](https://github.com/Rime504/atlas-rail/pull/48), [PR #49](https://github.com/Rime504/atlas-rail/pull/49). `atlas verify` now checks the on-chain Root PDA directly, fully backward compatible with Memo-anchored receipts.

## 5–10 October, up to submission

**Every payment proves itself, and anyone can check it**
- Each allowed payment names its own receipt in its on-chain memo — [PR #63](https://github.com/Rime504/atlas-rail/pull/63).
- A public receipt store that only accepts receipts passing every check — [PR #64](https://github.com/Rime504/atlas-rail/pull/64), [PR #72](https://github.com/Rime504/atlas-rail/pull/72).
- `atlas verify --tx` and [`/verify`](https://atlas-rail-playground.vercel.app/verify): prove any devnet payment from its transaction alone — [PR #73](https://github.com/Rime504/atlas-rail/pull/73), [PR #74](https://github.com/Rime504/atlas-rail/pull/74), [PR #75](https://github.com/Rime504/atlas-rail/pull/75).

**Attacking it ourselves**
- A red team that assumes the agent is fully compromised on every attempt, run in CI and on real devnet, plus a concurrency proof (100 simultaneous payments against a $5 cap) — [PR #76](https://github.com/Rime504/atlas-rail/pull/76). Today: 52 attack types, 1,017 attempts, $0.00 moved outside the mandate ([report](../reports/redteam-2026-10-10.md)).
- [`/break`](https://atlas-rail-playground.vercel.app/break): try to break it yourself, decided live by the real gate — [PR #77](https://github.com/Rime504/atlas-rail/pull/77).
- Holes our own red team found, each fixed with a new case ([threat model](THREAT_MODEL.md#found-and-fixed-by-our-own-red-team)): budget released on the agent's word ([PR #88](https://github.com/Rime504/atlas-rail/pull/88)), message signing that accepted transaction bytes ([PR #89](https://github.com/Rime504/atlas-rail/pull/89)), and always-ask resources paid without a human, found by Divyesh ([PR #104](https://github.com/Rime504/atlas-rail/pull/104)).
- Divyesh's security review fixes: payout limits, a spend overspend window, the recipient allowlist, webhook SSRF, payout double-submit, and authorizations that require a replayed ALLOW decision — [#37](https://github.com/Rime504/atlas-rail/pull/37), [#39](https://github.com/Rime504/atlas-rail/pull/39), [#41](https://github.com/Rime504/atlas-rail/pull/41), [#43](https://github.com/Rime504/atlas-rail/pull/43), [#45](https://github.com/Rime504/atlas-rail/pull/45), [#47](https://github.com/Rime504/atlas-rail/pull/47).

**Keeping the key out of the agent, and making it usable**
- The agent key runs in a separate signer service the agent reaches only over HTTP — [PR #89](https://github.com/Rime504/atlas-rail/pull/89).
- `wrapFetch`, an MCP `pay` tool and an integration guide — [PR #78](https://github.com/Rime504/atlas-rail/pull/78); packages prepared for npm, not yet published — [PR #94](https://github.com/Rime504/atlas-rail/pull/94).

**Playground hardening**
- Step 7 never fails silently; one gate-authority key across server instances; fresh receipts never look unpublished — [PR #99](https://github.com/Rime504/atlas-rail/pull/99), [PR #100](https://github.com/Rime504/atlas-rail/pull/100), [PR #101](https://github.com/Rime504/atlas-rail/pull/101).
- Independent production keys (owner, approver, agent, instance), session state signed by the server so it can't be edited, 15 devnet runs an hour — [PR #102](https://github.com/Rime504/atlas-rail/pull/102).

**Telling it straight**
- A claims audit mapping every public claim to its source ([CLAIMS.md](CLAIMS.md)), a refreshed threat model, and a new README — [PR #84](https://github.com/Rime504/atlas-rail/pull/84), [PR #92](https://github.com/Rime504/atlas-rail/pull/92), [PR #93](https://github.com/Rime504/atlas-rail/pull/93).
- The company website at [atlas-rail-site.vercel.app](https://atlas-rail-site.vercel.app) — [PR #96](https://github.com/Rime504/atlas-rail/pull/96) — and a launch video built from real screenshots of the live playground — [PR #97](https://github.com/Rime504/atlas-rail/pull/97).

See [`docs/PROGRESS.md`](PROGRESS.md) for the complete phase-by-phase log, including what was tested at each step.
