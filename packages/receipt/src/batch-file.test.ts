import { describe, expect, it } from 'vitest';
import { merkleProof, verifyMerkleProof } from './merkle';
import { buildSaltedBatch, saltedLeafPreimage } from './batch-file';

const mandate = new Uint8Array(32).fill(7);
const hash = (byte: string) => byte.repeat(32);

describe('salted batch file', () => {
  it('lets a receipt prove inclusion and keeps the unsalted hash out of the root', () => {
    const salts = [hash('a1'), hash('b2'), hash('c3')];
    const receipts = [hash('11'), hash('22'), hash('33')];
    const batch = buildSaltedBatch({ mandate, seq: 4n, receiptHashes: receipts, salts });
    expect(batch.batchHeader).toMatch(/^[0-9a-f]{64}$/);
    expect(batch.batchFileHash).toMatch(/^[0-9a-f]{64}$/);
    receipts.forEach((receiptHash, index) => {
      expect(verifyMerkleProof(saltedLeafPreimage(receiptHash, salts[index]!), merkleProof(batch.leaves, index), batch.merkleRoot)).toBe(true);
      expect(verifyMerkleProof(receiptHash, merkleProof(batch.leaves, index), batch.merkleRoot)).toBe(false);
    });
    const reordered = buildSaltedBatch({
      mandate,
      seq: 4n,
      receiptHashes: [receipts[1]!, receipts[0]!, receipts[2]!],
      salts: [salts[1]!, salts[0]!, salts[2]!],
    });
    expect(reordered.batchFileHash).not.toBe(batch.batchFileHash);
  });
});
