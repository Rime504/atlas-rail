# Threat model: what Atlas Rail stops, and what it honestly doesn't

A judge-facing companion to [`docs/security/threat-model.md`](security/threat-model.md) (the full,
formal threat table) and [`spec/agent-mandate-v0.1.md §9`](../spec/agent-mandate-v0.1.md#9-security-considerations)
(the normative version). This page is the short version: each attack, what stops it, and where to see
it tested, then where the guarantees end.

**How it is tested.** The red team ([`reports/redteam-2026-10-08.md`](../reports/redteam-2026-10-08.md),
`pnpm redteam`, run in CI) **assumes the agent is fully compromised on every attempt**: it sends any
offer, transaction bytes or gate request the attacker wants, replays and tampers freely, and always
tries to sign. 50 attack types, 1,011 attempts on the in-memory cluster, 15 attack types on real devnet:
0 signatures obtained by an attack, $0.00 moved outside the mandate. Money moved is read from token
balances, never from what the gate reports.

## Attacks stopped

Gate rules are enforced by `evaluateGate` in [`packages/mandate/src/gate.ts`](../packages/mandate/src/gate.ts),
a pure function that `atlas verify` and anyone else can re-run on a decision's recorded inputs.
Signer checks are in [`packages/x402-client/src/gated-signer.ts`](../packages/x402-client/src/gated-signer.ts).
"Case" refers to the red-team case id in [`apps/demo-agent/src/redteam/cases.ts`](../apps/demo-agent/src/redteam/cases.ts).

| Attack | Stopped by | Where it is tested |
|---|---|---|
| **Pay a stranger**: a recipient not on the mandate's allowlist | `PAYTO_ALLOWED` | cases A1–A3; playground step 4; `/break` |
| **Offer and transaction disagree**: the offer names the merchant or $0.01, the transaction pays the attacker or $50 | `TRANSACTION_SIMULATION`: the gate simulates the exact bytes and requires them to pay exactly the offer | cases A4, B4, D2 |
| **Overpay** above the per-payment ceiling, even with a human's approval | `MAX_PER_PAYMENT`, never overridable | cases B1, B5; playground step 4 |
| **Lifetime drain** | `MAX_TOTAL` | case B3; `gate.test.ts` property tests |
| **Split one payment into many small ones** | `WINDOW_BUDGET` (rolling budget: further slices go to a human) and `MAX_TOTAL` | cases G1–G3; `/break` |
| **Seller price inflation and price creep** on an allowed resource | `PRICE_LIMIT`: the reference price is fixed in the signed mandate; above tolerance goes to a human, above the hard maximum is refused (rule 15, credit to Felix for the gap) | cases C1–C4; playground step 5 |
| **Wrong asset or network** (another mint, mainnet, testnet, an EVM chain) | `ASSET_ALLOWED`, `NETWORK_ALLOWED` | cases D1, D3, E1–E3 |
| **Unlisted resource**, including `/research/../admin`, `/research-evil/` and query-string tricks | `RESOURCE_ALLOWED` on the canonicalised URL | cases F1–F5 |
| **Escalated payment with no human** | `ESCALATE` produces no authorization, so the signer has nothing to sign with | cases B2, C4, G2 |
| **Replayed approval**: reuse a human's sign-off for a different amount, payee or after rejection | Approvals are bound to one exact offer hash, single-use and short-lived; `ESCALATION_APPROVAL` fails closed | cases H1–H3 |
| **Replayed, stale or forged authorization** | The signer checks the authorization is signed by a pinned gate key, covers this transaction's exact message hash, names this agent, and is inside its 120-second window | cases I1, I2, M1–M3 |
| **Tamper with the transaction after the gate approved it** (payee, amount, memo, fee payer) | The authorization covers the original message hash only; any change and the signer refuses | cases J1–J4 |
| **Replay a settled payment** | The chain rejects the duplicate transaction | case I3, also on real devnet |
| **Bypass the gate**: ask the wallet to sign directly | The gated signer's plain `signTransaction` always refuses | case N1 |
| **Tamper with a signed gate request** | The gate rejects a request whose agent signature no longer verifies, and one signed by any key other than the mandate's agent | cases A5, P1 |
| **Revoked or expired mandate** | `MANDATE_NOT_REVOKED` (checked on every evaluation; behind `ATLAS_ONCHAIN=1` also against the on-chain record), `MANDATE_VALIDITY` | cases K1, K2, L1, L2; playground step 8 |
| **False failure claim**: the agent says a payment that settled "didn't go through" to get its budget back | The gate never frees a spend hold on the caller's word. It looks for the exact authorised message on-chain: landed means SETTLED and still counted; budget is freed only if it landed with an error, or its blockhash expired (checked at finalized commitment) and it never landed | case Q1, also on real devnet; `fetch.test.ts`, `payment-outcome.test.ts` |
| **Lost answer** (timeout, dropped connection after signing) | Same check: the client asks the gate, which reports SETTLED, RELEASED or PENDING from the chain; the budget stays reserved while the outcome is unknown | `fetch.test.ts` |
| **Concurrent burst** against a cap (check-then-record race) | Decision and reservation happen under one per-mandate lock: a Postgres advisory lock, queued in-process | 100 simultaneous $0.10 payments vs a $5 cap: $5.00 spent (in-memory and Postgres); $10.00 with the lock removed ([report](../reports/redteam-2026-10-08.md)) |
| **Tampered receipt** | The receipt hash binds mandate, offer, decision, settlement and response; the instance signature covers it; verification recomputes everything and re-runs the gate on the recorded inputs | `receipt.test.ts` "detects tampering with each bound field"; `proof.test.ts` |
| **Borrowed proof**: a payment whose memo copies another payment's receipt id | The receipt must name this exact transaction back, or the verdict is NO PROOF | `proof.test.ts`; `/verify` |
| **Prompt injection** | Not a rule by itself: the composition of everything above. The agent's reasoning can be fully compromised; the worst it can do is ask for something outside the mandate, which is refused | playground step 4; `/break`; the whole red team |

## Issues found and fixed by Divyesh

| PR | What was wrong |
|---|---|
| [#37](https://github.com/Rime504/atlas-rail/pull/37) | Daily and monthly payout limits did not load the real rolling spend |
| [#39](https://github.com/Rime504/atlas-rail/pull/39) | Agent spend could overrun between reservation and release; spend now stays reserved until released |
| [#41](https://github.com/Rime504/atlas-rail/pull/41) | The payout policy's recipient allowlist was not enforced |
| [#43](https://github.com/Rime504/atlas-rail/pull/43) | Webhook URLs could target private, metadata or IPv4-mapped (`::ffff:`) hosts (SSRF) |
| [#45](https://github.com/Rime504/atlas-rail/pull/45) | A payout could be submitted twice after an on-chain signature already existed |

Divyesh also built `anchor_root`, the instruction that writes receipt Merkle roots on-chain.

## Honest limits

- **The key must live outside the agent's process.** The red team's guarantee assumes the attacker
  controls everything except the gated signer and its key. An agent that can read its own key can sign
  anything. In this repository's demos the signer runs in the same process as the scripted agent, for
  convenience; in production it belongs with a custody provider or a separate signing service.
- **A window after revocation.** The gated signer does not check revocation itself: an authorization
  the gate issued just before a revocation can still be signed for up to 120 seconds.
- **Budgets are gate-level, not an on-chain lock.** Rolling and lifetime spend are enforced by the gate
  and recorded in its database; nothing on-chain stops an overspend if the gate is bypassed together
  with the signer. A hard cap via native SPL token allowances (`Approve` to the agent as delegate for the
  mandate total, `Revoke` as the kill switch) is the next step, not built.
- **Collusion among the required approvers isn't detected.** Independent approvals stop one rogue
  approver, not all of them together.
- **The instance key is a single point of trust for decisions and receipts.** A compromised instance
  key can sign a valid-looking decision or receipt ([issue #28](https://github.com/Rime504/atlas-rail/issues/28)).
  Multi-key or HSM custody is future work.
- **The gate enforces the mandate, not fraud detection.** An already-allowed recipient, within budget,
  is not caught; the allowlist and limits bound the loss.
- **On-chain checks are opt-in in the API.** `ATLAS_ONCHAIN=1` and `ATLAS_ANCHOR_ROOT=1` are flags.
  `pnpm agent:e2e` turns both on, and the playground's devnet mode registers, anchors and revokes
  on-chain itself; the default demo and the playground's instant mode prove the gate logic without a chain and report on-chain checks as N/A, never a
  fabricated pass.
- **The public receipt store is ours.** `/verify` fetches receipts from this project's Vercel Blob
  store. A receipt JSON can always be verified on its own with `atlas verify <file>`.
- **Devnet RPC has limits.** Public devnet nodes rate-limit and eventually drop old transactions; a
  check can fail for those reasons rather than because a proof is wrong.
- **Simulation trusts one RPC provider.** A lying RPC could return a fabricated simulation. No
  multi-RPC quorum today.
- **Devnet only, unaudited.** The server refuses mainnet RPC endpoints
  ([`docs/adr/0004-devnet-only.md`](adr/0004-devnet-only.md)); the code has not had an external audit.
