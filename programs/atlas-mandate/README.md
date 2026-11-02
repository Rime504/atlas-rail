# atlas-mandate (on-chain mandate registry)

Milestone 1 of putting Atlas Rail's agent mandates on Solana. **Devnet and localnet only.**

| Instruction | Who signs | What it does |
|---|---|---|
| `create_mandate` | owner (payer), independent approver, agent | Records the mandate hash and its hard limits in a PDA `["mandate", mandate_hash]`. Fails unless all three keys sign and the limits are coherent. |
| `revoke_mandate` | owner or approver | Marks the mandate revoked, once and for good. |
| `anchor_root_v2` | gate authority only | Records a Merkle root, the leaf count, the batch header hash and the batch file hash in a `RootV2` PDA `["root", mandate, seq]`. Both hashes are required (all zeros is rejected). Sequence must match `mandate.next_root_seq`; allowed even after revoke. |
| `anchor_root` | gate authority only | Deprecated, unchanged for older clients. Records a Merkle root and leaf count in a `Root` PDA at the same seeds and the same sequence. |

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

Deployed to devnet; upgraded in place (same program ID) to add `anchor_root`. The IDL on Devnet lists `createMandate`, `revokeMandate`, and `anchorRoot`. The upgrade authority shown by Explorer starts with `3HBTb` and ends with `26nJq`. The build is not verified.

`packages/atlasrails` calls these instructions through `createMandate`, `revokeMandate`, `anchorRoot`, and `loadMandate`. They broadcast only with `submit: true`. `revokeMandate` can also seal the payment channel when you pass the channel and the payee key. The playground page is `apps/playground` at `/mandate`. It opens the escrow, pays, refunds, and revokes. Field-by-field enforcement and the 20 October 2026 Devnet signatures are in `packages/atlasrails/SDK.md`. Setup is in `packages/atlasrails/MANUAL.md`.

Demo scenes 1 and 6 (Grant, Revoke) still send `create_mandate` and `revoke_mandate` and print the Explorer link.

With `ATLAS_ONCHAIN=1`, a positive on-chain revocation denies a new voucher. A missing account still falls back to the database unless `ATLAS_ONCHAIN_REQUIRE=1`, which denies missing, inactive, and undecodable accounts. `AnchorService` anchors with `anchor_root` only. See `packages/receipt/src/service.ts`. A voucher signed before revocation can still be submitted to the payment-channels program until that channel is sealed. Sealing immediately needs the payee key. A payer-only `request_close` leaves the grace stored at open, and during that grace the payee can still call `settle_and_seal`. The payment-channels program does not read this account.
