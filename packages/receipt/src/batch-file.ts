import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { merkleRoot } from './merkle';

/**
 * Off-chain batch file and header. The chain stores only the header hash, the file hash,
 * the Merkle root, and the leaf count. Salts stay in the receipt, not in the transaction.
 */
const FILE_TAG = new TextEncoder().encode('atlasrail.batch-file/1\0');
const HEADER_TAG = new TextEncoder().encode('atlasrail.batch-header/1\0');

function hex32(value: string, name: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`${name} must be 32 lowercase hex bytes`);
  return hexToBytes(value);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function u64le(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}

function u32le(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) throw new Error('count must be a u32');
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

export function newLeafSalt(): string {
  const salt = new Uint8Array(32);
  crypto.getRandomValues(salt);
  return bytesToHex(salt);
}

/** 64-byte leaf preimage: salt || receipt hash. The Merkle leaf hash is SHA-256(0x00 || this). */
export function saltedLeafPreimage(receiptHash: string, salt: string): string {
  return bytesToHex(concat([hex32(salt, 'salt'), hex32(receiptHash, 'receiptHash')]));
}

export function encodeBatchFile(input: {
  mandate: Uint8Array;
  seq: bigint;
  leaves: readonly { receiptHash: string; salt: string }[];
}): Uint8Array {
  if (input.mandate.length !== 32) throw new Error('mandate must be 32 bytes');
  if (input.leaves.length === 0) throw new Error('batch file needs at least one leaf');
  return concat([
    FILE_TAG,
    input.mandate,
    u64le(input.seq),
    u32le(input.leaves.length),
    ...input.leaves.flatMap((leaf) => [hex32(leaf.salt, 'salt'), hex32(leaf.receiptHash, 'receiptHash')]),
  ]);
}

export function encodeBatchHeader(input: {
  mandate: Uint8Array;
  seq: bigint;
  leafCount: number;
  merkleRoot: Uint8Array;
  batchFileHash: Uint8Array;
}): Uint8Array {
  if (input.mandate.length !== 32 || input.merkleRoot.length !== 32 || input.batchFileHash.length !== 32) {
    throw new Error('batch header fields must be 32 bytes');
  }
  return concat([HEADER_TAG, input.mandate, u64le(input.seq), u32le(input.leafCount), input.merkleRoot, input.batchFileHash]);
}

export function hashBytes(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

export interface SaltedBatch {
  salts: string[];
  /** Hex preimages passed to the Merkle tree, one per receipt. */
  leaves: string[];
  merkleRoot: string;
  batchFileHash: string;
  /** SHA-256 of the canonical header. This is the batch header stored on the Root account. */
  batchHeader: string;
}

export function buildSaltedBatch(input: {
  mandate: Uint8Array;
  seq: bigint;
  receiptHashes: readonly string[];
  salts?: readonly string[];
}): SaltedBatch {
  if (input.receiptHashes.length === 0) throw new Error('anchor_root needs at least one voucher receipt');
  const salts = input.receiptHashes.map((hash, index) => {
    const salt = input.salts?.[index] ?? newLeafSalt();
    hex32(hash, 'receiptHash');
    hex32(salt, 'salt');
    return salt;
  });
  if (input.salts && input.salts.length !== input.receiptHashes.length) {
    throw new Error('salt count must match the receipt count');
  }
  const leaves = input.receiptHashes.map((hash, index) => saltedLeafPreimage(hash, salts[index]!));
  const root = merkleRoot(leaves);
  const batchFile = encodeBatchFile({
    mandate: input.mandate,
    seq: input.seq,
    leaves: input.receiptHashes.map((receiptHash, index) => ({ receiptHash, salt: salts[index]! })),
  });
  const batchFileHash = hashBytes(batchFile);
  const batchHeader = hashBytes(encodeBatchHeader({
    mandate: input.mandate,
    seq: input.seq,
    leafCount: leaves.length,
    merkleRoot: hex32(root, 'merkleRoot'),
    batchFileHash: hex32(batchFileHash, 'batchFileHash'),
  }));
  return { salts, leaves, merkleRoot: root, batchFileHash, batchHeader };
}
