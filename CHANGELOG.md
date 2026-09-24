# Changelog

All notable changes to Atlas Rail will be documented in this file.

## [Unreleased] - Agent Mandates (x402 on Solana devnet)

Draft proposal, devnet only, not audited — see `spec/agent-mandate-v0.1.md` and `docs/security/threat-model.md`.

### Added
- `@atlas-rail/mandate`: RFC 8785 JCS canonicalization, Ed25519 delegation-chain mandates, the Policy Gate (`evaluateGate`: ALLOW/DENY/ESCALATE across 14 ordered rules with per-rule evidence), signed decision records, gate authorizations bound to a transaction message hash, revocation.
- `@atlas-rail/receipt`: bound receipts binding mandate + decision + settlement + response, RFC 6962 Merkle batching, Solana devnet Memo anchoring, offline verification.
- `@atlas-rail/x402`: an `atlas fetch` wrapper that catches HTTP 402, evaluates the gate, and signs only on ALLOW; a gated signer adapter that physically cannot sign without a valid authorization; a local seller test kit.
- `apps/demo-api`, `apps/demo-agent`, `apps/mock-validator`, `apps/cli` (`atlas verify`, `atlas mandate`): a scripted, pluggable-model demo agent, a paid x402 seller, an in-memory Solana JSON-RPC cluster for offline runs, and an offline receipt/mandate verifier.
- `packages/database`: `AgentMandate`, `AgentDecision`, `AgentApproval`, `AgentSpend`, `BoundReceipt`, `AnchorBatch`, `UserSigningKey` models and migrations, with append-only enforcement triggers.
- `apps/api`: `/v1/agent/*` — mandate CRUD/sign/revoke/verify, live decision SSE stream, approvals, receipts + in-API verify, anchoring.
- `apps/worker`: a BullMQ `agent-anchor` repeatable job that batches unanchored receipts onto Solana devnet.
- `apps/web`: Mandates (create wizard, delegation chain view, sign/revoke), Live Decisions (real-time SSE feed), Approvals (mobile-first, works on a phone), Receipts (detail + in-console Verify) — a new "Agent Mandates" nav group in a redesigned, responsive console shell.
- `pnpm demo` / `pnpm demo:offline` / `pnpm demo:rehearse`: a one-command, six-scene narrated demo (Grant, Pay, Attack, Escalate, Prove, Revoke) — see `docs/DEMO.md`.
- `spec/agent-mandate-v0.1.md`: the proposal itself, plus generated, CI-checked conformance test vectors.

## [0.1.0] - 2026-09-01

### Added
- Initial release of Atlas Rail devnet-only monorepo.
- `@atlas-rail/domain`: Money arithmetic, policy engine, payout state machine, RBAC role permissions.
- `@atlas-rail/solana`: Devnet RPC client, SPL Token transfer builder, transaction simulator, mock signer adapter.
- `@atlas-rail/database`: Prisma schema, PostgreSQL 16 migrations, ULID generators, seed script.
- `@atlas-rail/api`: NestJS REST API with Fastify adapter, OpenAPI Swagger UI, JWT & API Key auth, idempotency interceptor, webhook HMAC signer.
- `@atlas-rail/web`: Next.js 15 App Router B2B treasury control dashboard with persistent Devnet Warning Header.
- `@atlas-rail/worker`: BullMQ background job queues for payout simulation, execution, and signed webhook retries.
- Docker Compose, Makefile targets, GitHub Actions CI/CD workflows.
