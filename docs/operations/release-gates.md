# Release gates

Status: proposed working agreement for executing [engineering.md](../../engineering.md). The current product remains devnet/localnet only, unaudited and unsuitable for real funds. Completing a gate, receiving funding or commissioning an audit does not authorize mainnet, custody changes or real-fund operation.

Read [what this is](../../whatthisis.md), [customer validation](../product/customer-validation.md) and the proposed [purchase lifecycle](../architecture/agent-purchase-lifecycle.md). Baseline references below describe commit `4a2572d`; recheck them on each release candidate.

## Current blockers and boundaries

- `.github/workflows/ci.yml` currently targets `main` for pushes and pull requests, while the planning branch is based on `master`. E00 must verify the repository's default branch, required checks and ownership, then align the workflow. A PR with no checks is not green CI.
- `atlasrails` is not published to npm. Its documented path builds workspace packages and starts services; treat package distribution as incomplete until an external consumer test proves the intended installation method.
- The `pay` integration documentation says its upstream spending-authority hook is still under review. Record the dependency commit and status; do not imply upstream endorsement.
- The `pay` path currently has no result callback: a failed payment after an allow still counts against its budget. A pilot must either explicitly accept that limitation or implement a verified resolution path before claiming completed reconciliation.
- The channel program does not read the mandate. A signed voucher remains usable until the channel is sealed. Payer-only closing involves the stored grace; immediate sealing needs payee cooperation. A demo with both keys does not prove independent-party recovery.
- SDK `prepareOnly` controls settlement/distribution execution, but does not prohibit separate methods called with `submit: true`. Inspect the entire invocation when promising a read-only evaluation.

Sources: [CI](../../.github/workflows/ci.yml), [SDK boundaries and limitations](../../packages/atlasrails/SDK.md), [manual](../../packages/atlasrails/MANUAL.md), [`pay` integration](../pay-sh-authority.md).

## Who decides

| Role             | Accountability                                                                      |
| ---------------- | ----------------------------------------------------------------------------------- |
| Product founder  | Pilot scope, buyer evidence, price and written acceptance of limitations            |
| Engineering lead | Implementation, migration, tests, observability and recovery evidence               |
| Security owner   | Trust boundaries, signer isolation, access control and unresolved security findings |
| On-chain owner   | Program changes, deployment/version evidence and chain-specific verification        |
| Release owner    | Exact commit/artifact, checks, rollback, release record and final decision          |

Assign actual names in the task or release record before work begins. A task touching Anchor/Rust or a collaborator's active branch must agree scope and reviewer with its owner; do not silently include program work in an application PR. Divyesh is the named on-chain collaborator in the current project context; confirm responsibility for each program change.

## G0 — Scope and baseline

Required evidence:

- One customer-problem hypothesis and candidate purchase paths documented; the paid pilot path is selected at G1, and proposed features are labeled as proposed.
- A capability map identifies existing behavior, adapters with known gaps, and excluded flows.
- Trust boundaries distinguish agent, API, signer, wallet, merchant, RPC and channel program.
- CI/default-branch mismatch is recorded and resolved before relying on required checks.
- Current package scripts and environment assumptions are recorded without secrets.
- Owners, dependencies, test evidence and a stop condition exist for the next task.

Decision: proceed with discovery and baseline repair. Substantive pilot implementation waits for G1. This gate does not prove demand.

## G1 — Paid need

