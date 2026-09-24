import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

/**
 * Binary Merkle tree with RFC 6962 (Certificate Transparency) domain separation and tree shape:
 *
 *   leaf hash  = SHA-256(0x00 || leaf)
 *   node hash  = SHA-256(0x01 || left || right)
 *   MTH(D[n])  = node(MTH(D[0:k]), MTH(D[k:n])) with k the largest power of two < n
 *
 * The 0x00/0x01 prefixes make a leaf indistinguishable from an interior node (no second-preimage
 * attacks), and the RFC 6962 shape never duplicates a node, so `[a, b, c]` and `[a, b, c, c]` have
 * different roots.
 */

export interface MerkleStep {
  /** Where the sibling sits relative to the running hash. */
  position: 'left' | 'right';
  /** Sibling hash, lowercase hex. */
  hash: string;
}

const LEAF_PREFIX = new Uint8Array([0x00]);
const NODE_PREFIX = new Uint8Array([0x01]);

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function hashLeaf(leafHex: string): Uint8Array {
  return sha256(concat(LEAF_PREFIX, hexToBytes(leafHex)));
}

function hashNode(left: Uint8Array, right: Uint8Array): Uint8Array {
  return sha256(concat(NODE_PREFIX, left, right));
}

function splitPoint(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

function mth(leaves: Uint8Array[], lo: number, hi: number): Uint8Array {
  const n = hi - lo;
  if (n === 1) return leaves[lo];
  const k = splitPoint(n);
  return hashNode(mth(leaves, lo, lo + k), mth(leaves, lo + k, hi));
}

function buildPath(leaves: Uint8Array[], index: number, lo: number, hi: number): MerkleStep[] {
  const n = hi - lo;
  if (n === 1) return [];
  const k = splitPoint(n);
  if (index < lo + k) {
    return [...buildPath(leaves, index, lo, lo + k), { position: 'right', hash: bytesToHex(mth(leaves, lo + k, hi)) }];
  }
  return [...buildPath(leaves, index, lo + k, hi), { position: 'left', hash: bytesToHex(mth(leaves, lo, lo + k)) }];
}

function leafHashes(leavesHex: readonly string[]): Uint8Array[] {
  if (leavesHex.length === 0) throw new Error('A Merkle tree needs at least one leaf');
  return leavesHex.map(hashLeaf);
}

/** Merkle root (lowercase hex) over the given 32-byte leaves (lowercase hex), in order. */
export function merkleRoot(leavesHex: readonly string[]): string {
  const leaves = leafHashes(leavesHex);
  return bytesToHex(mth(leaves, 0, leaves.length));
}

/** Inclusion proof for the leaf at `index`. */
export function merkleProof(leavesHex: readonly string[], index: number): MerkleStep[] {
  const leaves = leafHashes(leavesHex);
  if (!Number.isInteger(index) || index < 0 || index >= leaves.length) throw new Error('leaf index out of range');
  return buildPath(leaves, index, 0, leaves.length);
}

/** Recomputes the root from a leaf and its proof and compares it with `rootHex`. Never throws. */
export function verifyMerkleProof(leafHex: string, proof: readonly MerkleStep[], rootHex: string): boolean {
  try {
    let running = hashLeaf(leafHex);
    for (const step of proof) {
      if (step.position !== 'left' && step.position !== 'right') return false;
      const sibling = hexToBytes(step.hash);
      if (sibling.length !== 32) return false;
      running = step.position === 'left' ? hashNode(sibling, running) : hashNode(running, sibling);
    }
    return bytesToHex(running) === rootHex;
  } catch {
    return false;
  }
}

/** Memo written to Solana to anchor a batch. Fixed, human-readable, well under the 566-byte memo limit. */
export function buildAnchorMemo(input: { merkleRoot: string; leafCount: number; batchId: string }): string {
  return `atlasrail:anchor:v1:${input.merkleRoot}:${input.leafCount}:${input.batchId}`;
}

const ANCHOR_MEMO = /^atlasrail:anchor:v1:([0-9a-f]{64}):([1-9][0-9]{0,8}):([A-Za-z0-9_]{1,64})$/;

export function parseAnchorMemo(memo: string): { merkleRoot: string; leafCount: number; batchId: string } | null {
  const match = ANCHOR_MEMO.exec(memo);
  return match ? { merkleRoot: match[1], leafCount: Number(match[2]), batchId: match[3] } : null;
}
