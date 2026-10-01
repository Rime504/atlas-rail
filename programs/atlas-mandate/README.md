# atlas-mandate (on-chain mandate registry)

Milestone 1 of putting Atlas Rail's agent mandates on Solana. **Devnet and localnet only.**

| Instruction | Who signs | What it does |
|---|---|---|
| `create_mandate` | owner (payer), independent approver, agent | Records the mandate hash and its hard limits in a PDA `["mandate", mandate_hash]`. Fails unless all three keys sign and the limits are coherent. |
| `revoke_mandate` | owner or approver | Marks the mandate revoked, once and for good. |

`Mandate::is_active(now)` is what the policy gate checks: not revoked, `not_before <= now < expires_at`.

Status: written against `anchor-lang` 1.2.0, unit tests pass natively (`cargo test -p atlas-mandate`). Not yet built for SBF, deployed or wired into the gate; the program ID in `declare_id!` and `Anchor.toml` is a placeholder until `anchor keys sync`.

## Next steps
1. `anchor build && anchor keys sync && anchor build`
2. Anchor TS tests on localnet: happy path, missing approver/agent signature, revoke by a stranger fails, double revoke fails.
3. Deploy to devnet; put the program ID in `.env.example` and the root README.
4. Policy gate: new rule that denies when the on-chain mandate is missing, revoked, not yet valid or expired (behind `ATLAS_ONCHAIN=1`).
5. Demo scene 6 (Revoke) sends `revoke_mandate` and prints the Solana Explorer link.
