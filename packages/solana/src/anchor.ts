import { PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { ALLOWED_SOLANA_PROGRAM_IDS } from '@atlas-rail/config';

/** Memo instructions above this are rejected by the runtime; anchor memos are far smaller. */
const MAX_MEMO_BYTES = 566;

export interface BuildAnchorTransactionParams {
  /** Signer and fee payer (the Atlas Rail instance key). */
  signer: string;
  memo: string;
  recentBlockhash: string;
}

/** Builds the unsigned v0 transaction that anchors a Merkle root on-chain via the SPL Memo program. */
export function buildAnchorTransaction(params: BuildAnchorTransactionParams): string {
  const data = Buffer.from(params.memo, 'utf8');
  if (data.byteLength > MAX_MEMO_BYTES) throw new Error('anchor memo is too large');
  const signer = new PublicKey(params.signer);
  const message = new TransactionMessage({
    payerKey: signer,
    recentBlockhash: params.recentBlockhash,
    instructions: [
      // The memo program requires the signer account so the memo is attributable to the instance key.
      new TransactionInstruction({
        keys: [{ pubkey: signer, isSigner: true, isWritable: false }],
        programId: new PublicKey(ALLOWED_SOLANA_PROGRAM_IDS.MEMO_PROGRAM),
        data,
      }),
    ],
  }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(message).serialize()).toString('base64');
}
