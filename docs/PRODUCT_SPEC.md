# Atlas Rail: the complete product

One sentence: AI agents can now pay for things. Atlas Rail makes sure they only pay what they're allowed to, and proves it.

Team: Rime, Kamelia, and Divyesh.

## Status

Built: mandate spec v0.2 + rule 15 · 15-rule gate · owner + approver + agent signatures · human escalation bound to exact tx bytes · Merkle receipts + atlas verify · Anchor program (create_mandate, revoke_mandate, anchor_root) on devnet CnGoTE5Bxc8MFGaeK5LDv5uAZ7pNiktMunYy8JZcLY4k · gate respects on-chain revoke · public 8-step playground · README/HACKATHON/THREAT_MODEL/DEMO_VIDEO.

In progress (Divyesh): PRs #37 #39 #41 #43 #45 #47 · signer on-chain revoke check · on-chain spend counter.

Planned: real LLM agent + e2e · red-team · reserve/capture/release · Layer 1 hard cap · npm SDK + registerPolicy + MCP · browser verifier · x402 policy-attestation extension · console upgrades.

## Architecture: three layers

Agent → @atlas-rail/agent or MCP → LAYER 2 gate (mandate, 15 rules, budget reservation, tx simulation → signed decision + GateAuthorization bound to tx bytes) → GatedSigner (re-verifies, replays the decision against the owner-signed mandate, checks the mandate PDA, then signs) → x402 seller/facilitator → Solana → LAYER 1 on-chain (revoked flag, spend counter, delegation/float cap, anchored roots).

Principle: Atlas Rail is IN the signing path. Even a compromised gate can only move what the owner allowed.

## Mandate

In: purpose, agent key, per-payment max, hourly/daily budgets, lifetime total, allowed networks/assets/sellers/resources, rule 15 per resource (expectedPrice, tolerancePct, hardMax; never auto-updates), escalation threshold, expiry, independent approver. Out: canonical JSON, hash, 3 signatures, PDA + Explorer link. Immutable: change = new mandate + revoke the old one.

## Gate

In: x402 PaymentRequirements, agent ID, unsigned tx, agent proof. Out: ALLOW (reserve, authorise, receipt) / ESCALATE (human) / DENY (stable reason codes, webhook, receipt). Targets: p95 < 50 ms measured; no overspend under concurrency.

## Signer trust (#28)

1 Replay against the signed mandate (#47) · 2 on-chain revoke check · 3 on-chain spend counter (open question: increment after confirmation, or atomically in the same tx if facilitators accept the extra instruction) · 4 Layer 1 cap · 5 optional 2-of-N.

## Proof

Every decision → receipt → RFC 6962 Merkle tree → root via anchor_root (RootAnchor PDA ["root", mandate, seq]), Memo fallback · atlas verify + browser verifier · x402 attestation header so sellers can verify buyers.

## Through everyone's eyes

Developer: minutes to integrate, no wallet change, measured latency. Judge: the playground works on a phone, real on-chain usage, honesty, wow moments (attack blocked live, human approves, receipt verifies, "money moved: 0"). Customer (CFO/risk/compliance pay): provable authorisation, audit exports, kill switch, self-host, fail closed. Wallets/platforms: partners embedding verifiable limits. Sellers: attestation proves the buyer was authorised. Competitors (Coinbase, Crossmint, Skyfire, Payman, Circle; Kora; Google AP2): their limits live in their systems; ours are signed, open, on-chain and wallet-agnostic, and also cap the seller. Auditor: honest threat model + runnable red-team. Investor: open gate → hosted gate → licensing → agent risk scoring/underwriting from decision data.

## Edge

In the signing path · caps agent AND seller · proof anyone can check · our own compromise is bounded · measured not claimed · distribution via registerPolicy/MCP/docs · an open standard · a data moat.

## Non-goals

No mainnet before an external audit. No token. No custody. No own facilitator. No card issuing.
