# What Atlas Rail is

Status: product reference and proposed next product scope. Baseline reviewed: public `master` at `4a2572d5124a95aaa90390ada1c2b8032db1214e`, 16 November 2026. Proposed capabilities below are not claims that they already work.

## Start here

Atlas Rail is a devnet implementation of spending authorization and payment evidence for AI agents on Solana. A signed mandate describes spending authority. A gate checks a payment before the configured signer authorizes it. Decisions, settlement records and anchored receipts provide evidence that can be inspected and verified under explicit trust assumptions.

The next product hypothesis is **a purchasing control and reconciliation service for B2B agent platforms buying external data and tools for their customers**. It would connect a customer's task budget to authorization, settlement, delivery status and purchase accounting. That workflow is proposed; the current repository implements important components, not the complete service.

The founder confirmed during the November research discussion that customer traction has not yet been established. Paid demand, pricing, distribution and product-market fit remain unverified. The first execution milestone is a paid customer problem, not a production launch.

### Reading order and document ownership

| Document                                                                                  | Use it for                                                                | Maintained by              |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------- |
| This file                                                                                 | Product identity, current versus proposed scope, customer and boundaries  | Product owner              |
| [engineering.md](engineering.md)                                                          | Ordered work items, dependencies, acceptance tests and PR workflow        | Engineering owner          |
| [Customer validation](docs/product/customer-validation.md)                                | Interviews, paid pilot decisions, pricing experiments and stop conditions | Commercial owner           |
| [Purchase lifecycle](docs/architecture/agent-purchase-lifecycle.md)                       | Proposed states, accounting invariants, identity and recovery contract    | Engineering owner          |
| [Release gates](docs/operations/release-gates.md)                                         | Evidence required to progress through sandbox and pilot stages            | Release owner              |
| [SDK manual](packages/atlasrails/MANUAL.md) / [SDK reference](packages/atlasrails/SDK.md) | Current install, methods, operating instructions and limits               | SDK maintainer             |
| [Progress](docs/PROGRESS.md)                                                              | Short dated records of completed work and the next task                   | Person completing the task |

Keep existing [mandate specification](spec/agent-mandate-v0.1.md), [security documents](docs/security/threat-model.md), [architecture documents](docs/architecture/system-overview.md) and [ADRs](docs/adr/) as their respective references. This proposal does not silently change wire formats, verification rules or historical evidence. Record such decisions in an ADR before implementation.

## The customer and the job

Start with a B2B research, enrichment or data-processing platform whose agents already buy third-party resources, or whose committed customer launch is blocked by missing purchase controls. The platform must have a named owner of customer budgets, purchase exceptions or task margins.

The initial buyer is likely the founder, CTO or platform engineering lead. Finance needs allocation and reconciliation. Security evaluates authority and key handling. Sellers participate when their execution, idempotency or refund behavior needs integration; seller demand for Atlas receipts is not assumed.

Qualifying evidence includes recent purchase logs, failed-purchase examples, a current control diagram and a buyer willing to evaluate a priced solution. Interest in agents, a wallet address, a hackathon demo or a free letter of intent is insufficient by itself.

### Example of the intended experience

The following amounts are illustrative, not measured usage or product defaults.

A customer orders a research task. The platform permits $20 of external purchases, with human review above $3 for an individual purchase. Several subagents share the task budget. One request times out after payment. Another returns an error after the service provider has been paid.

Atlas should eventually let the operator answer:

1. Which customer and task authorized each purchase?
2. What amount is available, reserved, exposed through signed vouchers, settled or returned?
3. Did money move, and was the tool result received?
4. Can a retry safely reuse the same purchase, or does it require a new decision?
5. Which exception needs a human or a merchant refund?
6. What belongs on the customer's purchase statement?

The proposed workflow is:

`customer task → bounded authority → purchase intent → gate and reservation → configured signer/payment adapter → settlement reconciliation → delivery status → customer allocation and evidence`

Every stage needs its own meaning. An authorization is not a settlement; a settlement is not proof that a useful service was delivered.

## What exists at the reviewed baseline

