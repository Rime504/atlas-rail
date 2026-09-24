# Agent Mandate v0.1

**Status:** Draft proposal. Not adopted, endorsed or reviewed by any standards body, wallet vendor or x402 maintainer.
**Reference implementation:** Atlas Rail, `packages/mandate` and `packages/receipt`. **Network scope:** Solana devnet only.
**Related:** the x402 agent-authorization discussion referenced as issue #3500 in the Atlas Rail project brief (the tracker was not re-checked when this draft was written; confirm the link before citing it publicly).
**Machine-readable artefacts:** [`packages/mandate/schema/agent-mandate-v0.1.schema.json`](../packages/mandate/schema/agent-mandate-v0.1.schema.json) (JSON Schema, generated from the implementation) and [`spec/test-vectors/agent-mandate-v0.1.json`](test-vectors/agent-mandate-v0.1.json) (conformance vectors, checked in CI).

## 1. Motivation

An x402 client pays whatever a server's `402 Payment Required` response asks. For a human clicking a button that is fine. For an autonomous agent it is an open wallet: a prompt-injected or buggy agent will pay an attacker's `payTo` as readily as a legitimate one.

Existing mitigations live inside the agent (which the attacker controls) or inside a custody product (which cannot see *why* the agent is paying). This proposal defines two small, portable artefacts:

1. **Mandate:** a signed, revocable statement by an organisation of what a specific agent key may pay, to whom, how much, and when a human must be asked.
2. **Bound receipt:** after a payment settles, a single document that binds the mandate, the policy decision, the on-chain settlement and the seller's response, so a third party can verify all of it offline.

Anything that can verify an Ed25519 signature and compute SHA-256 can implement a verifier. The Policy Gate that produces decisions is specified as a pure function so a recorded decision can be replayed by an auditor.

Non-goals: defining a wallet, a facilitator, an approval UI, or a mainnet deployment. Nothing here is audited.

## 2. Conventions

- Keys are Ed25519. Public keys and signatures are base58 (Solana address encoding, 32 and 64 bytes).
- Hashes are SHA-256, lowercase hex.
- Amounts are non-negative integer strings of base units (no floats, no exponents, no leading zeros except `"0"`).
- Timestamps are integer unix seconds.
- "Canonical JSON" is RFC 8785 (JCS). Implementations MUST reject `undefined`, non-finite numbers, lone surrogates and non-plain objects rather than coerce them.
- Networks are CAIP-2 identifiers. v0.1 permits only Solana devnet (`solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`).

## 3. Data model

### 3.1 Mandate

```jsonc
{
  "type": "atlasrail.mandate", "version": "0.1",
  "id": "mnd_…",
  "issuer":   { "organizationId": "org_…", "name": "Atlas Demo Imports" },
  "agent":    { "publicKey": "<base58>", "label": "Research Agent" },
  "delegation": { "requiredApprovals": 1, "preventIssuerApproval": true },
  "scope": {
    "allowedNetworks": ["solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"],
    "allowedAssets":   ["<mint>"],
    "allowedPayTo":    ["<owner address>"],
    "allowedResources": ["http://localhost:4402/research/*"],
    "limits": {
      "mint": "<mint>",
      "maxPerPayment": "50000000",   // hard ceiling
      "maxPerWindow":  "5000000",    // autonomous rolling budget
      "windowSeconds": 86400,
      "maxTotal":      "100000000"   // hard lifetime cap
    }
  },
  "escalation": {
    "thresholdBaseUnits": "1000000",          // above this a human must approve
    "approverRoles": ["OWNER", "ADMIN", "APPROVER"],
    "resources": ["http://localhost:4402/inference/*"], // reachable only with approval
    "approvalTtlSeconds": 900
  },
  "notBefore": 1799996400, "expiresAt": 1800259200,
  "nonce": "<32 hex chars>",
  "delegationChain": [ { "role": "OWNER|APPROVER|AGENT", "publicKey": "…", "signature": "…" } ]
}
```

Refinements a verifier MUST enforce: `maxPerPayment ≤ maxPerWindow ≤ maxTotal`; `thresholdBaseUnits ≤ maxPerPayment`; `notBefore < expiresAt`; `limits.mint ∈ allowedAssets`; every address is valid base58 of 32 bytes; `requiredApprovals ≥ 1`. Unknown fields are rejected (the schema is closed) so that a signature can never cover fields a verifier ignores.

