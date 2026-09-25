# Atlas Rail Engineering Standards

This document is Atlas Rail's engineering charter — the standing contract for anyone contributing to this repository, human or AI. The maintainer is Rime Khatib. Where this file and an instruction conflict, ask before proceeding.

---

## 1. What Atlas Rail is

Atlas Rail is an open-source, self-hosted **policy and evidence layer for money moved by people and AI agents on Solana**. It decides whether a stablecoin payment is allowed, routes exceptions to humans, and produces a signed, tamper-evident record of every decision.

- **Treasury payout controls (v0.1), devnet:** versioned spend policies, independent multi-approval, pre-flight simulation with a program allowlist, idempotency, an append-only ledger, HMAC-signed webhooks, six-role RBAC. Never holds production keys. Mainnet is blocked in code.
- **Agent Mandates, devnet:** AI agents paying over x402 on Solana, governed by signed, revocable mandates. A Policy Gate evaluates every payment attempt (14 ordered rules → ALLOW / DENY / ESCALATE) with a hard per-payment ceiling, a rolling autonomous budget, a lifetime cap, and a human-approval threshold. The agent's own signer physically cannot sign a payment without a fresh, transaction-hash-bound authorization from the gate. Every settled payment produces a bound, Merkle-anchored receipt that a third party can verify offline.
- **Why it matters (the frame for every design choice):** organizations are giving agents tools, keys and money faster than they can prove what those agents were allowed to do. Insurers, auditors and regulators increasingly need that proof. Atlas Rail produces it. The receipt is the product; the controls are how it's earned.

The authoritative references for Agent Mandates are [`spec/agent-mandate-v0.1.md`](../spec/agent-mandate-v0.1.md) (the proposal: data model, canonicalization, verification algorithm, security considerations, test vectors) and [`docs/adr/0005-agent-mandates.md`](adr/0005-agent-mandates.md) (the design decision and its consequences). Read both before changing anything in `packages/mandate`, `packages/receipt`, or the Policy Gate's rule set. [`docs/DEMO.md`](DEMO.md) is the runbook for exercising the whole system end to end.

## 2. Non-negotiable safety rules

