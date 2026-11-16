# Atlas Rail engineering execution plan

Status: proposed execution backlog, not a statement that the features are implemented. Baseline: `4a2572d5124a95aaa90390ada1c2b8032db1214e` (public `master`, reviewed 16 November 2026). This document was requested after the product evaluation; it does not authorize mainnet, purchases, new accounts, public claims or program deployments.

## Objective and how to use this plan

Validate and then deliver one customer purchasing workflow: a B2B agent platform assigns a task budget, authorizes an external purchase, reconciles money movement and delivery separately, and allocates the cost to its customer. [whatthisis.md](whatthisis.md) defines the product and existing capabilities.

Execute the next eligible task, not the entire list automatically. **E00 is first. E01–E03 validate demand. G1 must pass before E04–E15 implementation.** E17 is optional. If a gate fails, record the reason and return to the relevant decision; do not replace missing evidence with more features.

Tasks below are review units. If one needs independent schema, behavior and UI changes too large to review together, split it into named children such as `E07a` and `E07b` with explicit dependencies before starting. Each child has its own branch and PR. Estimates and calendar dates are assigned after scope and staffing are known.

### Companion contracts

- [Customer validation](docs/product/customer-validation.md): who buys, evidence, price experiments, stop conditions.
- [Purchase lifecycle](docs/architecture/agent-purchase-lifecycle.md): proposed state transitions and accounting invariants.
- [Release gates](docs/operations/release-gates.md): G0–G4 evidence and release limits.
- [Current SDK manual](packages/atlasrails/MANUAL.md) and [pay authority contract](docs/pay-sh-authority.md): implemented adapter behavior, not future guarantees.

### Proposed working agreement

Use one branch and PR per bounded task, normal merges and no history rewriting. Merge only after applicable checks pass and the task's DONE WHEN is evidenced. Separate application work from Anchor/Rust and upstream changes; coordinate program changes with the current maintainer (Divyesh) and keep them outside this application backlog unless explicitly scoped.

Never commit secrets, `.env` contents, customer payloads or private interview material. Evidence in GitHub must be sanitized. Commercial outreach, purchases, external publishing and deployment need the relevant owner's action; a task description is not blanket authorization to perform them.

Preserve localnet/devnet restrictions and existing demo/payment behavior. Existing statements in a demo, README or old report are not proof of a newly changed path. Keep proposed targets visibly separate from measurements.

## Roles and gates

Assign an actual person to each role in E00. One person may hold several roles, but approval and financial authority must remain explicit.

| Role                     | Accountability                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| Product/commercial owner | Buyer selection, interviews, priced pilot, scope and value measurement                          |
| Engineering owner        | Implementation, invariants, compatibility and integration                                       |
| Security/release owner   | Threat model, isolation, failure review and release evidence                                    |
| Program maintainer       | Anchor/Rust/program assumptions, version compatibility and any separately approved program work |

| Gate | Required result                                                                       | Tasks                       |
| ---- | ------------------------------------------------------------------------------------- | --------------------------- |
| G0   | Current baseline, commands, CI and owners established                                 | E00                         |
| G1   | Same concrete buyer problem and a scoped paid evaluation decision                     | E01–E03                     |
| G2   | Supported devnet sandbox meets isolation, recovery, evidence and integration criteria | E04–E15                     |
| G3   | Customer evaluation demonstrates repeat use, value and recurring willingness to pay   | E16                         |
| G4   | Written release/next-investment assessment with unresolved risks                      | E18; E17 only when selected |

G4 is a decision record, not permission to use real funds. Targets and threshold examples live in the companion documents and can be revised with reasons before an experiment, not after seeing its results.

## Ordered backlog

All items start **NOT STARTED**. This planning PR completes none of the engineering or commercial tasks.

