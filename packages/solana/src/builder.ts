import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { BuildPayoutTxParams } from './types';

export class SplTokenPayoutTransactionBuilder {
  /**
   * Constructs an unsigned base64-encoded SPL Token transfer transaction.
   */
  public static buildUnsignedPayoutTransaction(
    params: BuildPayoutTxParams,
    options?: { createAtaIfNeeded?: boolean },
  ): { transactionBase64: string; destinationTokenAccount: string } {
    const { senderWallet, recipientWallet, mintAddress, amountBaseUnits, decimals = 6, memo, recentBlockhash } = params;

    const senderPubkey = new PublicKey(senderWallet);
    const recipientPubkey = new PublicKey(recipientWallet);
    const mintPubkey = new PublicKey(mintAddress);

    // Deriving Associated Token Accounts
    const senderAta = getAssociatedTokenAddressSync(mintPubkey, senderPubkey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    const recipientAta = getAssociatedTokenAddressSync(mintPubkey, recipientPubkey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

    const tx = new Transaction();
    tx.feePayer = senderPubkey;
    tx.recentBlockhash = recentBlockhash;

    // Optional ATA creation instruction for recipient
    if (options?.createAtaIfNeeded !== false) {
      const createAtaIx = createAssociatedTokenAccountInstruction(
        senderPubkey,
        recipientAta,
        recipientPubkey,
        mintPubkey,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );
      tx.add(createAtaIx);
    }

    // Checked SPL Token transfer instruction
    const transferIx = createTransferCheckedInstruction(
      senderAta,
      mintPubkey,
      recipientAta,
      senderPubkey,
      BigInt(amountBaseUnits),
      decimals,
      [],
      TOKEN_PROGRAM_ID,
    );
    tx.add(transferIx);

    // Optional Memo Instruction
    if (memo && memo.trim().length > 0) {
      const memoProgramId = new PublicKey('MemoSsq6gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcY');
      const memoIx = new TransactionInstruction({
        keys: [],
        programId: memoProgramId,
        data: Buffer.from(memo, 'utf-8'),
      });
      tx.add(memoIx);
    }

    const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });

    return {
      transactionBase64: serialized.toString('base64'),
      destinationTokenAccount: recipientAta.toBase58(),
    };
  }
}
