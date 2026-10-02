# atlas-mandate (on-chain mandate registry)

Milestone 1 of putting Atlas Rail's agent mandates on Solana. **Devnet and localnet only.**

| Instruction | Who signs | What it does |
|---|---|---|
| `create_mandate` | owner (payer), independent approver, agent | Records the mandate hash and its hard limits in a PDA `["mandate", mandate_hash]`. Fails unless all three keys sign and the limits are coherent. |
| `revoke_mandate` | owner or approver | Marks the mandate revoked, once and for good. |

`Mandate::is_active(now)` is what the policy gate checks: not revoked, `not_before <= now < expires_at`.

Status: written against `anchor-lang` 1.2.0. Program ID (synced via `anchor keys sync`, same on localnet and devnet): `CnGoTE5Bxc8MFGaeK5LDv5uAZ7pNiktMunYy8JZcLY4k`.

- 10 native Rust unit tests pass (`cargo test -p atlas-mandate`) — pure validation logic.
- 18 TypeScript integration tests pass against the compiled program under LiteSVM — every
  `MandateError`, missing-signature rejection (approver and agent), happy paths for both
  instructions, revoke by owner and by approver, revoke by a stranger/the agent fails, and a
  second revoke attempt fails. Run them with:
  ```bash
  cd programs/atlas-mandate/tests
  npm install   # first time only
  npm test
  ```
  These do **not** run via `anchor test` — Anchor's script runner doesn't reliably forward the
  `ts-node`/ESM environment needed here, and LiteSVM needs no local validator anyway, so
  `anchor test` would be the wrong tool regardless. Run the command above directly.
- `anchor build` succeeds (SBF `.so` built).

## Next steps
1. Deploy to devnet; put the program ID in `.env.example` and the root README.
2. Policy gate: new rule that denies when the on-chain mandate is missing, revoked, not yet valid or expired (behind `ATLAS_ONCHAIN=1`).
3. Demo scene 6 (Revoke) sends `revoke_mandate` and prints the Solana Explorer link.