### 3.2 Delegation chain

The chain is an ordered list: exactly one `OWNER`, then `requiredApprovals` or more `APPROVER`s, then one `AGENT` link. The agent link is a proof of possession: the agent key itself accepts the mandate. Every key in the chain MUST be distinct.

### 3.3 Resource patterns

A pattern is `<origin><path>` where `path` is exact or ends in `/*`. `/*` is a prefix match that must end on a path-segment boundary (`/research/*` matches `/research/a/b` but not `/researcher`). Matching is fail-closed and applies to the URL *after* WHATWG normalisation, which resolves dot-segments (including `%2e%2e`), lowercases the host, drops default ports and converts backslashes. URLs with userinfo, non-http(s) schemes, or encoded slashes (`%2f`, `%5c`) never match. Query and fragment are ignored. See the `resources` vectors.

## 4. Canonicalisation and hashing

```
mandateHash = SHA-256( JCS( mandate without "delegationChain" ) )
offerHash   = SHA-256( JCS( x402 offer ) )
```

The offer is the normalised subset of the x402 `PaymentRequirements` the gate reasons about: `x402Version, scheme, network, asset, payTo, amount, resourceUrl, feePayer, memo`.

## 5. Signatures

Every signature is over a *domain-separated* message so a signature made for one purpose can never be replayed as another:

```
message   = UTF-8( domain + "\n" + hashHex )
signature = Ed25519.sign(message)
```

| Purpose | Domain |
|---|---|
| Delegation link | `atlasrail/v0.1/mandate-link` |
| Gate request (by the agent) | `atlasrail/v0.1/agent-request` |
| Decision record (by the instance) | `atlasrail/v0.1/decision` |
| Gate authorisation (by the instance) | `atlasrail/v0.1/gate-authorization` |
| Receipt (by the instance) | `atlasrail/v0.1/receipt` |

A delegation link at position `i` signs

```
linkHash = SHA-256( JCS({ type: "atlasrail.mandate-link", version: "0.1",
  mandateHash, index: i, role, publicKey, previousSignature }) )
```

where `previousSignature` is the previous link's signature (`null` for the first). This commits each link to the mandate, its position, its role and its predecessor, so links cannot be reordered, dropped, duplicated or moved between mandates without invalidating every later signature.

## 6. Verification algorithm

`verifyMandateChain(m)` (static, no clock):

1. `m` parses against the closed schema and refinements of §3.1.
2. The role sequence is `OWNER, APPROVER{≥requiredApprovals}, AGENT`; all keys distinct; `AGENT.publicKey == m.agent.publicKey`.
3. Recompute `mandateHash`; for each link recompute `linkHash` and verify its Ed25519 signature under the domain `mandate-link`.

`verifyMandate(m, now, revocation, nonceSeen)` adds: `notBefore ≤ now < expiresAt`; not revoked; nonce not previously used by the issuer (mandate replay). A verifier's `now` SHOULD tolerate a small, configured skew, and MUST fail closed near the boundaries: a mandate is never valid *at* `expiresAt`.

## 7. The Policy Gate

`evaluateGate(mandate, offer, context) → { decision, kind, rulesEvaluated[], failedRule, escalationRules }` is a pure function. `context` carries everything that varies: `now`, revocation, spend counters, an optional simulation result for the exact transaction, and an optional human approval. Two implementations given the same inputs MUST return the same result, which is what makes a recorded decision replayable.

Rules run in a fixed order and each returns `PASS`, `FAIL` (hard), `ESCALATE` (approvable), `OVERRIDDEN` (approvable, released by a valid approval) or `SKIPPED`:

