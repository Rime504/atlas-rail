import { ComputeBudgetProgram, Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { describe, expect, it } from 'vitest';
import { checkMemoAnchor, checkSettlement, summarizeTransaction } from './chain';
import { buildExactPaymentTransaction } from './x402-payment';

const MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const payer = Keypair.generate();
const feePayer = Keypair.generate();
const merchant = Keypair.generate();
const blockhash = Keypair.generate().publicKey.toBase58();

function paymentSummary(amount = '10000', memo?: string, err: unknown | null = null) {
  const tx = buildExactPaymentTransaction({
    payer: payer.publicKey.toBase58(),
    feePayer: feePayer.publicKey.toBase58(),
    mint: MINT,
    decimals: 6,
    payTo: merchant.publicKey.toBase58(),
    amountBaseUnits: amount,
    recentBlockhash: blockhash,
    memo,
  });
  return summarizeTransaction('sig', tx, { slot: 42, blockTime: 1_800_000_000, err });
}

describe('summarizeTransaction', () => {
  it('extracts the transfer, memo, signers, fee payer and programs', () => {
    const summary = paymentSummary('10000', 'pi_memo');
    expect(summary.feePayer).toBe(feePayer.publicKey.toBase58());
    expect(summary.signers).toEqual([feePayer.publicKey.toBase58(), payer.publicKey.toBase58()]);
    expect(summary.memos).toEqual(['pi_memo']);
    expect(summary.tokenTransfers).toEqual([
      {
        source: getAssociatedTokenAddressSync(new PublicKey(MINT), payer.publicKey).toBase58(),
        destination: getAssociatedTokenAddressSync(new PublicKey(MINT), merchant.publicKey).toBase58(),
        mint: MINT,
        amount: '10000',
        authority: payer.publicKey.toBase58(),
      },
    ]);
    expect(summary.programIds).toContain(TOKEN_PROGRAM_ID.toBase58());
    expect(summary.slot).toBe(42);
  });
});

describe('checkSettlement', () => {
  const expected = { payTo: merchant.publicKey.toBase58(), mint: MINT, amountBaseUnits: '10000' };

  it('accepts exactly one matching transfer and reports the payer', () => {
    const result = checkSettlement(paymentSummary(), expected);
    expect(result.ok).toBe(true);
    expect(result.payer).toBe(payer.publicKey.toBase58());
    expect(result.slot).toBe(42);
  });

  it('rejects wrong amount (off by one), wrong recipient, wrong mint', () => {
    expect(checkSettlement(paymentSummary('10001'), expected).ok).toBe(false);
    expect(checkSettlement(paymentSummary(), { ...expected, amountBaseUnits: '9999' }).ok).toBe(false);
    expect(checkSettlement(paymentSummary(), { ...expected, payTo: Keypair.generate().publicKey.toBase58() }).ok).toBe(false);
    expect(checkSettlement(paymentSummary(), { ...expected, mint: Keypair.generate().publicKey.toBase58() }).ok).toBe(false);
  });

  it('rejects failed and missing transactions', () => {
    expect(checkSettlement(paymentSummary('10000', undefined, { InstructionError: [2, 'Custom'] }), expected)).toMatchObject({ ok: false });
    expect(checkSettlement(null, expected).reason).toContain('not found');
  });

  it('rejects a transaction with two matching transfers (double payment)', () => {
    const transfer = () =>
      createTransferCheckedInstruction(
        getAssociatedTokenAddressSync(new PublicKey(MINT), payer.publicKey),
        new PublicKey(MINT),
        getAssociatedTokenAddressSync(new PublicKey(MINT), merchant.publicKey),
        payer.publicKey,
        10000n,
        6,
        [],
        TOKEN_PROGRAM_ID,
      );
    const message = new TransactionMessage({
      payerKey: feePayer.publicKey,
      recentBlockhash: blockhash,
      instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 20000 }), transfer(), transfer()],
    }).compileToV0Message();
    const summary = summarizeTransaction('sig2', new VersionedTransaction(message), { slot: 1, blockTime: null, err: null });
    expect(checkSettlement(summary, expected)).toMatchObject({ ok: false, reason: expect.stringContaining('more than one') });
  });
});

describe('checkMemoAnchor', () => {
  const memoTx = (signer: Keypair, text: string, err: unknown | null = null) => {
    const message = new TransactionMessage({
      payerKey: signer.publicKey,
      recentBlockhash: blockhash,
      instructions: [new TransactionInstruction({ keys: [], programId: new PublicKey(MEMO), data: Buffer.from(text) })],
    }).compileToV0Message();
    return summarizeTransaction('anchor', new VersionedTransaction(message), { slot: 7, blockTime: 1_800_000_100, err });
  };

  it('accepts a successful transaction signed by the instance key carrying the memo', () => {
    const instance = Keypair.generate();
    const result = checkMemoAnchor(memoTx(instance, 'atlasrail:anchor:v1:abc'), { memo: 'atlasrail:anchor:v1:abc', signer: instance.publicKey.toBase58() });
    expect(result.ok).toBe(true);
    expect(result.slot).toBe(7);
  });

  it('rejects wrong memo, wrong signer, failed and missing transactions', () => {
    const instance = Keypair.generate();
    const summary = memoTx(instance, 'atlasrail:anchor:v1:abc');
    expect(checkMemoAnchor(summary, { memo: 'atlasrail:anchor:v1:other', signer: instance.publicKey.toBase58() }).ok).toBe(false);
    expect(checkMemoAnchor(summary, { memo: 'atlasrail:anchor:v1:abc', signer: Keypair.generate().publicKey.toBase58() }).ok).toBe(false);
    expect(checkMemoAnchor(memoTx(instance, 'atlasrail:anchor:v1:abc', { err: 1 }), { memo: 'atlasrail:anchor:v1:abc', signer: instance.publicKey.toBase58() }).ok).toBe(false);
    expect(checkMemoAnchor(null, { memo: 'x', signer: instance.publicKey.toBase58() }).ok).toBe(false);
  });
});
