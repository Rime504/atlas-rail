# Atlas Rail — agent handoff

## What this is, in 5 lines

Atlas Rail puts a policy gate outside an AI agent's own reasoning before it can pay via x402 on Solana: a person signs the agent a mandate (budget, allowed recipients/resources, a human-approval threshold), the gate checks every payment against it before anything is signed, and every allowed payment leaves a Merkle-anchored, independently verifiable receipt (`atlas verify`). Same engine also runs ordinary treasury payouts (spend limits, multi-person approval, audit ledger). Devnet/localnet only — never mainnet, never real funds. Built for the Colosseum hackathon; submission deadline 12 October, internal deadline 11 October 18:00 UTC. Continue from the last entry in `docs/PROGRESS.md`.

## Repo map

- `apps/api` — the NestJS API: gate, mandates, approvals, receipts, auth.
- `apps/worker` — payout/anchoring background jobs.
- `apps/web` — the operator console (Next.js).
- `apps/playground` — public, no-login 8-step walkthrough (Next.js, its own Vercel deploy).
- `apps/site` — marketing site (its own Vercel deploy).
- `apps/demo-agent` — the scripted/LLM demo agent (`model.ts` scripted, `llm-model.ts` real Anthropic/OpenAI, `scenes.ts` the 6 scenes, `main.ts` CLI).
- `apps/demo-api`, `apps/mock-validator`, `apps/cli` — the paid demo seller/facilitator, an in-memory Solana JSON-RPC for offline mode, and the `atlas` verify/mandate CLI.
- `packages/mandate` — mandate spec types, JCS canonicalisation, `evaluateGate` (the 15 rules), signing.
- `packages/receipt` — receipt building/verification, Merkle batching, on-chain anchoring (`AnchorService`).
- `packages/solana` — `Web3ChainClient`, devnet keyring, chain reads.
- `packages/x402-client` — `createAtlasFetch`, `GatedSignerAdapter` (the agent's signer physically cannot sign without a fresh gate authorization).
- `packages/domain`, `packages/config`, `packages/database` — treasury-side domain logic, env parsing, Prisma schema.
- `programs/atlas-mandate` — the Anchor program (`create_mandate`, `revoke_mandate`, `anchor_root`), devnet ID `CnGoTE5Bxc8MFGaeK5LDv5uAZ7pNiktMunYy8JZcLY4k`. **Divyesh owns this — never build or push to it.**
- `scripts/demo.mjs` — one-command orchestrator for the demo stack. `scripts/agent-e2e.mjs` — runs it on real devnet with anchoring forced on, writes `reports/e2e-<date>.md`.
- `docs/PRODUCT_SPEC.md` — the product spec, status section kept accurate. `docs/PROGRESS.md` — the running log, append after every task. `docs/THREAT_MODEL.md` — judge-facing attack table.

## Commands

```bash
pnpm install                              # once
pnpm build                                # turbo build, all packages
pnpm typecheck                            # turbo typecheck
pnpm lint                                 # turbo lint
pnpm test                                 # vitest, whole repo
pnpm test --filter=@atlas-rail/<pkg>      # or: pnpm turbo run test --filter=...
pnpm demo                                 # full stack incl. console, needs Docker
pnpm demo:offline                         # no Docker, no devnet — embedded Postgres + in-memory cluster
pnpm demo:rehearse                        # demo:offline --auto-approve --exit, for CI/rehearsal
pnpm agent:e2e                            # real devnet, anchor_root forced on, writes reports/e2e-<date>.md
AGENT_MODE=llm ANTHROPIC_API_KEY=... pnpm agent:e2e   # same, with the real LLM agent
cd apps/playground && pnpm dev            # playground dev server, :3200
cd apps/playground && pnpm test:e2e       # Playwright
```

Rust/LiteSVM tests for the Anchor program need Linux-native Node (no native `litesvm` binding on Windows) — run them via WSL: `cd programs/atlas-mandate && cargo test` and `cd programs/atlas-mandate/tests && npm test`.

## Rules (non-negotiable)

1. No "Co-Authored-By", "Generated with Claude", or any AI attribution in commits, PR titles or descriptions.
2. One branch + one PR per task. Normal merges only. Never force-push or rewrite history. Merge your own PRs only when CI is green and the task's DONE WHEN is met.
3. `master` is ALWAYS demo-ready: `pnpm demo`, the playground, and `pnpm agent:e2e` must all work after every merge.
4. Devnet/localnet only. Never mainnet. Never commit, print or log keys or `.env` contents. Server-side keys only.
5. Zero unproven claims. Every number in README, site, playground or docs must trace to a test, a report file, or an Explorer link. If it isn't measured, it isn't written.
6. Tests for everything new. Lint + typecheck + targeted tests while working; full suite before every merge.
7. After every task: append 5 lines to `docs/PROGRESS.md` (what, tests, links, gaps, next) and report the same to Rime.
8. STOP and ask only for: money, new accounts, irreversible actions, anything in Divyesh's PRs, or a change to what the product claims.
9. Efficiency: read only the files you need, keep reports short, don't re-read the whole repo — the last `docs/PROGRESS.md` entry plus this file should be enough context to continue.

## Ownership

| Owner | Scope |
|---|---|
| **Divyesh** (GitHub `false200`) | PRs #37, #39, #41, #43, #45, #47; the facilitator's devnet check for a delegate-signed `TransferChecked`; the gate verify tweak + delegate `TransferChecked` path; all Anchor/Rust program code (`programs/atlas-mandate`). Never push to his branches or build his parts yourself. |
| **You (the agent)** | Everything else: app code, docs, tests, demo/playground, reviewing Divyesh's PRs when asked. |
| **Rime** | Approvals, merging Divyesh's PRs after your review, API keys, recording the demo video, submitting. |

## Continuing work

Read the most recent entries in `docs/PROGRESS.md` first — they record what shipped, what tests proved it, and what's left. Don't re-derive context that's already written down there.