| # | Rule | On violation |
|---|---|---|
| 1 | `OFFER_WELL_FORMED` | DENY |
| 2 | `MANDATE_SIGNATURES` | DENY |
| 3 | `MANDATE_VALIDITY` | DENY |
| 4 | `MANDATE_NOT_REVOKED` | DENY |
| 5 | `NETWORK_ALLOWED` | DENY |
| 6 | `ASSET_ALLOWED` | DENY |
| 7 | `RESOURCE_ALLOWED` | ESCALATE if inside `escalation.resources`, otherwise DENY |
| 8 | `PAYTO_ALLOWED` | DENY |
| 9 | `MAX_PER_PAYMENT` | DENY |
| 10 | `WINDOW_BUDGET` | ESCALATE |
| 11 | `MAX_TOTAL` | DENY |
| 12 | `TRANSACTION_SIMULATION` | DENY (including "the transaction pays exactly the offer") |
| 13 | `ESCALATION_THRESHOLD` | ESCALATE |
| 14 | `ESCALATION_APPROVAL` | DENY if a supplied approval is invalid for this offer |

Any DENY wins; otherwise any ESCALATE yields `ESCALATE`; otherwise `ALLOW`. All rules are evaluated so a UI can show every failure, except rules made meaningless by an integrity failure, which are `SKIPPED`. A human approval is bound to `offerHash`, expires, is single-use, and can override only the approvable rules; hard rules are re-evaluated when the agent retries.

Amount arithmetic uses arbitrary-precision integers. Budgets count only autonomous (non-approved) spend inside the window.

### 7.1 Decision record

Every evaluation, whatever its outcome, is recorded as `{ id, mandateHash, offer, offerHash, decision, kind, rulesEvaluated, failedRule, escalationRules, context, request }` and signed by the instance key (`decisionHash = SHA-256(JCS(record))`). `context` is the snapshot the gate used, so `verifyDecisionMatchesScope` can replay the decision from the mandate and confirm it reproduces the recorded outcome and rule results.

### 7.2 Enforcement: gate authorisation

A cooperative client is not enforcement. On ALLOW the gate returns a short-lived `GateAuthorization` signed by the instance key and bound to `{ decisionHash, mandateHash, offerHash, txMessageHash, agentPublicKey, notBefore, notAfter }`. A signer wrapper (`GatedSignerAdapter`) MUST refuse to sign any transaction whose message hash does not match a valid, unexpired authorisation from a trusted instance key. This closes the confused-deputy case (ask about offer A, sign a transaction paying B). Custody vendors are expected to enforce the same check inside their own policy engines.

## 8. Bound receipt

```
receiptHash = SHA-256( JCS({ type: "atlasrail.receipt", version: "0.1",
  mandateHash, offer, decisionHash, txSignature, responseHash, timestamp }) )
```

The instance key signs `receiptHash` under domain `receipt`. The receipt document embeds the mandate, the signed decision and the settlement and response metadata so it is self-contained. `responseHash` is the hash of `{ status, bodySha256, contentType }` of the seller's response.

### 8.1 Anchoring

Pending receipt hashes are batched into an RFC 6962 Merkle tree (leaf `SHA-256(0x00‖leaf)`, node `SHA-256(0x01‖left‖right)`, tree shape per RFC 6962 §2.1, no node duplication). The root is written to Solana in a Memo transaction signed by the instance key:

```
atlasrail:anchor:v1:<root hex>:<leaf count>:<batch id>
```

The receipt is then augmented (outside the signed body) with `anchor: { batchId, merkleRoot, leafCount, leafIndex, proof[{position,hash}], txSignature, anchoredAt, signer }`.

### 8.2 Receipt verification

A verifier SHOULD run, and report individually: schema; recomputed `receiptHash` and all embedded hashes; instance signature (against a *pinned* key); mandate chain; decision signature and hash; decision-matches-scope replay; decision was ALLOW (with approval where applicable); Merkle inclusion; the anchor memo exists on-chain in a transaction whose signer equals the receipt's instance key; the settlement transaction pays `offer.amount` of `offer.asset` to `offer.payTo` and was paid by `mandate.agent.publicKey`. Chain checks that cannot run offline are reported `SKIP`, never silently passed. The `atlas verify` CLI implements this with exit codes 0 (all pass), 1 (any fail) and 2 (unusable input).

## 9. Security considerations