| ID  | Task                                                      | Depends on                             | Primary owner            |
| --- | --------------------------------------------------------- | -------------------------------------- | ------------------------ |
| E00 | Establish baseline and repair CI coverage                 | None                                   | Engineering              |
| E01 | Collect qualified buyer workflow evidence                 | G0; may begin interviews alongside E00 | Commercial               |
| E02 | Run competitor replacement and priced pilot experiment    | E01                                    | Commercial               |
| E03 | Record first pilot scope and go/no-go                     | E02                                    | Product + engineering    |
| E04 | Approve lifecycle, authority and migration contract       | G1                                     | Engineering + security   |
| E05 | Establish tenant identity and credential enforcement      | E04                                    | Engineering              |
| E06 | Add durable purchase identity and event persistence       | E05                                    | Engineering              |
| E07 | Add conserved task/subagent budget accounting             | E06                                    | Engineering              |
| E08 | Bind the selected payment adapter to purchase context     | E07                                    | Engineering              |
| E09 | Reconcile settlement, delivery and refund outcomes        | E08                                    | Engineering              |
| E10 | Bind approvals and cancellation to purchase authority     | E09                                    | Engineering + security   |
| E11 | Harden signer isolation and recovery for sandbox use      | E10                                    | Security + engineering   |
| E12 | Deliver private evidence and transactional publication    | E11                                    | Engineering              |
| E13 | Package the supported SDK path for a clean consumer       | E12                                    | Engineering              |
| E14 | Add operator exception queue and customer export          | E13                                    | Engineering + product    |
| E15 | Operate and qualify the devnet sandbox                    | E14                                    | Release                  |
| E16 | Run the paid evaluation and measure value                 | G2                                     | Commercial + engineering |
| E17 | Add a second provider only if a paid workflow requires it | G3; explicit scope decision            | Engineering              |
| E18 | Decide release readiness and next funding milestone       | G3; E17 if selected                    | Product + release        |

### E00 — Establish the baseline and repair CI coverage

**Scope:** Check default branch, open PRs, deployment commits, generated assets and actual scripts. Record the current SDK, mandate program, payment-channel program and upstream `pay` versions without rebuilding or upgrading programs. Assign role owners. Repair CI triggers/check wiring in a separate baseline PR before relying on green status.

**Where:** `.github/workflows/ci.yml`, `package.json`, `turbo.json`, `README.md`, `docs/operations/runbook.md`; a sanitized `reports/baseline-<date>.md`.

**Known starting issue:** the reviewed workflow filters pushes and PRs to `main` while the repository default is `master`. No check on a PR is not a green check. Older handoff commands `demo:offline`, `demo:rehearse` and `agent:e2e` are absent from the current root scripts; map their intended coverage to current entry points instead of copying them.

**DONE WHEN:** A PR targeting the actual default branch runs the intended checks; an owner reviews skipped jobs and third-party action/tool versions; baseline reports distinguish pass/fail/not-run and localnet/devnet. Existing unrelated failures become linked blocking tasks with owners. G0 is recorded.

**Validation/rollback:** Inspect actual CI runs, not YAML alone. Use existing permitted program artifacts/maintainer-run checks for chain validation. Roll back workflow edits if they suppress checks; do not weaken gates to label a baseline green.

### E01 — Collect qualified buyer workflow evidence

**Scope:** Follow [customer validation](docs/product/customer-validation.md). Identify platforms with recurring external purchases and an accountable buyer. Review actual exception workflows, spend attribution and existing controls. The commercial owner conducts authorized conversations.

**Deliverable:** Sanitized evidence matrix linked to private interview notes, with buyer, use case, current workaround, missing capability and confidence. Proposed initial target: 15 qualified conversations; this is an experiment target, not traction.

**DONE WHEN:** Multiple independent buyers expose the same concrete problem and its operational cost, or the owner records that the hypothesis failed. Record refusals and negative evidence as well as enthusiasm.

**Validation/rollback:** Check evidence against the qualification rubric; do not count competing founders or free demo users as paying demand. If no recurring workflow appears, stop product expansion and revise the hypothesis.

### E02 — Run the replacement and paid evaluation experiment

**Scope:** Compare the buyer's exact workflow with its current provider and the closest substitute. Test a priced evaluation with a named budget owner, decision date and success criteria. Fees and subscriptions are experiments, not published pricing.

**Deliverable:** A comparison worksheet and sanitized purchasing-status record. An approved paid engagement is stronger than a nonbinding letter of intent. No automated outreach, billing or contract execution is implied.

