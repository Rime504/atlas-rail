# atlas-mandate (on-chain mandate registry)

Milestone 1 of putting Atlas Rail's agent mandates on Solana. **Devnet and localnet only.**

| Instruction | Who signs | What it does |
|---|---|---|
| `create_mandate` | owner (payer), independent approver, agent | Records the mandate hash and its hard limits in a PDA `["mandate", mandate_hash]`. Fails unless all three keys sign and the limits are coherent. |
| `revoke_mandate` | owner or approver | Marks the mandate revoked, once and for good. |
| `anchor_root` | gate authority only | Records a Merkle root for a receipt batch in a PDA `["root", mandate, seq]`. Sequence must match `mandate.next_root_seq`; allowed even after revoke. |

`Mandate::is_active(now)` is what the policy gate checks: not revoked, `not_before <= now < expires_at`.

Status: written against `anchor-lang` 1.2.0. Program ID (synced via `anchor keys sync`, same on localnet and devnet): `CnGoTE5Bxc8MFGaeK5LDv5uAZ7pNiktMunYy8JZcLY4k`.

- 10 native Rust unit tests pass (`cargo test -p atlas-mandate`) — pure validation logic.
- TypeScript integration tests pass against the compiled program under LiteSVM — every
  `MandateError`, missing-signature rejection (approver and agent), happy paths for create/revoke/anchor_root,
  revoke by owner and by approver, unauthorized/out-of-order/empty-batch anchor failures, and
  anchoring after revoke. Run them with:
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