| Capability                                                                       | Current evidence                                                                                                                             | Practical boundary                                                                                                                |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Signed mandates and deterministic rules                                          | [Mandate package](packages/mandate/src/gate.ts), [spec](spec/agent-mandate-v0.1.md)                                                          | Rules evaluate recorded inputs; signatures alone do not prove every input is truthful                                             |
| Exact-payment gate and spend reservations                                        | [Gate service](packages/mandate/src/service/gate-service.ts), [database stores](packages/database/src/agent-stores.ts)                       | Not the same lifecycle as the channel voucher or `pay` authority path                                                             |
| Restricted signing                                                               | [Gated signer](packages/x402-client/src/gated-signer.ts), [signer service](apps/signer)                                                      | Requires a real isolation boundary and trusted configuration; a separate process is not sufficient if the agent can read its keys |
| Channel opening, cumulative vouchers, settlement, distribution, close and refund | [SDK manual](packages/atlasrails/MANUAL.md), [SDK client](packages/atlasrails/src/sdk-client.ts)                                             | Escrow bounds channel funds; the channel program does not enforce the entire mandate                                              |
| Owner/approver wallet signatures for exceptions                                  | [Owner approvals](apps/api/src/agent/owner-approvals.ts), [manual](packages/atlasrails/MANUAL.md#owner-approval-signed-by-the-owners-wallet) | Approval is scoped and single-use; SDK `onApprove` alone is not the same security control                                         |
| Persistent voucher and operation records                                         | [Voucher store](packages/database/src/voucher-spend-store.ts), [pay operation store](packages/database/src/pay-operation-store.ts)           | Do not assume a complete organization/customer/task ledger or uniform tenant isolation                                            |
| Solana `pay` spending-authority integration                                      | [Integration contract](docs/pay-sh-authority.md)                                                                                             | Documentation identifies an upstream hook under review and no payment-result callback                                             |
| Receipt verification and anchoring                                               | [Receipt package](packages/receipt), [CLI](apps/cli), [SDK reference](packages/atlasrails/SDK.md)                                            | Trust configuration, receipt availability and successful anchoring matter independently                                           |
| Operator console, playground and demos                                           | [Console](apps/web), [playground](apps/playground), [README](README.md)                                                                      | Demonstrations and local behavior are not evidence of hosted production operations                                                |
| Ordinary treasury payouts                                                        | [Treasury architecture](docs/architecture/payout-lifecycle.md)                                                                               | Existing adjacent capability; not the first customer hypothesis for this plan                                                     |

The existing benchmark in [the October 27 local report](reports/pay-authority-local-2026-10-27.json) covers 500 requests and reports median 41.9 ms and p95 68.2 ms on a local validator. It is historical local evidence, not a hosted-service latency or availability commitment. Any new claim requires evidence for the exact version, path and environment.

## What is proposed, not yet established

- A consistent purchase identity connecting organization, customer, task and subagent across supported payment paths.
- Durable parent and child budget accounting that cannot create extra authority through delegation.
- Independent settlement reconciliation plus separate service-delivery and refund status.
- Organization-scoped credentials, authorization and private purchase evidence across every new path.
- A small operator workflow for unresolved purchases and customer allocation.
- An installable supported SDK path and an operational devnet sandbox.
- Paid recurring customer use, a price customers accept and a repeatable acquisition channel.

These are work hypotheses. [Engineering](engineering.md) makes them conditional on customer and safety gates rather than a promise to build all of them.

## Trust boundaries that must remain explicit

### Money and networks

The supported scope is localnet/devnet with test assets. No mainnet enablement, real-money custody, token launch or contract upgrade is authorized by these planning documents. An external assessment or successful pilot does not automatically change that scope.

### Gate, signer and channel are different controls

The SDK checks the mandate before requesting a voucher and again before settlement when its default on-chain requirement is enabled. The gate checks policy and records spending authority. The signer verifies the authorization data it receives. The channel checks voucher signatures, channel status and cumulative watermark; it does not read the mandate.

Consequently, a pre-signed voucher can remain redeemable after mandate revocation until the channel is sealed. Immediate closure depends on the documented payee cooperation path; payer-only closure has a grace period. A buyer should not need a seller's private key. Demonstrate independent buyer and seller operation before making stronger claims.

### Existing budget semantics

The current mandate has hard per-payment/lifetime constraints and a window rule that can escalate for human approval. A proposed hard task budget is a separate, explicit constraint. Do not silently redefine existing window behavior or invalidate historical receipts while adding it.

### Unknown outcomes

The existing exact-payment path resolves settlement uncertainty from chain evidence. The `pay` authority integration currently charges an allow without receiving a settlement result. Channel signing creates a redeemable liability before funds necessarily reach the seller. Treat these as distinct adapter behaviors until a tested contract unifies their accounting.

### What evidence proves

A receipt can bind signed authority, recorded decisions and transaction evidence. Merkle inclusion establishes inclusion in a batch. Neither establishes merchant honesty, useful output, an employer's legal authorization, comprehensive capture of all spending or an obligation to compensate a loss.

The SDK documents partial settlement/distribution outcomes and anchoring failures. A paid transaction with `anchorError` must remain paid with an evidence problem; it must not be retried as a fresh purchase merely to obtain an anchor.

### Private data and availability

Existing public verification demonstrations are not the storage policy for customer purchases. Proposed pilot records are private by default. Keep secrets, prompt bodies, sensitive URLs and customer identifiers out of public receipts and on-chain data. A root on Solana does not preserve the underlying receipt file; storage, export, retention and recovery need their own controls.

## Why this might be a business

The proposed value is reduced engineering/support work and a controlled path to buying external services for customer tasks. It must be demonstrated through customer workflow evidence: integration effort, time spent reconciling exceptions, repeat usage and willingness to renew.

The hypothesis is a platform subscription with included usage and predictable overages. Prices in [customer validation](docs/product/customer-validation.md) are experiments, not a published price list or measured willingness to pay. Separate paid implementation/evaluation fees from recurring product revenue. Measure signing, RPC, storage, anchoring, operations and support costs together.

Possible defensibility comes from embedded distribution, difficult integrations, reliable recovery and evidence of handling real customer exceptions. Caps, signatures, hashes and an open specification alone do not establish a moat. A useful incident dataset also requires reliable outcomes and permission to use the data.

### Competitive reality

The November evaluation reviewed [Coinbase Agentic Wallets](https://www.coinbase.com/developer-platform/discover/launches/agentic-wallets), [Privy](https://docs.privy.io/agent-wallets/overview), [Turnkey](https://docs.turnkey.com/solutions/company-wallets/agentic-wallets), [Google AP2](https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol), and [Nevermined's LangChain integration](https://www.langchain.com/blog/agents-that-pay-how-nevermined-empowers-langchain-agents-to-buy-and-sell-services). Their documentation already overlaps limits, delegation, approvals or purchase traces. Vendor descriptions are not independent security evaluations.

Every pilot must identify the exact remaining gap in its current stack. Do not claim Atlas invented mandates, is the only policy layer outside the model, or has a cross-provider advantage without tested integrations. A new standard, automatic seller demand for receipts and a data network effect remain unproven.

## Scope choices

Keep the mandate/gate/signing/receipt engine and extend existing stores and adapters. First support the narrow workflow selected by a paid partner. A second provider is conditional on a demonstrated need, not a prerequisite for the first pilot.

Trading agents, lending, insurance, cards, a token, universal payment routing, every-chain coverage and a new custody system are outside this execution plan. Existing treasury and demo flows remain regression surfaces, not an excuse to broaden the first product. A change in direction should be documented as a new scope decision with evidence.

## Where the implementation lives

| Area                                                          | Primary paths                                                          |
| ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| API and purchase adapter entry points                         | `apps/api/src/agent/`                                                  |
| Gate/rule semantics                                           | `packages/mandate/src/`                                                |
| Signing boundary                                              | `packages/x402-client/src/`, `apps/signer/`                            |
| SDK and channel lifecycle                                     | `packages/atlasrails/src/`                                             |
| Identity, policy, operation and ledger persistence            | `packages/database/prisma/schema.prisma`, `packages/database/src/`     |
| RPC reads and settlement evidence                             | `packages/solana/src/`                                                 |
| Receipts, verification, anchoring                             | `packages/receipt/src/`, `apps/cli/`                                   |
| Workers and reconciliation/export patterns                    | `apps/worker/src/`                                                     |
| Operator product                                              | `apps/web/src/app/`, `apps/web/src/lib/`                               |
| Public education and demonstration                            | `apps/site/`, `apps/playground/`, `scripts/`                           |
| Protocol/program work requiring its maintainer's coordination | `programs/atlas-mandate/`, external payment-channel and `pay` projects |

## Decisions still open

The first paid buyer, selected payment path, acceptable exception workflow, price, service budget, tenant deployment model and production custody provider are not settled. The actual upstream integration/deployment versions must be rechecked before relying on them. Founder capacity and available budget must be agreed before assigning delivery dates.

Read [engineering.md](engineering.md) and start with **E00**. Commercial work **E01–E03** determines whether the larger implementation should proceed.