**DONE WHEN:** Proposed target of two independent paid evaluations/real purchasing commitments for substantially the same workflow, with a recorded reason existing controls are insufficient; otherwise explicit no-go or re-scope.

**Validation/rollback:** Distinguish money received, procurement-approved commitment and interest. A custom development commission alone does not establish recurring product demand.

### E03 — Record pilot scope and G1

**Scope:** Choose one buyer category, one purchase workflow, one payment path and one supported deployment model. Specify what the evaluation can prove using test assets/historical replay, private data handling and acceptance criteria. Price and name excluded requests.

**Where:** New `docs/adr/<next>-pilot-scope.md` and sanitized pilot brief; use the next free ADR number.

**DONE WHEN:** Product and engineering owners sign off the same success/failure criteria; the financial and operational owner is identified; G1 is go, revise or stop. Agree available team capacity before dates.

**Validation/rollback:** Check the pilot does not require real-fund operation, a universal router or multiple bespoke products. Revert to discovery when the chosen slice cannot serve the shared need.

### E04 — Approve lifecycle and migration contract

**Scope:** Review [purchase lifecycle](docs/architecture/agent-purchase-lifecycle.md), choose exact schema/API names, write the migration and compatibility ADR, and map each supported adapter's liabilities. Preserve historical mandate/receipt interpretation.

**Where:** ADR; `packages/mandate`, `packages/database`, `packages/atlasrails`, `packages/receipt` interfaces. This task approves the design; later tasks implement it.

**DONE WHEN:** Each transition has an authority, idempotency key, transaction boundary and evidence requirement. Explicitly cover signed-but-unsettled vouchers, missing `pay` callbacks, settle/distribute partial failure, late delivery and refunds. No single status conflates payment with fulfillment.

**Validation/rollback:** Walk adversarial examples with engineering/security and the pilot engineer. Reject designs that release authority on a caller assertion or assume all adapters provide the same evidence.

### E05 — Establish tenant identity and credential enforcement

**Scope:** Extend existing organization/membership/API-key concepts. Bind tenant identity to authenticated server context, then to mandates, operations, approvals, receipts and signer ownership. Enforce expiry, revocation and least-required scopes. Shared demo tokens are not tenant authorization.

**Where:** `apps/api/src/common/auth.guard.ts`, `apps/api/src/auth/`, `apps/api/src/agent/*controller.ts`, `packages/database/prisma/schema.prisma`.

**DONE WHEN:** Every new resource access/write has an organization check; caller-supplied IDs cannot switch tenant; public approval/evidence routes cannot disclose private terms without a deliberately scoped capability; credentials are server-side and logs redacted.

**Validation/rollback:** Cross-tenant ID substitution, expired/revoked/wrong-scope credentials and anonymous retrieval tests. Keep legacy demo records explicitly isolated; never infer their owner from an untrusted request during backfill.

### E06 — Add durable purchase identity and event persistence

**Scope:** Add the minimal purchase intent, attempt, allocation and event schema selected in E04. Reuse `AgentSpend`, `PayOperation`, `VoucherSpend`, existing approval stores and treasury audit patterns where their semantics fit. Define immutable request fingerprints and durable duplicate detection.

**Where:** Database schema/migrations/stores; `apps/api/src/agent/`; shared types beside existing domain packages.

**DONE WHEN:** Same tenant/operation/key with the same fingerprint is a replay; changed content conflicts. Records survive restart. A transactional write can bind purchase, authority/hold and event without an intermediate visible partial state. A response-cache interceptor is not the correctness mechanism.

**Validation/rollback:** Two-process concurrent duplicate, crash-after-commit and migration upgrade tests with Postgres. Expand schema first; backfill only proven mappings; preserve old readers. Revert application consumers without deleting financial evidence.

### E07 — Add conserved task and subagent budgets

**Scope:** Add customer/task/subagent attribution and parent budget conservation for the selected workflow. Use one transactional allocation model so delegated authority cannot multiply and sibling requests cannot overspend a parent. Preserve current mandate window escalation; proposed hard task ceilings are explicit/versioned.

**Where:** Database stores; `packages/mandate/src/service/`; selected voucher/authority budget adapter.

