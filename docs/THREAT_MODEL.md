# Threat model: what Atlas Rail stops, and what it honestly doesn't

A judge-facing companion to [`docs/security/threat-model.md`](security/threat-model.md) (the full,
formal threat table) and [`spec/agent-mandate-v0.1.md §9`](../spec/agent-mandate-v0.1.md#9-security-considerations)
(the normative version). This page is the short version: the specific attacks the
[playground](https://atlas-rail-playground.vercel.app) and the main demo actually exercise, the exact
rule that stops each one, and — just as important — where the guarantees end.

## Attacks stopped

Every row below is enforced by `evaluateGate` in [`packages/mandate/src/gate.ts`](../packages/mandate/src/gate.ts),
a pure function re-run by `atlas verify` and by anyone else who wants to check a decision independently —
not something the agent, or Atlas Rail's own goodwill, is trusted to self-report.

| Attack | Stopped by | Where to see it |
|---|---|---|
| **Overpay** — a payment above the hard per-payment ceiling, even if a human would approve it | `MAX_PER_PAYMENT` — never overridable, not even by an approver | playground step 4 (attack): the injected $500 request fails this alongside everything else |
| **Wrong seller** — paying a recipient not on the mandate's allowlist | `PAYTO_ALLOWED` | playground step 4 |
| **Wrong asset / wrong network** — a mandate denominated in one mint can't be spent authorizing another, and devnet-only is enforced twice (mandate scope + protocol-level) | `ASSET_ALLOWED`, `NETWORK_ALLOWED` | `packages/mandate/src/gate.test.ts` |
| **Budget drain** — many small, individually-legal payments adding up past what was authorized | `WINDOW_BUDGET` (rolling autonomous budget, escalates) and `MAX_TOTAL` (lifetime cap, hard) | `gate.test.ts` property tests generate arbitrary payment sequences and assert the cap never breaks |
| **Seller price inflation and price creep** — an allowed seller, on an allowed resource, quietly raises its price (rule 15, [spec §3.4](../spec/agent-mandate-v0.1.md#34-per-resource-price-limits)) | `PRICE_LIMIT` — the reference price is fixed in the owner-signed mandate at signing time and never updated from what a seller charged last; a moderate rise above tolerance escalates to a human, a spike past the hard maximum is denied outright, unconditionally | playground step 5 (both zones); credit to Felix for identifying the underlying gap this closes |
| **Revoked mandate** — the agent's very next payment after revocation | `MANDATE_NOT_REVOKED` — checked on every single evaluation, and (behind `ATLAS_ONCHAIN=1`) against the on-chain record too, not only Atlas Rail's own database | playground step 8; `atlas-mandate`'s `revoke_mandate` instruction is final, once and for good |
| **Tampered receipt** — any field of a receipt changed after issuance | The receipt hash binds mandate, offer, decision, settlement and response together; the instance signature covers that hash; `atlas verify` and `verifyReceipt` recompute everything and recursively re-evaluate the gate on the recorded inputs to confirm the recorded decision is what the mandate's scope actually produces — not just that a signature is present | playground step 7; `receipt.test.ts`'s "detects tampering with each bound field" |
| **Replayed approval** — reusing a human's sign-off for a different or later payment | A `GateApproval` is bound to one exact offer hash, carries its own short expiry, and `ESCALATION_APPROVAL` fails closed if the offer, status or approver role don't match exactly | playground step 6 (reject path denies outright; an approval for the $0.02 spike can't be replayed against the $0.05 one) |
| **Prompt injection** — a compromised agent trying to act on attacker-controlled instructions | Not a gate rule by itself — the gate doesn't know or care *why* the agent is asking. It's the composition of the rules above: the agent's own reasoning can be fully compromised and the worst it can do is ask for something outside the mandate, which is then denied the same as any other out-of-scope request | playground step 4; see [Grok/Bankr, May 2026](../spec/agent-mandate-v0.1.md) for the real-world incident this mirrors |

## Honest limits

- **Collusion among the required approvers isn't detected.** `requiredApprovals` independent
  signatures stops a single rogue approver, not a conspiracy of all of them.
- **The instance key is a single point of trust for decisions and receipts.** A compromised instance
  key can sign a decision or receipt that looks valid — see
  [issue #28](https://github.com/Rime504/atlas-rail/issues/28) for a fuller writeup; multi-key / HSM
  custody is future work, not shipped.
- **The gate enforces the mandate's own scope, not fraud detection.** An attacker who happens to be
  (or compromises) an *already-allowed* recipient, within budget, is not caught by any of the rules
  above — the mandate's allowlist and limits bound the loss, they don't guarantee the recipient is
  legitimate.
- **On-chain checks are opt-in, off by default.** `ATLAS_ONCHAIN=1` (gate checks on-chain
  revocation, mandates register/revoke on-chain) and `ATLAS_ANCHOR_ROOT=1` (receipts anchor via the
  registry's `anchor_root` PDA instead of an SPL Memo) are both flags, not the default path — the
  core demo and the playground's default "instant" mode prove the *gate logic* is correct without
  depending on either; turn them on for the on-chain guarantees specifically.
- **The playground's instant mode never touches a chain at all.** It runs the real gate and receipt
  code, honestly — but settlement is synthetic and the on-chain anchor/settlement checks correctly
  report `SKIP`, not a fabricated `PASS`. The "Use real Solana devnet" toggle is what actually
  registers/revokes a mandate for real.
- **Simulation trusts the RPC provider.** `TRANSACTION_SIMULATION` relies on one RPC's result; a
  compromised or lying RPC could in principle return a fabricated simulation. No multi-RPC quorum
  today.
- **Devnet only, unaudited.** No real funds ever move — see the
  [Safety Boundary](../README.md#️-safety-boundary--read-this-first) — and this code has not had an
  external security audit.
