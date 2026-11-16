# Agent purchase lifecycle

Status: **proposed implementation contract**, not a description of shipped APIs.
Baseline reviewed: `4a2572d5124a95aaa90390ada1c2b8032db1214e`.
Scope: localnet/devnet evaluation only. This document does not authorize a real-fund release.

Use [engineering.md](../../engineering.md) for execution order and acceptance gates,
and [whatthisis.md](../../whatthisis.md) for the product and customer context.
The implementation PR for each part must identify which requirements become supported.

## Current behavior and the proposed change

The target is one durable record of an intended purchase, from its authorization
through payment resolution and the reported result of the purchased service.
It must remain correct across retries, concurrent agents and process failures.

| Area                 | Current baseline                                                                                                                 | Proposed extension                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Direct x402          | `AgentSpend` records `RESERVED`, `SETTLED`, `RELEASED`; the client can ask the gate to resolve an uncertain transaction          | Map those records into a purchase and attempts without weakening chain-derived release            |
| Channels             | Durable `VoucherSpend` records cumulative voucher values and incremental charges; SDK distinguishes settlement from distribution | Track issued liability, settlement and distribution separately, with attribution to purchases     |
| `pay` authority      | `(caller_id, operation_id)` binds a request; an allowed operation counts as spent because there is no result callback            | Add an authenticated observation/reconciliation adapter before promising recoverable reservations |
| Approvals            | Owner/approver signatures authorize an exact payment; SDK execution callbacks are a different mechanism                          | Bind the new purchase/attempt context without changing existing signed-format semantics silently  |
| Evidence             | Payment receipts and decision receipts exist; anchoring can fail after payment succeeds                                          | Independent evidence status and durable export, without misreporting the payment                  |
| Business attribution | Existing mandate and organization identities                                                                                     | Explicit customer, task and delegated-agent lineage, with tenant authorization                    |