**DONE WHEN:** Outstanding liabilities plus settled charges stay within each applicable hard ceiling, counted once per budget scope. A child cannot change its parent, mint or tenant, increase authority, reset lifetime spend or cause the same amount to be added twice. Top-ups/changes require authorized versioned events.

**Validation/rollback:** Property tests of conservation plus Postgres races across multiple channels, siblings and API processes. Include a deliberately unsafe control in a test fixture where useful. No lossy rollback of recorded charges; disable new delegations while honoring existing liabilities.

### E08 — Bind the selected payment adapter to purchase context

**Scope:** Select exactly one of existing exact x402, voucher SDK or `pay` authority paths from E03. Carry immutable purchase/attempt/tenant context to the actual enforcement point. Define amount semantics explicitly: incremental purchase amount versus cumulative channel voucher value.

**Where:** `apps/api/src/agent/channel-voucher.ts` or `pay-authority.ts`, `packages/atlasrails/src/sdk-client.ts`, `packages/x402-client/src/`, relevant database adapter.

**DONE WHEN:** Identity, resource, recipient, asset, network, policy version and amount are bound to the authorization. No client or retry can route around the selected signer/enforcement path. Unsupported adapters return an explicit unsupported result. Map upstream revision dependencies without claiming endorsement.

**Validation/rollback:** Amount/payee/resource mutation, direct signer bypass, stale authorization, duplicate attempts and channel-watermark tests. Preserve old path compatibility under explicit routing; rollback must not allow a signed liability to be forgotten.

### E09 — Reconcile settlement, delivery and refunds

**Scope:** Extend chain outcome readers and durable workers. Treat provider callbacks as authenticated hints matched to the original operation and verified against authoritative evidence. Separate settlement from delivery; make uncertain and disputed outcomes visible. Where no result source exists, retain a conservative liability and an explicit unresolved state.

**Where:** `packages/solana/src/payment-outcome.ts`, selected payment adapter, database stores, `apps/worker/src/queues/`.

**DONE WHEN:** Lost responses never free potentially spendable authority; a signed voucher is not released merely because an HTTP request timed out. The first slice retains its issued cumulative prefix until terminal channel reconciliation and disables further issuance on the closed channel, preventing expiry followed by under-reserved cumulative reissuance. A successful settle followed by failed distribution resumes distribution only. Fulfillment failure cannot manufacture a refund or trigger a new paid call automatically. Refund records are evidence-backed and budget-restoration semantics explicit.

**Validation/rollback:** Kill workers before/after each durable boundary; replay callbacks; reorder events; test RPC outages, late settlement, partial distribution, expiry, failed tool execution and verified refund. Resume from persisted state without a duplicate financial effect. No exactly-once merchant-execution claim without merchant cooperation.

### E10 — Bind approvals, revocation and cancellation

**Scope:** Extend existing owner signatures to proposed task/purchase context. Make approval requests understandable; bind all relevant immutable fields and expiry. Define cancel/revoke behavior for unsigned requests, signed liabilities and closing channels separately.

**Where:** `apps/api/src/agent/owner-approvals.ts`, `packages/database/src/owner-approval-store.ts`, SDK/console approval adapters.

**DONE WHEN:** Approval cannot cross tenant/task/recipient/amount/version or be reused; agent cannot self-approve. Hard ceilings remain hard. UI/API disclose pending signed exposure and channel grace. The cooperative seller signing flow never asks the buyer to supply the seller's private key.

**Validation/rollback:** Duplicate approvals, stale scope, revoke races, offline approver and direct submission of an already-signed voucher. Disable new authorizations on uncertainty while preserving recovery access and existing evidence.

### E11 — Harden sandbox signer isolation and recovery

**Scope:** Specify one supported signer deployment with genuinely separated access. Persist keys and ownership before exposing funded resources; implement startup binding checks, rotation/recovery procedures and restricted health signals. Integrate an external provider only when selected and its accounts/costs are authorized.

**Where:** `apps/signer`, `packages/x402-client`, SDK setup and deployment configuration; coordination with program maintainer for assumptions only.

**DONE WHEN:** An agent workload cannot read signer secrets or request arbitrary signatures; startup refuses an incorrect chain/key/channel binding; interrupted setup can recover its resources; key rotation leaves historical verification possible under a documented trust policy.