| Threat | Mitigation in this design | Residual risk |
|---|---|---|
| **Prompt injection makes the agent pay an attacker** | The gate, not the agent, decides; `allowedPayTo`/`allowedResources` are enforced outside the agent's context; violations are DENY and recorded. | An attacker who can make the agent pay an *allowed* recipient within budget is not stopped. Budgets bound the loss. |
| **Confused deputy** (ask gate about A, sign B) | `GateAuthorization` bound to the transaction message hash; simulation must show the tx pays exactly the offer. | Depends on the signer actually verifying the authorisation. |
| **Mandate replay** | `nonce` uniqueness per issuer; validity window; revocation; chain commits to `mandateHash`. | A verifier that skips the nonce store cannot detect replay. |
| **Receipt forgery / tampering** | Domain-separated instance signature over a hash committing to mandate, decision, settlement and response; Merkle inclusion; on-chain anchor. | Trust in the pinned instance key; a compromised instance key can sign false receipts, but not alter an already-anchored root. |
| **Rogue approver** | `requiredApprovals` independent keys; `preventIssuerApproval`; approval bound to one offer hash, single-use, expiring; approver role checked. | Collusion between required approvers. |
| **Clock skew** | Integer seconds; half-open validity interval; approvals and authorisations carry explicit `notAfter`; server clock is authoritative. | Skew beyond the configured tolerance between a verifier and the issuer. |
| **Approval race / double-spend** | Approval consumption is atomic (single-use); spend counters are updated under a per-mandate lock; payment paths are idempotent. | None known for identical payloads. |
| **Signature confusion across purposes** | Distinct domain strings; verifiers reject non-hex hashes. | None known. |
| **Resource-URL tricks** | WHATWG normalisation before matching; reject userinfo/encoded slashes/non-http(s). | Server-side path semantics that differ from WHATWG. |

Additional notes: a decision is made *before* signing and the anchor is made *after* settlement, so an anchor proves inclusion by a time, not that the decision preceded the payment (the receipt's decision and authorisation timestamps and the on-chain slot do). This is a devnet proposal; production use needs custody integration, an external security review and a decision on key management for the instance key.

## 10. Test vectors

[`spec/test-vectors/agent-mandate-v0.1.json`](test-vectors/agent-mandate-v0.1.json) is generated from the reference implementation with seeded, worthless keys and `now = 1800000000`. It contains: JCS cases; an unsigned canonical mandate body, `mandateHash`, every `linkHash` and deterministic Ed25519 signature, and the fully signed mandate; resource-matching cases; and eight gate cases with expected decisions and per-rule statuses. `packages/mandate/src/vectors.test.ts` fails if the file and the implementation ever disagree.

Key values (for orientation; the JSON file is normative):

| Item | Value |
|---|---|
| Owner key | `FseuYDfayH186rL2ALfk3ej5c7uoj3JcDfCQxupobqFt` |
| `mandateHash` | `cf7642f2ff2f26bcd48637a497afbbe8bbd9bb1ad3a979cae905a3f3fabb562f` |
| Link 0 (OWNER) `linkHash` | `0dd30e8d5fce85cb2eea43dd7785788723becd86ab70822c817ec68291222723` |
| Link 1 (APPROVER) `linkHash` | `36c4cdc3b6b1398560021523e362c3cb80fbaa35f0680df91b263762ed3a64af` |
| Link 2 (AGENT) `linkHash` | `deb21eebc50f5951458fc2c11660512eb09ff2b5f50af7c34dd8ccd20ed54521` |
| Gate case 1 `offerHash` | `a9571e4d78a494a0e01819f18613849aa85595306227184fd105a6acaba862f0` |

| Gate case | Decision | Decisive rule |
|---|---|---|
| autonomous allow ($0.01, research) | ALLOW | – |
| $2 on a research endpoint | ESCALATE | `ESCALATION_THRESHOLD` |
| same, with a valid human approval | ALLOW (approved) | – |
| $500 to an unlisted origin | DENY | `RESOURCE_ALLOWED` |
| unlisted recipient | DENY | `PAYTO_ALLOWED` |
| $60, above the $50 hard ceiling | DENY | `MAX_PER_PAYMENT` |
| mandate revoked | DENY | `MANDATE_NOT_REVOKED` |
| $40 inference endpoint | ESCALATE | `RESOURCE_ALLOWED` (approvable), `WINDOW_BUDGET`, `ESCALATION_THRESHOLD` |