Current references: [SDK](../../packages/atlasrails/SDK.md),
[manual](../../packages/atlasrails/MANUAL.md),
[`pay` integration](../pay-sh-authority.md),
[schema](../../packages/database/prisma/schema.prisma), and
[voucher store](../../packages/database/src/voucher-spend-store.ts).
For the dated baseline, use the
[pinned SDK](https://github.com/Rime504/atlas-rail/blob/4a2572d5124a95aaa90390ada1c2b8032db1214e/packages/atlasrails/SDK.md)
and [pinned authority implementation](https://github.com/Rime504/atlas-rail/blob/4a2572d5124a95aaa90390ada1c2b8032db1214e/apps/api/src/agent/pay-authority.ts).

## Identities and records

Names below are logical contracts, not new Prisma models already present.

| Record                  | Required meaning                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| Organization            | Authenticated tenant and owner of policy, ledger and private evidence                                    |
| Customer                | The platform's downstream customer; an organization-scoped identifier, never an authorization credential |
| Task                    | One customer job, its budget, lifecycle and immutable customer binding                                   |
| Delegation              | Parent/child agent identities, task scope, allowed actions, ceiling and expiry                           |
| Purchase                | One intended commercial operation, stable across transport and payment attempts                          |
| Attempt                 | One exact quote/request/payment artifact version and the attempt's result                                |
| Authorization           | Signed decision and scope, validity, signing subject and optional consumed human approval                |
| Hold                    | Unspent but committed budget liability for an attempt; durable before a signing request                  |
| Payment observation     | Source, chain/provider reference, evidence, commitment/finality and observed time                        |
| Fulfillment observation | Provider-reported execution/result, separately verified or unverified                                    |
| Evidence bundle         | Versioned links to decisions, approvals, payment evidence and permitted result metadata                  |

Every relevant record includes organization, creation time, schema version and
immutable lineage references. Resolve the organization from authenticated context;
do not accept an arbitrary `organizationId` supplied by the agent as authority.
Verify that customer, task, agent, mandate, channel and approval all belong to the
same authorized lineage. A valid signature from another tenant is insufficient.

Use integer base units, with network and asset identity attached to every amount.
Never add quantities from different assets. SOL fees and account rent are distinct
from the purchased token amount; define a separate fee budget when needed.
Fiat display values are estimates with a source/time, never the enforcement amount.

## Idempotency and immutable binding

The platform supplies a stable purchase idempotency key for its business operation.
Store a uniqueness constraint scoped to `(organization, authenticated caller, key)`.
Keep each attempt separately addressable under the purchase.

Define a versioned canonical purchase fingerprint covering:

- Organization, caller, customer, task and delegation identity.
- Method, resource URL, request-body digest and the headers that affect the purchased result.
- Network, asset, recipient, adapter and commercial operation type.
- The intended service and approved purchase ceiling.

An attempt adds the exact offer/quote digest, amount, mandate hash, approval subject,
channel identity and cumulative voucher value where applicable, expiry and exact
transaction/voucher message hash. Bind all security-relevant inputs before signing.

An identical key/fingerprint returns the existing purchase. A changed fingerprint
returns a stable conflict and creates neither a signature nor a second liability.
A price change within the same immutable purchase intent and ceiling can create a
new versioned attempt only under the retry conditions below, with fresh authorization.
A changed resource, request body or other purchase-fingerprint field requires a new
purchase identity. Neither case can reuse an approval for different bytes.

The implementation PR must specify canonicalization with test vectors: URL and
query handling, body encoding, header order/case, absent versus empty fields and
amount encoding. Preserve the existing `pay` request fingerprint contract at its
adapter boundary. Do not replace its serialization with a different canonical form
under the same protocol version.

Transport retries reuse the same attempt and signing subject. A new payment attempt
for the same purchase is permitted only after the previous attempt is proven unpaid
and no usable payment authority remains. A paid or settled attempt returns its
existing result or resumes distribution/fulfillment; it must never start a second
charge under that purchase. An intentional additional charge requires a separately
authorized new purchase that counts both exposures. Changing an idempotency key is
not a way to release the old hold.

## Independent state dimensions

A single `SUCCESS` flag is inadequate. Store state per dimension and derive the
operator's summary from those states. State labels below are proposed vocabulary.

| Dimension     | States                                                                                           | Interpretation                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Purchase      | `OPEN`, `CANCEL_REQUESTED`, `CLOSED`                                                             | Cancelling work does not cancel issued payment authority                           |
| Authorization | `UNDECIDED`, `AWAITING_APPROVAL`, `DENIED`, `AUTHORIZED`, `INVALIDATED`                          | Authorization alone proves neither signature nor payment                           |
| Signing       | `NOT_REQUESTED`, `REQUESTED`, `ISSUED`, `UNKNOWN`, `REFUSED`                                     | A signer timeout is unknown, not proof no signature exists                         |
| Liability     | `NONE`, `HELD`, `COMMITTED`, `CAPTURED`, `RELEASED`                                              | Committed means signed but unresolved; captured means transferred to settled spend |
| Payment       | `NOT_SUBMITTED`, `UNKNOWN`, `SETTLED`, `DISTRIBUTION_PENDING`, `PAID`, `FAILED_FINAL`            | Channel settlement and payee distribution are separate steps                       |
| Fulfillment   | `NOT_REQUESTED`, `UNKNOWN`, `PROVIDER_REPORTED_SUCCESS`, `PROVIDER_REPORTED_FAILURE`, `VERIFIED` | A provider claim is not automatically independently verified delivery              |
| Evidence      | `PENDING`, `AVAILABLE`, `ANCHOR_PENDING`, `ANCHORED`, `ERROR`                                    | Anchor failure never rolls back a real payment                                     |

An operator case such as `PAID / PROVIDER_REPORTED_FAILURE` stays visible until
resolved. It must not be transformed into an unpaid failure for convenience.
`CLOSED` requires resolved liabilities or an explicit retained exception record;
closing the task must not remove unresolved purchases from reconciliation.

## Authorization, signing and settlement transitions

| From / event                    | Required checks and durable action                                                                 | Result                                                        |
| ------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| New purchase                    | Authenticate lineage; validate fingerprint; register idempotency binding                           | `OPEN`, no financial authority                                |
| Request needs a human           | Persist exact approval subject and expiry; no signature                                            | `AWAITING_APPROVAL`; no signing liability yet                 |
| Request denied                  | Persist decision and supported decision evidence                                                   | `DENIED`; no new hold or signature                            |
| Allow under all ancestor limits | In one database transaction, claim attempt, reserve budget, bind approval and persist signing work | `AUTHORIZED`, `HELD`                                          |
| Worker requests signature       | Use persistent signing idempotency key and exact artifact hash                                     | `REQUESTED`; hold remains                                     |
| Signature returned              | Persist artifact identity before returning it to caller; record signer outcome                     | `ISSUED`, `COMMITTED` liability                               |
| Signer response lost            | Reconcile the same signing request; never create replacement authority blindly                     | `UNKNOWN`; liability remains                                  |
| Transaction submitted           | Persist exact signature/message reference and enqueue observation                                  | Payment `UNKNOWN` until verified                              |
| Direct payment finalized        | Verify exact authorized message, recipient, asset, amount and successful chain execution           | `PAID`; move liability to settled spend once                  |
| Channel settlement finalized    | Verify channel and settled watermark from chain                                                    | `SETTLED` or `DISTRIBUTION_PENDING`; retain distribution work |
| Channel distribution finalized  | Verify actual payee delta and correct channel                                                      | `PAID`; do not charge budget a second time                    |
| Definitive non-settlement       | Prove the artifact failed or can no longer settle; reconcile all observations                      | `FAILED_FINAL`; release only the proven unspent liability     |
| Merchant result arrives         | Authenticate and correlate provider operation; keep source evidence                                | Update fulfillment separately                                 |
| Receipt/anchor fails            | Persist failure and retry evidence work only                                                       | Payment state remains unchanged                               |

When settlement is verified, mark the corresponding liability `CAPTURED` and record
the settled debit atomically. The same amount must never count as both outstanding
liability and settled spend. Channel distribution changes delivery of funds, not
that capture accounting.

Atomic approval consumption and hold creation must share a transaction or have a
recoverable claim protocol with a durable unique subject. A worker crash must not
spend an approval without a way to resume the same authorized attempt.

Expiry and revocation prevent fresh authorization according to the enforcement
path. They do not prove an already-issued signature has become unusable.
Recheck policy at signing/broadcast boundaries where supported; retain outstanding
exposure until the adapter proves the instrument cannot settle.

## Budget conservation across customers and subagents

The first implementation uses child ceilings on a shared parent budget, not earmarked
fund allocations. Creating a child does not create money or promise the child an
exclusive balance. Every spend must pass the organization/customer/task/delegation
constraints applicable to it.

For every hard-limit scope and asset:

```text
available = ceiling - settled_spend - outstanding_liability
available >= 0
```

The same leaf purchase contributes once to each applicable ancestor's projection.
Do not add parent projection totals to child projection totals to compute company
spend; that would count the same purchase repeatedly. The source is the unique set
of leaf financial entries. Cancelling a child does not erase its contributions.

Lock shared budget ancestors in deterministic order within the database transaction,
then check and reserve. A process-local mutex is not sufficient across API replicas.
For the first slice, serializing authorization under the common parent scope is
acceptable; optimize only after measuring contention without weakening invariants.

Existing advisory-lock helpers are not proof that all callback writes form one
atomic transaction. The new ledger path must pass the same transaction client to
purchase, approval, budget and outbox writes, and verify rollback under injected
failure. Separate commits under a common lock still leave crash-consistency gaps.

Rolling windows require an explicit event-time contract. Preserve existing signed
mandate semantics at the adapter boundary. An unresolved issued liability must not
vanish merely because its authorization timestamp crosses a window boundary.
Human approval can override only the mandate rules it explicitly permits; it cannot
override a newly introduced hard task ceiling without a separately authorized change.

If earmarked allocations are introduced later, their creation must reserve parent
capacity, and consumption must convert allocation to spend without counting both.
That is a separate contract and migration, not an implicit meaning of `childBudget`.

## Channel-specific accounting

Persist channel identity, network/asset, deposit, authorized signer, payee, highest
issued cumulative amount, finalized settled watermark and distributed amount.
These describe different facts. Read channel state from the approved chain adapter.

For a channel with deposit `D`, highest issued watermark `I`, and finalized settled
watermark `S`, the intended accounting invariant is `0 <= S <= I <= D`.
The first slice conservatively retains the entire issued prefix while the channel
can issue or accept vouchers, even when an individual voucher has expired. With
that prefix still counted as settled spend or outstanding liability, a new cumulative
voucher `C > I` creates additional liability `C - I`, not `C`.
Outstanding settlement exposure remains at least `max(0, I - S)` until terminal
reconciliation. External or inconsistent channel activity freezes new issuance and
opens reconciliation; do not silently invent ledger entries to make it balance.

Release unspent channel liability only after finalized proof of an irrevocable
seal/close that makes the remaining vouchers unusable. Mark issuance permanently
disabled for that channel and reconcile any final settlement before releasing.
Keep `I` as audit history; never reset it to manufacture available authority.
The generic failed/expired-payment release rule therefore does not release a
voucher prefix while its channel remains open in this first implementation.

This restriction prevents a cumulative-prefix bug: releasing an expired `80` voucher
and then charging only `90 - 80 = 10` for a fresh `90` voucher would undercount the
new authority. Supporting expiry-based release on reusable channels later requires
a separate contract that re-reserves every previously released prefix. It is excluded
from the first slice.

Example only: vouchers for cumulative values `3`, `5`, and `8` create increments
`3`, `2`, and `3`. They represent total authority `8`, not `16`.
If the last voucher settles first, the incremental purchase attribution still comes
from the issuance ledger. Attribute only what the available evidence supports;
record ambiguity instead of fabricating a service-level mapping.

Settlement consumes the already-counted exposure. Distribution does not create a
second purchase. Channel deposits and top-ups move liquidity into escrow; they do
not themselves prove purchases or increase a signed mandate's ceiling.

The current channel contract does not read the mandate. Already-signed vouchers can
be submitted directly while the contract permits them. Payer-only close has a grace
period; immediate sealing requires payee cooperation. A commercial pilot must use
independent buyer and merchant identities rather than assume the buyer holds the
merchant's private key. Show the grace and maximum outstanding exposure explicitly.

Do not release signed-voucher liability on a caller's claim of expiry or cancellation.
The channel adapter must establish the terminal sealing/closing condition, finalized
state and absence of remaining settlement possibility. Unknown state remains held.

## Refunds, retries and service failures

A return of unused channel escrow is not a refund of a purchased service. Record
liquidity returned, purchase refunds and fee/rent recovery as separate movements.

A service refund becomes a linked credit only after the applicable payment evidence
is verified. Preserve the original debit, refund actor, amount and source reference.
Default policy does not automatically restore historical lifetime or rolling spending
authority from a refund; any restoration policy must be explicit, bounded and tested.

The purchase ledger guarantees idempotent Atlas decisions within its supported
boundary. It cannot guarantee exactly-once execution at an arbitrary merchant.
Require merchant idempotency and a queryable operation reference before automatic
retries of an ambiguous tool execution. If unavailable, stop and open an operator
case; do not automatically buy again or fail over to a different paid provider.

The current `pay` adapter has no completion callback. Keep its conservative counted
allow behavior until a trustworthy result path exists. A future authenticated callback
is evidence to reconcile, not sufficient proof to release money by itself. Correlate
it with the exact operation and chain/provider settlement record. No future callback
route is specified or claimed as implemented by this document.

## Crash recovery and durable work

Write state changes and an outbox event in the same database transaction. Workers
use leases and idempotent handlers; delivery may occur more than once. Store unique
event ids and monotonic record versions to reject stale or duplicate observations.

Persist the hold and signing request before contacting the signer. The signer must
support retrieval/repetition of the same authorized artifact or a reliable outcome
query. If it cannot, treat a lost response as unresolved financial exposure.

Persist keys through the supported custody boundary before opening/funding a channel.
Recover from stored key identifiers and public channel records; never regenerate an
agent key and assume it controls an existing channel. Backup/restore exercises must
include outstanding holds, signer references, outbox jobs and independent chain reads.

After restart, reconcile nonterminal attempts, issued vouchers, partial distributions,
pending refunds and missing evidence. Retry observation with bounded backoff. Repeated
RPC failure produces an operator alert and holds authority; it does not free funds.
Use chain finality evidence and explicit reorganization handling, not elapsed wall
time alone, before marking payment final or releasing a transaction that may still land.

## Evidence, privacy and access

Store a versioned, authenticated event history with who/what/when, previous record
version, reason and evidence source. Correct mistakes through linked compensating
events; do not rewrite the original payment history.

Default private bundles include request/result digests and redacted metadata, not
prompts, API tokens, customer documents, sensitive URL query strings or signing keys.
Customer-facing APIs, webhooks and exports enforce tenant and role checks. Public
receipt publication must be a distinct opt-in choice with documented disclosure.
Hashes can reveal low-entropy values by guessing; hashing alone is not anonymization.

Record evidence location, retention policy, export permissions and deletion behavior.
An on-chain root proves inclusion of retained bytes; it does not store those bytes,
prove useful service delivery or establish legal authority. Evidence failures stay
visible without relabeling a settled purchase as unpaid.

## Migration and adapter compatibility

Introduce schema changes additively and preserve verification of old receipts and
signed approvals. Do not relabel old evidence with a new schema/version or recompute
an old signature subject under new canonicalization.

Backfill organization/task attribution only from verified ownership records.
The current `VoucherSpend`, `OwnerApproval`, `PayOperation` and `PayDecisionReceipt`
tables do not all carry explicit organization relationships. Unknown ownership must
be quarantined for reconciliation, not assigned using a caller-supplied tenant id.

Map existing direct `AgentSpend` statuses and settlement evidence explicitly. Keep
historical `pay` allows counted while payment outcome is unknown. Keep signed
voucher exposure and watermarks intact. A migration may not create available budget
by treating missing settlement evidence as evidence of failure.

Record a read-only comparison of old and new accounting on the same fixtures before
switching a writer. Prevent both ledgers from independently authorizing the same
budget during rollout. Rollback must preserve newly issued liabilities; a code
rollback cannot safely restore an earlier financial snapshot after signatures exist.
Review this contract in E04, then implement the sequence in [engineering.md](../../engineering.md).

## Required failure acceptance cases

These are proposed acceptance tests, not results already measured.

| Case                                                    | Required observable outcome                                                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Concurrent sibling agents near a parent cap             | Total unique settled spend plus outstanding liability never exceeds the hard cap across API processes                           |
| Duplicate identical purchase request                    | Same purchase/attempt result; no duplicate hold, authorization or charge                                                        |
| Same key with altered customer, amount or resource      | Conflict before signing; original binding preserved                                                                             |
| Cross-tenant purchase/approval/channel reference        | Refused with no disclosure of another tenant's record                                                                           |
| Human approves while policy or quote changes            | Stale approval cannot authorize changed bytes; fresh decision required                                                          |
| Crash before/after signature response                   | Durable liability remains; recovery obtains the original outcome without blindly issuing another artifact                       |
| Paid request times out                                  | Settlement and fulfillment remain separate; no automatic second purchase                                                        |
| Caller claims a settled payment failed                  | Settled spend remains counted; false callback cannot release it                                                                 |
| Voucher totals arrive concurrently or out of order      | Issued watermark and incremental charges stay consistent; older settlement cannot reduce recorded liability incorrectly         |
| Settlement succeeds, distribution fails                 | Payment shows partial state; retry distribution only after reconciliation                                                       |
| Revoke after voucher issuance                           | New issuance stops; exposure stays counted until terminal channel reconciliation; independent merchant flow covered             |
| Expired voucher followed by a higher cumulative voucher | Earlier prefix remains counted on an open channel; no under-reservation after expiry, and a terminal channel cannot issue again |
| Task cancelled with outstanding purchases               | Work stops; holds and issued liabilities remain visible and counted                                                             |
| Refund or unused escrow return repeats                  | One verified movement recorded; no duplicate budget credit or artificial revenue                                                |
| Anchor/store outage after payment                       | Paid status preserved; evidence backlog retries without another payment                                                         |
| Database restore or worker redelivery                   | Uniqueness and budget invariants survive; reconciliation identifies unresolved external effects                                 |
| RPC stale/unavailable or conflicting observations       | No unsupported final verdict; new authority fails closed where required                                                         |

Record commit, adapter version, environment, scenario, expected/actual result and
evidence location for each implementation check. Preserve current behavior until the
corresponding migration and adapter conformance cases pass. Promote this contract
from proposed to implemented only through the execution plan's review gates.