**Validation/rollback:** Separate-process/identity integration test, key mismatch, restart, interrupted setup and restore drill using disposable test assets. File/process isolation evidence is required beyond an in-process mock. Preserve recovery material securely; no key export in reports.

### E12 — Deliver private evidence and transactional publication

**Scope:** Persist evidence and a durable outbox in the same database transaction as the corresponding local state change. Reuse receipt/Merkle tooling; publish asynchronously and idempotently. Keep private evidence separate from the public demonstration store.

**Where:** `packages/receipt`, database migrations/stores, API queue integration, worker jobs and CLI verification.

**DONE WHEN:** Payment remains paid when anchoring/publication fails; retries do not repay it or duplicate the logical event. Tenant access, private exports, retention and restoration are documented. Verified-with-trusted-key, diagnostic/untrusted, unanchored and unavailable evidence are distinguishable.

**Validation/rollback:** Commit-then-worker-crash, duplicate delivery, corrupted receipt, lost store access, key rotation and retry-anchor cases. Test historical receipt compatibility. Roll back publishers while preserving outbox/evidence; never delete payment truth to repair a display.

### E13 — Package the supported SDK for a clean consumer

**Scope:** Provide the selected purchase workflow in a minimal example. Reuse the existing pack-consumer script, remove machine-specific path assumptions and verify tarball dependencies outside the monorepo. Public registry publication is a separate owner-controlled action after package review.

**Where:** `packages/atlasrails`, `packages/agent` only if selected, `examples/atlasrails-pay`, `scripts/pack-sdk-consumer.mjs`, current manual.

**DONE WHEN:** A clean consumer follows documented steps, receives typed denial/pending/partial outcomes, can resume the same purchase, and never needs unrestricted agent keys. The example names its supported chain and defaults to preparation/review rather than unattended broadcast.

**Validation/rollback:** Fresh-directory tarball install, negative authorization example, restart/resume and package secret/file-content inspection. Version package changes normally; do not replace published version history. Measure integration time during E16, not from founder familiarity.

### E14 — Add operator exceptions and customer exports

**Scope:** Extend current payment/receipt/approval screens with customer/task attribution, remaining authority and separate settlement/delivery/evidence states. Add an exception queue and a scoped export suitable for the pilot's existing accounting workflow; defer full ERP integrations.

**Where:** `apps/web/src/app/payments/`, existing approvals/receipts pages, `apps/web/src/lib/agent-hooks.tsx`, API read models; worker reconciliation-export patterns.

**DONE WHEN:** An operator can investigate one purchase end to end, distinguish blocked from pending/paid, see signed exposure after revoke, and export customer charges without duplicates. Every action has backend authorization; hiding a button is insufficient.

**Validation/rollback:** Browser tests for the chosen workflow, cross-tenant API access, expired approval, partial payment and private export. Keyboard/accessibility review for approval decisions. Revert presentation without modifying the ledger.

### E15 — Operate and qualify the devnet sandbox (G2)

**Scope:** Deploy only to an existing authorized test environment or prepare a reviewable deployment if accounts/cost approval is needed. Separate signer/API/worker permissions; use migrations, health checks, redacted logs and observable reconciliation lag. Set measured service/cost budgets with the pilot owner.

**Where:** Existing deployment assets, API/worker config, `docs/operations/runbook.md`, [release gates](docs/operations/release-gates.md).

**DONE WHEN:** G2 evidence covers isolation, multi-process concurrency, restart/restore, RPC outage, full selected-path rehearsal, rollback and the clean SDK consumer. Monitoring differentiates stopped payments, pending liabilities, fulfilled purchases and missing evidence. Current program/deployment compatibility is confirmed.

**Validation/rollback:** Run applicable full TypeScript checks, browser tests and maintainer-coordinated chain/demo checks; publish sanitized environment-tagged reports. No silent skips. Disable new authorizations first during rollback; retain reconciliation and owner recovery.

### E16 — Run the paid evaluation and measure value (G3)

**Scope:** Evaluate the same workflow with independent partners. Keep devnet/synthetic/historical replay distinct from customer production activity. Record baseline and after measurements, support effort, integration time, unit cost and recurring purchasing decision.