Use the evidence requirements in [customer validation](../product/customer-validation.md#gate-definitions). The product founder records the qualified workflow, paid/committed status, closest alternative and why Atlas is needed.

Decision: authorize the shared pilot slice. An unrelated feature, new rail or new custody backend needs its own customer justification and engineering assessment.

## G2 — Sandbox readiness

All applicable rows require an artifact or test reference for the selected flow. Mark a row not applicable only with a reason and explicit scope exclusion.

| Area           | Acceptance evidence                                                                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Environment    | Localnet/devnet identity validated; unsupported networks rejected at all relevant entry points                                                     |
| Tenancy        | Server-derived tenant context; cross-tenant IDs, exports, approvals and worker jobs denied; no reliance on caller-provided tenant IDs alone        |
| Authority      | Signed mandate and exact request binding; approval roles, expiry and single use verified; unrestricted signing path unavailable to the agent       |
| Budget         | Concurrent workers preserve the parent budget; outstanding authorization exposure remains counted; nested budgets do not create spending authority |
| Retry identity | Same request/intent replays safely; changed bytes fail; legitimate new purchases use distinct intent IDs; provider limitations are exposed         |
| Settlement     | Independent chain/provider evidence resolves outcomes; caller claims cannot release holds; unknown outcomes stay explicit                          |
| Fulfillment    | Paid-but-failed and paid-but-unknown tool outcomes remain distinct from settlement; no claim that a payment signature proves useful delivery       |
| Channels       | Cumulative voucher accounting, watermark changes, close/grace and independent buyer/payee behavior verified                                        |
| Evidence       | Payment status survives receipt/anchor failure; durable evidence export and delayed anchoring recovery demonstrated                                |
| Recovery       | Persist keys before creating dependent accounts; crash/restart and backup restoration preserve liabilities, idempotency and attribution            |
| Isolation      | Agent cannot read signing secrets or reach an unrestricted signer route; access boundaries and the actual sandbox topology are documented          |
| Observability  | Operators can find an intent, attempts, reservation, settlement and unresolved outcome without logging credentials or private payloads             |
| Onboarding     | A partner engineer completes the documented supported path; time and founder intervention are recorded                                             |

Pilot access must have a named operator, bounded participants, agreed resource limits and a tested stop procedure. A hosted sandbox needs authenticated tenant access and protected signer endpoints even when tokens have no real value. A local prototype's optional bearer token is not a public-service access model.

Decision: run the agreed sandbox/shadow evaluation. Never relabel simulated failure injection as an incident prevented in production.

## G3 — Pilot evidence

- The buyer repeats the same workflow and confirms the observed value.
- Reports distinguish historical replay, shadow requests, localnet, devnet and any external production observations.
- Integration time, unresolved outcomes, operator effort, cost to serve and commercial status are recorded using the agreed definitions.
- Every financial inconsistency has an owner and disposition. Unknown outcomes are visible; they are not silently removed from metrics.
- Recovery and revocation behavior match what the buyer was told.
- The team chooses continue, revise or stop. Recurring demand is recorded separately from bespoke integration revenue.

Decision: expand only the demonstrated workflow. More pilots do not expand the network/funds boundary.

## G4 — Release assessment

Prepare a review packet before any broader release decision:

1. Scope, exact source commit, artifact identifiers, supported adapter versions and network.
2. Implementation-versus-claims matrix, including control locations and bypass assumptions.
3. Test reports for financial invariants, failure recovery, tenant isolation and real service integration on the approved test network.
4. Migration/backfill rehearsal, rollback plan and backup restoration evidence.
5. Operational owner, alerts, incident routing, key rotation and recovery procedures.
6. Capacity/latency results with environment, sample size, concurrency and failures; an explicitly chosen service objective rather than an extrapolated demo number.
7. Independent security assessment scope, findings and remediation status where commissioned; no implication that an assessment covers unreviewed changes.
8. Commercial support terms, data handling, retention and customer communication plan.
9. Legal/custody analysis for the proposed operating model if a later real-fund product is considered; the word “non-custodial” alone settles nothing.

The present decision may approve a wider devnet sandbox or defer release. Any future production/mainnet proposal requires a separate approved scope, amended product constraints, suitable custody/signing architecture and its own release decision. This document supplies no instructions to enable mainnet.

## Proposed per-task GitHub workflow

Use one focused branch and PR for each engineering task. Include the task ID, dependencies, acceptance evidence and residual limitations. Keep changes to a collaborator's branch or programs out of an unrelated task.

1. Start from the agreed base with a clean or isolated working tree.
2. Implement only the task's agreed acceptance criteria; record a newly discovered dependency rather than silently adding another product.
3. Run relevant checks, inspect every failure and distinguish a pre-existing failure from a regression with evidence.
4. Push without rewriting published history. Open a draft PR while evidence, checks or review are incomplete.
5. Merge normally only after applicable checks and acceptance criteria pass; do not count missing checks as success.
6. Record the outcome, verification, PR link, remaining gaps and next task in the project progress record.

For an implementation merge, the proposed baseline includes the full application suite plus targeted tests for its financial behavior. For a documentation-only PR, validate Markdown, links, identifiers and command accuracy, and record which application checks ran or were not applicable. Do not create mirror tests just to increase a count.

## Verification commands and their scope

These commands are supported by the current package manifests; the last row targets the playground package. Confirm again if scripts change. Run from the repository root with the expected prerequisites. Do not paste environment files or credentials into a report.

| Command                                         | Scope and prerequisite                                                                                                        |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                | Restore the locked dependency graph; does not establish service readiness                                                     |
| `pnpm typecheck`                                | Workspace TypeScript checks                                                                                                   |
| `pnpm lint`                                     | Configured workspace lint checks                                                                                              |
| `pnpm test`                                     | Current Vitest suite; report skipped and failed cases                                                                         |
| `pnpm build`                                    | Application/package build; inspect package scripts for changed prerequisites                                                  |
| `pnpm test:chain`                               | Local-validator channel scenario; coordinate program artifacts and Solana prerequisites with the on-chain owner               |
| `pnpm demo`                                     | Current local-validator demonstration; requires Solana CLI and appropriate program artifacts                                  |
| `pnpm demo:pay`                                 | Current `pay` integration demonstration; also builds Rust integration dependencies; coordinate the owned scope before running |
| `pnpm --filter @atlas-rail/playground test:e2e` | Playground Playwright suite; requires the configured server and browser prerequisites                                         |

The older `pnpm demo:offline`, `pnpm demo:rehearse` and `pnpm agent:e2e` commands are absent from this baseline's root scripts. Do not copy old run instructions into a new acceptance record. Local checks do not establish hosted deployment health; a deployment needs its own smoke and recovery evidence.

## Evidence and rollback record

Each release record should name date, task/PR, source commit, environment, dependency versions, command/results, measured sample size, redacted report links, known gaps, operator and rollback decision. Preserve dated evidence rather than overwriting a previous run.

A payment already settled cannot be rolled back by reverting code. Rollback means stopping new authorizations safely, preserving signed-voucher and reservation liabilities, disabling the affected adapter, and reconciling existing operations. Database changes must retain enough evidence for the old and new versions to account for outstanding work. Never free a liability merely to make a rollback dashboard look healthy.
