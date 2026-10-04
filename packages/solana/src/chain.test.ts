import { createHash } from 'crypto';
import { ComputeBudgetProgram, Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { describe, expect, it } from 'vitest';
import { checkMemoAnchor, checkRootAnchor, checkSettlement, summarizeTransaction } from './chain';
import { findMandatePda, findRootPda } from './mandate-registry';
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

describe('checkRootAnchor', () => {
  const PROGRAM_ID = '11111111111111111111111111111112'; // any valid base58 pubkey works for a unit test
  const mandateHash = new Uint8Array(32).fill(7);
  const { address: mandatePda } = findMandatePda(PROGRAM_ID, mandateHash);
  const merkleRootHex = 'a'.repeat(64);

  function anchorRootTx(signer: Keypair, overrides: { seq?: bigint; merkleRootHex?: string; leafCount?: number; mandatePda?: string } = {}, err: unknown | null = null) {
    const seq = overrides.seq ?? 0n;
    const root = overrides.merkleRootHex ?? merkleRootHex;
    const leafCount = overrides.leafCount ?? 3;
    const targetMandatePda = overrides.mandatePda ?? mandatePda;
    const { address: rootPda } = findRootPda(PROGRAM_ID, targetMandatePda, seq);

    const discriminator = createHash('sha256').update('global:anchor_root').digest().subarray(0, 8);
    const body = Buffer.alloc(8 + 32 + 4);
    body.writeBigUInt64LE(seq, 0);
    Buffer.from(root, 'hex').copy(body, 8);
    body.writeUInt32LE(leafCount, 40);
    const data = Buffer.concat([discriminator, body]);

    const ix = new TransactionInstruction({
      programId: new PublicKey(PROGRAM_ID),
      keys: [
        { pubkey: new PublicKey(targetMandatePda), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(rootPda), isSigner: false, isWritable: true },
        { pubkey: signer.publicKey, isSigner: true, isWritable: true },
        { pubkey: PublicKey.default, isSigner: false, isWritable: false },
      ],
      data,
    });
    const message = new TransactionMessage({ payerKey: signer.publicKey, recentBlockhash: blockhash, instructions: [ix] }).compileToV0Message();
    return summarizeTransaction('anchor-root', new VersionedTransaction(message), { slot: 9, blockTime: 1_800_000_200, err });
  }

  const expected = (overrides: Partial<{ seq: bigint; merkleRoot: string; leafCount: number; signer: string }> = {}, signer: Keypair) => ({
    programId: PROGRAM_ID,
    mandatePda,
    signer: signer.publicKey.toBase58(),
    seq: 0n,
    merkleRoot: merkleRootHex,
    leafCount: 3,
    ...overrides,
  });

  it('accepts a successful anchor_root transaction with matching seq, root and leaf count', () => {
    const instance = Keypair.generate();
    const result = checkRootAnchor(anchorRootTx(instance), expected({}, instance));
    expect(result.ok).toBe(true);
    expect(result.slot).toBe(9);
  });

  it('accepts a non-zero seq', () => {
    const instance = Keypair.generate();
    const result = checkRootAnchor(anchorRootTx(instance, { seq: 5n }), expected({ seq: 5n }, instance));
    expect(result.ok).toBe(true);
  });

  it('rejects a mismatched seq, merkle root, or leaf count', () => {
    const instance = Keypair.generate();
    const tx = anchorRootTx(instance);
    expect(checkRootAnchor(tx, expected({ seq: 1n }, instance)).ok).toBe(false);
    expect(checkRootAnchor(tx, expected({ merkleRoot: 'b'.repeat(64) }, instance)).ok).toBe(false);
    expect(checkRootAnchor(tx, expected({ leafCount: 4 }, instance)).ok).toBe(false);
  });

  it('rejects the wrong signer, wrong mandate PDA, a failed transaction, and a missing transaction', () => {
    const instance = Keypair.generate();
    const tx = anchorRootTx(instance);
    expect(checkRootAnchor(tx, expected({}, Keypair.generate())).ok).toBe(false);
    const otherMandate = findMandatePda(PROGRAM_ID, new Uint8Array(32).fill(9)).address;
    expect(checkRootAnchor(tx, { ...expected({}, instance), mandatePda: otherMandate }).ok).toBe(false);
    expect(checkRootAnchor(anchorRootTx(instance, {}, { err: 1 }), expected({}, instance)).ok).toBe(false);
    expect(checkRootAnchor(null, expected({}, instance)).ok).toBe(false);
  });

  it('rejects a transaction that does not invoke the mandate registry at all', () => {
    const instance = Keypair.generate();
    const summary = paymentSummary();
    expect(checkRootAnchor(summary, expected({}, instance)).ok).toBe(false);
  });
});