**DONE WHEN:** [Validation criteria](docs/product/customer-validation.md) determine go/revise/stop. The buyer identifies a measurable benefit and explains why the current stack was insufficient. Customer permission is obtained before using its identity or data publicly.

**Validation/rollback:** Have the partner reproduce the workflow and review the statement of value. Separate implementation revenue from subscription revenue. If evidence fails, return to E03; do not automatically expand product scope.

### E17 — Optional second-provider interoperability

**Scope:** Only when a paying workflow requires it, add one provider adapter and map authority/evidence semantics (including AP2 where relevant). Never describe an adapter's metadata as cryptographic enforcement unless its signing path actually enforces it.

**Depends on:** G3 and a new scope ADR; skip this task when one provider solves the selected problem.

**DONE WHEN:** Conformance tests demonstrate the same parent authority cannot be spent twice across providers, and unsupported/refund/finality differences are explicit. A partner uses the second path for the stated need.

**Validation/rollback:** Cross-adapter races, independent outages and mismatched identity tests; isolate the adapter on rollback while retaining its outstanding liabilities. Do not add a second rail solely to decorate a pitch.

### E18 — Release and next-investment assessment (G4)

**Scope:** Assemble pilot evidence, cost-to-serve, retention/renewal results, security findings, recovery reports and unresolved dependencies. Review future audit/custody/legal scope with responsible owners; obtain quotes only through authorized processes.

**DONE WHEN:** A written go/revise/stop decision identifies the supported devnet product, unresolved risks, next commercial milestone, staffing and budget. No claim of production readiness or investor commitment is inferred from this document.

**Validation/rollback:** Each factual claim links to a versioned source/report; each target is labeled. G4 does not activate mainnet or real funds. Any change to that boundary requires a separately requested scope and release decision.

## GitHub execution procedure

1. Confirm the worktree is clean, fetch the default branch and inspect open work for the task's areas.
2. Create `feat/eNN-short-name`, `fix/eNN-short-name` or `docs/eNN-short-name` from the current default branch. Never work on another contributor's branch without coordination.
3. Put the task ID, dependencies and exact DONE WHEN in the PR description. Split oversized work before implementation, not during an unreviewable final diff.
4. Run targeted checks while developing, then the applicable full checks before merge. Record commands, environment and pass/fail/skip truthfully.
5. Push the branch and open a draft PR when useful for review. Promote only when acceptance evidence is complete. Do not interpret absent CI as success.
6. Normal merge after review and green required checks. Record the merge/PR link and concise what/tests/links/gaps/next notes in [Progress](docs/PROGRESS.md).

PR description template:

```text
Task: E__ / dependencies:
Problem and resulting behavior:
Scope and explicit exclusions:
DONE WHEN evidence:
Validation (command, environment, result):
Compatibility/migration/rollback:
Remaining risks and next task:
```

## Current command reference

Confirm against `package.json` in E00 and whenever it changes. These are available at the reviewed baseline; they are not a statement they passed on this documentation branch.

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm exec vitest run --config vitest.config.ts apps/api/src/agent/pay-authority.test.ts apps/api/src/agent/pay-authority.db.test.ts apps/api/src/agent/channel-voucher.test.ts apps/api/src/agent/voucher-spend.db.test.ts
pnpm turbo run typecheck --filter=@atlas-rail/api --filter=@atlas-rail/database --filter=@atlas-rail/mandate --filter=@atlas-rail/x402 --filter=atlasrails --filter=@atlas-rail/worker
pnpm --filter @atlas-rail/playground test:e2e
```

`pnpm test:chain`, `pnpm demo` and `pnpm demo:pay` require chain/tool prerequisites and may build program/integration artifacts. Coordinate their execution and ownership in E00; do not run deployment/recovery scripts against saved evidence channels. The current CI chain job builds the mandate program. Never substitute mocked/local evidence for a claimed devnet result.

For documentation-only PRs, validate formatting, relative links, task dependencies and claims against the baseline. No application behavior is changed by this planning set. CI and baseline failures must still be visible; this planning PR does not resolve E00.