1. **Devnet only.** Never add, enable or suggest a mainnet RPC, mainnet mint or mainnet program. Keep `assertNotMainnet` and every existing guard (env validation, the mock signer's hard-throw outside `ATLAS_ALLOW_MOCK_SIGNER=true` and non-production). If a change would weaken a guard, stop and ask.
2. **No real funds, no production keys.** Never log, print, commit, or send a private key or seed. Devnet keypairs live only in the existing devnet keyring pattern (`.demo/keyring.json`, gitignored) and in `.env` files that are git-ignored.
3. **Secrets:** never commit `.env`, API keys or tokens. If you find one committed, stop and tell the owner; do not rewrite history yourself.
4. **Never fake a result.** Do not claim a test passed, a transaction confirmed, a latency was measured, or a feature works unless you ran it in this session and saw the output. If something could not be run, say so plainly and say why.
5. **Destructive actions need permission:** deleting files or branches, force-pushing, dropping databases, changing licences, rewriting git history, publishing packages, merging a pull request, deploying anywhere public.

## 3. How to work

### 3.1 Verify before you build

Treat every claim about what the system does as a hypothesis until you've checked it against code or a running system, not against a document. Before feature work on any part of the system:

1. Install and run the repo from scratch exactly as the README says. Record every step that fails.
2. Run lint, typecheck and all tests. Record the real results.
3. Walk the relevant lifecycle through the UI and API on devnet (a payout, or a mandate through all six demo scenes). Record whether transactions actually land and confirm, with devnet explorer links.
4. Reproduce any suspected bug with a failing test before fixing it — don't fix from a hunch.
5. Check every external dependency a design relies on (x402 scheme and package APIs, Solana program IDs, the facilitator contract) against its current official documentation or source. Note any drift.

`spec/test-vectors/agent-mandate-v0.1.json` and the CI e2e job (the six-scene offline rehearsal, run on every PR) are the current baseline artifacts for Agent Mandates — they exist precisely so a future change can be checked against a known-good state instead of re-litigated from scratch. Keep them current; if a rule or an algorithm changes, regenerate the vectors (`UPDATE_VECTORS=1`) in the same change, not a follow-up.

### 3.2 Build in milestones

1. **Plan:** state the files you'll create or change, the tests you'll write first, and the risks. Wait for the owner's "go" on anything left open.
2. **Test first** for domain logic: write the failing test, then the code.
3. **Implement** in small, reviewable commits on a feature branch (`feat/<topic>`), never directly on `master`.
4. **Verify:** lint, typecheck, unit, integration and (where relevant) end-to-end tests all green. Run the thing for real on devnet where relevant.
5. **Document:** update docs, CHANGELOG and any ADR (see §5).
6. **Report:** a short summary — what changed, how it was verified (with real outputs), what's left, new risks. Then stop.

### 3.3 When to stop and ask

Stop and ask the owner when: requirements are silent or ambiguous; a decision is hard to reverse (schema design, public API shape, key handling, a dependency choice with lock-in); tests reveal the plan is wrong; or you'd need to weaken a safety rule. Offer 2–3 options with a recommendation.

## 4. Engineering standards

### 4.1 Architecture

- Keep the existing layering: framework-free domain logic in `packages/domain`, `packages/mandate` and `packages/solana`; NestJS adapters in `apps/api`; background work in `apps/worker`; UI in `apps/web`. Domain code must never import NestJS, Prisma, Next.js or network clients.
- Money is always integer base units as strings or `bigint`. Never floating point. Reuse `money.ts` (treasury) or the mandate package's own `baseUnitsSchema`/`safeBigInt` helpers (agent budgets).
- Every state change goes through the existing state-machine and ledger patterns. The ledger and the agent decision log are append-only: never update or delete a row, enforced by database triggers — don't work around them.
- Budget enforcement must be **atomic in the database** (row lock, advisory lock, or conditional update — see `PrismaAgentStore.runExclusive`). A decision that reads totals then writes later is a bug.
- Every externally triggered write is idempotent (reuse the idempotency interceptor for payouts; the gate's request-hash/nonce checks for agent payments).
- Every decision returns stable, machine-readable reason codes (rule IDs for the gate) plus a human message.

### 4.2 Backend quality bar

- Validate every input at the boundary with Zod (or class-validator where Nest already uses it). Reject unknown fields.
- Errors: typed, with stable codes, never leaking stack traces, keys or internal IDs that aren't needed.
- Structured logging with correlation IDs; never log secrets or full transaction payloads containing signatures of private material.
- Timeouts and retries on every network call (RPC, facilitator), with backoff and a clear failure state.
- OpenAPI docs stay accurate: regenerate after every API change.
- Performance target: `POST /v1/agent/gate/evaluate` p95 < 50 ms on a local machine. This is a standing target, not yet a measured one — if you add a benchmark script, commit it and report the real number rather than asserting the target is met.

### 4.3 Frontend quality bar

- Next.js 15 App Router, TypeScript strict, consistent with the existing `packages/ui` and the console's shared components (`apps/web/src/components/ui.tsx`).
- Every screen handles loading, empty, error and success states. No blank screens, no silent failures.
- Accessible: keyboard navigable, visible focus, labels on every control, WCAG AA contrast, responsive down to phone width (the Approvals page in particular must be usable one-handed on a phone — that's a real workflow, not a nice-to-have).
- Money shown with correct decimals from base units; timestamps with timezone; devnet badge always visible.
- Live views (Live Decisions, pending Approvals) update without a manual refresh.
- The four Agent Mandates views — **Mandates**, **Live Decisions**, **Approvals**, **Receipts** — are the reference for what "done" looks like on this frontend. The Receipts view in particular must let a non-engineer understand and verify a receipt in under a minute; that's the bar for any future evidence-facing screen.

### 4.4 Testing

- Unit tests for every domain function and every reason code (rule ID).
- A **concurrency test**: parallel requests against a shared budget never jointly exceed it. `packages/mandate/src/service/service.test.ts` ("serialises concurrent requests so they cannot jointly exceed the lifetime cap") is the existing example to match for any new shared-budget logic.
- Integration tests for every API endpoint, including auth failures and idempotent retries.
- End-to-end test of the full demo story, runnable with one command (`pnpm demo:offline`) and running in CI on every pull request.
- Tests must be deterministic. The demo agent is scripted (`ScriptedModel`) by default and this is what CI always runs. The agent's model is pluggable (`AgentModel` in `apps/demo-agent/src/model.ts`, documented in `docs/DEMO.md`) so a real LLM can be wired in for a live demo — but that is a manual, local substitution, not a flag, and it must never be what CI exercises.

### 4.5 Security

- Update `docs/security/threat-model.md` for every new surface: agent session keys, the gate endpoint, receipts, approvals, webhooks.
- The agent never receives a raw private key, and its own signer cannot produce a signature without a valid, transaction-hash-bound authorization from the gate (`GatedSignerAdapter`). Signing happens behind Atlas Rail's policy decision, not before it.
- Receipts are signed (Ed25519, domain-separated); verification is public, documented (`spec/agent-mandate-v0.1.md` §8), and runnable offline (`atlas verify`).
- Run `pnpm audit` and resolve high/critical issues where a non-breaking fix exists, or document exactly why not (which major version is required, what breaks, and whether the finding is actually reachable in this codebase).

## 5. Documentation and comments

The standard is how strong engineering teams actually work, not commenting every line. **Comments explain *why*, the code explains *what*.** A comment that repeats the code goes stale and misleads; a comment that records a reason saves the next engineer an hour.

Required:

1. **Every file** starts with a short header: what this module is responsible for and how it fits the system.
2. **Every exported function, class, type and API endpoint** has a doc comment (TSDoc): purpose, parameters, return value, errors thrown, and any invariant it guarantees (e.g. "never captures more than the mandate budget").
3. **Inline comments** wherever the reason isn't obvious from the code: a safety rule, a security decision, a workaround, a non-obvious business rule, a performance trade-off, a link to the spec or ADR that requires it. Mark these clearly, e.g. `// SAFETY:`, `// SECURITY:`, `// WHY:`, `// SPEC: agent-mandate-v0.1 §...`.
4. **No commented-out code** and no `TODO` without an owner and an issue reference.
5. **Architecture Decision Records** in `docs/adr/` for every significant decision. `docs/adr/0005-agent-mandates.md` is the template to match: context, decision, alternatives considered, consequences.
6. **Docs updated in the same change as the code:** README, `docs/DEMO.md`, the spec, API docs, the threat model, `CHANGELOG.md`.
7. `docs/DEMO.md` is the live demo runbook — exact steps, flags, funding options and troubleshooting. Keep it current with the actual `pnpm demo` / `pnpm demo:offline` behavior; a stale runbook is worse than none. `docs/VIDEO_SCRIPT.md`, where present, is the narrated walkthrough for a recorded demo and should stay in sync with the six scenes it describes.

## 6. Deployment (devnet only)

- Local: `docker compose` must bring the whole stack up from a clean clone with the documented commands, and `pnpm demo` / `pnpm demo:offline` must work with no manual setup beyond what `docs/DEMO.md` states.
- CI: GitHub Actions runs lint, typecheck, unit and integration tests on every pull request, plus the full six-scene offline demo rehearsal as its own job on every pull request — not just on demand.
- Any hosted deployment (a marketing/docs site, a preview of the console) is **devnet-only**, uses non-secret demo data, and is created only after the owner approves the target. Document how to deploy and how to tear down.

## 7. Definition of done (for any change of consequence)

- [ ] Works from a clean clone with the documented commands
- [ ] Lint, typecheck and all tests pass, with the real output in the report
- [ ] Verified on devnet where relevant, with explorer links
- [ ] No safety rule weakened; threat model updated if a new surface was added
- [ ] Every new file, export and endpoint documented; comments explain the why
- [ ] ADR written for any significant decision
- [ ] CHANGELOG and docs updated
- [ ] Summary sent to the owner, including anything that did not work

## 8. Communication with the owner

- Plain language first, technical detail second. Say what you verified and how.
- Never say "done" for something unverified. Say "implemented, not yet verified because…".
- When you find a problem in earlier plans or docs (including this one), say so directly and propose a fix.
