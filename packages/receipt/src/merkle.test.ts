import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { buildAnchorMemo, hashLeaf, merkleProof, merkleRoot, parseAnchorMemo, verifyMerkleProof } from './merkle';

const leaf = (n: number) => bytesToHex(sha256(new TextEncoder().encode(`receipt-${n}`)));
const leaves = (n: number) => Array.from({ length: n }, (_, i) => leaf(i));

describe('merkle tree (RFC 6962 shape)', () => {
  it('a single-leaf tree has the leaf hash as root and an empty proof', () => {
    const root = merkleRoot([leaf(0)]);
    expect(root).toBe(bytesToHex(hashLeaf(leaf(0))));
    expect(merkleProof([leaf(0)], 0)).toEqual([]);
    expect(verifyMerkleProof(leaf(0), [], root)).toBe(true);
  });

  it('every leaf of every tree size from 1 to 40 has a proof that verifies', () => {
    for (let n = 1; n <= 40; n++) {
      const l = leaves(n);
      const root = merkleRoot(l);
      for (let i = 0; i < n; i++) {
        expect(verifyMerkleProof(l[i], merkleProof(l, i), root), `n=${n} i=${i}`).toBe(true);
      }
    }
  });

  it('proof length is at most ceil(log2 n)', () => {
    for (const n of [1, 2, 3, 5, 8, 9, 33, 100]) {
      const l = leaves(n);
      for (let i = 0; i < n; i++) expect(merkleProof(l, i).length).toBeLessThanOrEqual(Math.ceil(Math.log2(n)));
    }
  });

  it('rejects tampered leaves, siblings, positions and roots', () => {
    const l = leaves(7);
    const root = merkleRoot(l);
    const proof = merkleProof(l, 3);
    expect(verifyMerkleProof(leaf(99), proof, root)).toBe(false);
    expect(verifyMerkleProof(l[3], proof, merkleRoot(leaves(8)))).toBe(false);
    const flippedSibling = proof.map((s, i) => (i === 0 ? { ...s, hash: leaf(123) } : s));
    expect(verifyMerkleProof(l[3], flippedSibling, root)).toBe(false);
    const flippedSide = proof.map((s, i) => (i === 0 ? { ...s, position: s.position === 'left' ? ('right' as const) : ('left' as const) } : s));
    expect(verifyMerkleProof(l[3], flippedSide, root)).toBe(false);
    expect(verifyMerkleProof(l[3], proof.slice(1), root)).toBe(false);
  });

  it('is order sensitive and does not confuse [a,b,c] with [a,b,c,c] (no duplicate-node malleability)', () => {
    const [a, b, c] = leaves(3);
    expect(merkleRoot([a, b, c])).not.toBe(merkleRoot([a, b, c, c]));
    expect(merkleRoot([a, b])).not.toBe(merkleRoot([b, a]));
  });

  it('domain separation: an interior node cannot be presented as a leaf (second-preimage resistance)', () => {
    const [a, b, c] = leaves(3);
    const root = merkleRoot([a, b, c]);
    // The interior node covering [a, b] is the left sibling in c's proof. Using it as a "leaf" of a
    // two-leaf tree must not reproduce the real root.
    const proofOfC = merkleProof([a, b, c], 2);
    const interior = proofOfC[0].hash;
    expect(verifyMerkleProof(interior, [{ position: 'right', hash: bytesToHex(hashLeaf(c)) }], root)).toBe(false);
  });

  it('rejects empty trees and out-of-range indexes; verify never throws on garbage', () => {
    expect(() => merkleRoot([])).toThrow();
    expect(() => merkleProof(leaves(3), 3)).toThrow();
    expect(() => merkleProof(leaves(3), -1)).toThrow();
    expect(verifyMerkleProof('zz', [], 'yy')).toBe(false);
    expect(verifyMerkleProof(leaf(0), [{ position: 'left', hash: 'abcd' }], merkleRoot([leaf(0)]))).toBe(false);
  });

  it('property: proofs verify for random tree sizes and indexes', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 64 }), fc.nat(), (n, seed) => {
        const l = leaves(n);
        const i = seed % n;
        expect(verifyMerkleProof(l[i], merkleProof(l, i), merkleRoot(l))).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

describe('anchor memo', () => {
  it('round-trips and rejects malformed memos', () => {
    const root = merkleRoot(leaves(5));
    const memo = buildAnchorMemo({ merkleRoot: root, leafCount: 5, batchId: 'anc_01ABC' });
    expect(memo).toBe(`atlasrail:anchor:v1:${root}:5:anc_01ABC`);
    expect(parseAnchorMemo(memo)).toEqual({ merkleRoot: root, leafCount: 5, batchId: 'anc_01ABC' });
    for (const bad of ['', 'atlasrail:anchor:v1:short:5:x', `atlasrail:anchor:v2:${root}:5:x`, `atlasrail:anchor:v1:${root}:0:x`, `atlasrail:anchor:v1:${root}:5:`]) {
      expect(parseAnchorMemo(bad)).toBeNull();
    }
    expect(new TextEncoder().encode(memo).length).toBeLessThan(200);
  });
});
