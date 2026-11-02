import { describe, expect, it } from 'vitest';
import { saltedLeafPreimage, verifyMerkleProof } from '@atlas-rail/receipt';
import { Keypair } from '@solana/web3.js';
import { combineVoucherReceipts, distributedReceiptsForAnchor, payAnchorAttachment, stampVoucherAnchor } from './anchor-batch';

describe('combineVoucherReceipts', () => {
  it('proves each salted leaf and hides the receipt hash without the salt', () => {
    const mandate = Keypair.generate().publicKey.toBase58();
    const first = '11'.repeat(32);
    const second = '22'.repeat(32);
    const salts = ['aa'.repeat(32), 'bb'.repeat(32)];
    const combined = combineVoucherReceipts({ mandate, seq: 0, receiptHashes: [first, second], salts });
    const receipts = [{ receiptHash: first }, { receiptHash: second }];
    stampVoucherAnchor(receipts, {
      merkleRoot: combined.merkleRoot,
      leaves: combined.leaves,
      salts: combined.salts,
      batchHeader: combined.batchHeader,
      batchFileHash: combined.batchFileHash,
      txSignature: 'sig',
      network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
      signer: 'gate',
      seq: 0,
      anchoredAt: 1,
      batchId: 'anc_test',
    });
    expect(receipts[0].anchor?.mechanism).toBe('root');
    expect(receipts[0].anchor?.leafSalt).toBe(salts[0]);
    expect(receipts[0].anchor?.batchFileHash).toBe(combined.batchFileHash);
    expect(verifyMerkleProof(saltedLeafPreimage(first, salts[0]!), receipts[0].anchor!.proof, combined.merkleRoot)).toBe(true);
    expect(verifyMerkleProof(first, receipts[0].anchor!.proof, combined.merkleRoot)).toBe(false);
    const other = combineVoucherReceipts({ mandate, seq: 0, receiptHashes: [first, second], salts: ['cc'.repeat(32), salts[1]!] });
    expect(other.merkleRoot).not.toBe(combined.merkleRoot);
    expect(other.batchFileHash).not.toBe(combined.batchFileHash);
  });
});

describe('pay anchor batch', () => {
  it('keeps only distributed receipts this gate key attested', () => {
    const gate = 'gate-key';
    const mandate = 'mandate-pda';
    const selected = distributedReceiptsForAnchor([
      { distributeSignature: 'dist', request: { mandateAddress: mandate }, receipt: { id: 'b', issuedAt: 2, instance: { publicKey: gate } } },
      { distributeSignature: 'dist', request: { mandateAddress: mandate }, receipt: { id: 'a', issuedAt: 1, instance: { publicKey: 'other-key' } } },
      { request: { mandateAddress: mandate }, receipt: { id: 'c', issuedAt: 0, instance: { publicKey: gate } } },
      { distributeSignature: 'dist', request: { mandateAddress: mandate }, receipt: { id: 'd', issuedAt: 3, instance: { publicKey: gate }, anchor: { mechanism: 'root' } } },
    ], mandate, gate);
    expect(selected.map((payment) => payment.receipt?.id)).toEqual(['b']);
  });

  it('keeps a paid payment when the root fails and attaches the root when it confirms', () => {
    expect(payAnchorAttachment({ ok: false, message: 'empty' })).toEqual({});
    expect(payAnchorAttachment({ ok: false, message: 'Gate key is required to sign anchor_root' })).toEqual({
      anchorError: 'Gate key is required to sign anchor_root',
    });
    expect(payAnchorAttachment({
      ok: true,
      rootPda: 'root',
      merkleRoot: 'aa',
      leafCount: 1,
      seq: 0,
      signature: 'sig',
      settlements: ['settle'],
    }).anchor?.signature).toBe('sig');
  });
});
