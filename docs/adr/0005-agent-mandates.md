# ADR 0005: Agent Mandates — authority and evidence for x402 agent payments

Status: accepted (devnet only) · Depends on: ADR 0002 (event ledger), ADR 0003 (signer boundary), ADR 0004 (devnet only)

## Context

x402 lets an HTTP server answer `402 Payment Required` and lets a client pay and retry. Wallet vendors
(Coinbase, Crossmint, Turnkey, Privy) already ship basic per-agent spend limits, so per-key limits are not the gap.
The gap is the one described in [x402 issue #3500](https://github.com/x402-foundation/x402/issues/3500)
("Dispute evidence for agent-initiated payments"): a payment can be cryptographically valid and still be outside what the
user authorised, and there is no machine-readable, signed authorisation artifact and no way to bind a receipt to the scope
that allowed it.

Atlas Rail already owns the surrounding controls: a policy engine, multi-approver flow, a `SignerAdapter` boundary, simulation,
an append-only audit trail and signed webhooks. This ADR reuses them and adds three artifacts.

## Decision

Atlas Rail becomes the **authority and evidence layer for agent payments**.

1. **Agent Mandate** — a signed, expiring, revocable grant of spending authority to one agent key. Canonicalised with
   RFC 8785 (JCS), hashed with SHA-256, signed with Ed25519 by an ordered delegation chain
   (issuer OWNER → independent APPROVER(s) → the AGENT that accepts it). Each link signs over the previous link's signature, so
   re-ordering, dropping or substituting a link invalidates every later link.
2. **Policy Gate** — a pure function `evaluateGate(mandate, offer, context)` run *before* anything is signed. It returns
   `ALLOW | DENY | ESCALATE` plus every rule it evaluated. Rules are ordered and named, and each result carries a stable rule id.
3. **Bound Receipt** — a tamper-evident record that binds mandate hash, canonical x402 offer, decision record, settlement transaction
   signature, response hash and timestamp, signed by the Atlas Rail instance key. Receipts are batched into a Merkle tree whose root is
   anchored on Solana devnet with a Memo instruction. `atlas verify` re-checks all of it offline plus one RPC read.

### Rule semantics: hard vs. approvable

The brief's demo needs a $5/day mandate that still lets a human approve a $40 purchase. That only makes sense if some limits are
*autonomous budgets* and others are *hard ceilings*. Each rule therefore has one of two failure modes:

| Rule | Failure mode |
|---|---|
| OFFER_WELL_FORMED, MANDATE_SIGNATURES, MANDATE_VALIDITY, MANDATE_NOT_REVOKED | **DENY** |
| NETWORK_ALLOWED, ASSET_ALLOWED, PAYTO_ALLOWED | **DENY** |
| MAX_PER_PAYMENT (hard ceiling), MAX_TOTAL (hard lifetime cap) | **DENY** |
| TRANSACTION_SIMULATION (incl. "transaction pays exactly the offer") | **DENY** |
| RESOURCE_ALLOWED — outside `scope.allowedResources` but inside `escalation.resources` | **ESCALATE** (otherwise DENY) |
| WINDOW_BUDGET — rolling-window autonomous budget exceeded | **ESCALATE** |
| ESCALATION_THRESHOLD — amount above `escalation.thresholdBaseUnits` | **ESCALATE** |

Any DENY wins. Otherwise any ESCALATE yields `ESCALATE`. Otherwise `ALLOW`. All rules are always evaluated (except those that
cannot be meaningful after an integrity failure, which are marked `SKIPPED`), so the console can highlight *every* rule that failed
— the prompt-injection demo shows both `PAYTO_ALLOWED` and `MAX_PER_PAYMENT` failing.

A human approval is bound to the exact offer hash, expires, is single-use, and can only override the *approvable* rules. Hard rules
are re-evaluated when the agent retries with the approval.

### Enforcement point

A cooperative client library is not enforcement. The gate therefore issues a short-lived `GateAuthorization` (Ed25519 by the instance
key) bound to the *transaction message hash*. `GatedSignerAdapter` wraps any `SignerAdapter` and refuses to sign unless handed a valid
authorisation for exactly those bytes. Custody vendors integrate this check into their own policy engines; the reference wrapper
demonstrates the contract. This closes the confused-deputy case where an agent asks the gate about offer A and then signs a
transaction paying B.

### Reuse of existing components

| Need | Reused component |
|---|---|
| Base-unit money math | `@atlas-rail/domain` `compareBaseUnits` / `addBaseUnits` (no floats anywhere) |
| Independent approver | `preventCreatorApproval` semantics: an approver key/user must differ from the issuer |
| RBAC | `hasPermission` with new additive permissions (`mandate:*`, `approval:decide`, `agent:gate`, `receipt:*`) |
| Signing | `SignerAdapter` (extended with `MessageSigner` for Ed25519 message signatures) |
| Simulation | `DevnetTransactionSimulator` + program-id allowlist (extended for versioned transactions) |
| Approval requests / notifications | multi-approver flow semantics + signed webhooks (`agent.approval.requested`, …) |
| Audit | `AuditEvent` rows for every decision, plus dedicated append-only decision/receipt tables guarded by DB triggers |
| Devnet safety | `assertNotMainnet`, boot-time env validation, mock-signer production guard |

### Idempotency

The gate is idempotent on `(mandateId, requestNonce)`: the same nonce with the same request hash replays the stored decision; the
same nonce with a different request is a `409`. Receipts are idempotent on `decisionId`. Spend is *reserved* in the same
serialisable transaction that records an ALLOW so concurrent requests cannot jointly exceed a cap.

### Packages

- `packages/mandate` — framework-free: JCS, Ed25519 helpers, mandate create/sign/verify/hash, resource matching, gate, decision records.
- `packages/receipt` — bound receipts, Merkle tree, anchor memo format, offline verifier.
- `packages/x402-client` (`@atlas-rail/x402`) — `fetch` wrapper; uses the official `@x402/core` codecs and types.
- `apps/demo-api`, `apps/demo-agent` — a paid x402 API with a local facilitator built from the official `@x402/svm` scheme, and a scripted agent.
- `apps/cli` — `atlas verify`.

## Consequences

- The Atlas Rail instance key becomes a trust anchor for evidence (not for funds). In devnet it is a keypair in the local keyring;
  in production it must live behind the same `SignerAdapter` boundary as any other key (HSM/KMS).
- Whether a chain's public keys were *authorised for the organisation* is attested by the instance signature; a third party that does
  not trust the instance can still verify chain integrity and can pin trusted signer keys (`--trusted-key`).
- Human "signing" in the demo uses devnet keys held by the local keyring after the user authenticates. Production signing must go
  through a customer-controlled `SignerAdapter` (WebAuthn, HSM, MPC). This is a stated limitation.
- Two Solana SDK generations coexist: Atlas Rail core uses `@solana/web3.js` v1; the official x402 SVM packages use `@solana/kit`.
  The x402 client builds the payment transaction with web3.js (same instruction layout as the reference scheme) so it can be signed
  through `SignerAdapter`; the demo facilitator uses the official kit-based implementation.
- The spec (`spec/agent-mandate-v0.1.md`) is a **proposal**, not an adopted x402 extension.
