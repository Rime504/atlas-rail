import { createHash } from 'crypto';
import { Connection, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { ALLOWED_SOLANA_PROGRAM_IDS } from '@atlas-rail/config';
import { assertNotMainnet } from './guards';

/**
 * Client for `programs/atlas-mandate` (the on-chain mandate registry, Milestone 1/A). Hand-rolled
 * instead of generated from the Anchor IDL: every field here is fixed-width, Anchor's discriminator
 * scheme (sha256("global:<name>")[0..8] / sha256("account:<Name>")[0..8]) is stable across versions,
 * and this mirrors `programs/atlas-mandate/tests/src/helpers.ts` exactly — see that file if this one
 * ever needs to change, the two should stay in sync.
 *
 * Public functions take/return base58 strings, like the rest of this package (see `anchor.ts`),
 * so callers never need `@solana/web3.js` directly. Devnet/localnet only, like the rest of this package.
 */

const MANDATE_SEED = Buffer.from('mandate');
const ROOT_SEED = Buffer.from('root');

function discriminator(namespace: 'global' | 'account', name: string): Buffer {
  return createHash('sha256').update(`${namespace}:${name}`).digest().subarray(0, 8);
}

export interface MandatePda {
  address: string;
  bump: number;
}

export function findMandatePda(programId: string, mandateHash: Uint8Array): MandatePda {
  const [pda, bump] = PublicKey.findProgramAddressSync([MANDATE_SEED, Buffer.from(mandateHash)], new PublicKey(programId));
  return { address: pda.toBase58(), bump };
}

export interface RootPda {
  address: string;
  bump: number;
}

export function findRootPda(programId: string, mandatePda: string, seq: bigint): RootPda {
  const seqBytes = Buffer.alloc(8);
  seqBytes.writeBigUInt64LE(seq);
  const [pda, bump] = PublicKey.findProgramAddressSync(
    [ROOT_SEED, new PublicKey(mandatePda).toBuffer(), seqBytes],
    new PublicKey(programId),
  );
  return { address: pda.toBase58(), bump };
}

export interface CreateMandateOnChainArgs {
  mandateHash: Uint8Array;
  gateAuthority: string;
  mint: string;
  maxPerPayment: bigint;
  maxPerWindow: bigint;
  windowSeconds: bigint;
  maxTotal: bigint;
  escalationThreshold: bigint;
  notBefore: bigint;
  expiresAt: bigint;
}

// Field order and widths mirror `CreateMandateArgs` in programs/atlas-mandate/src/lib.rs exactly.
function encodeCreateMandateArgs(args: CreateMandateOnChainArgs): Buffer {
  if (args.mandateHash.length !== 32) throw new Error('mandateHash must be 32 bytes');
  const body = Buffer.alloc(32 + 32 + 32 + 8 * 7);
  let o = 0;
  Buffer.from(args.mandateHash).copy(body, o); o += 32;
  new PublicKey(args.gateAuthority).toBuffer().copy(body, o); o += 32;
  new PublicKey(args.mint).toBuffer().copy(body, o); o += 32;
  body.writeBigUInt64LE(args.maxPerPayment, o); o += 8;
  body.writeBigUInt64LE(args.maxPerWindow, o); o += 8;
  body.writeBigInt64LE(args.windowSeconds, o); o += 8;
  body.writeBigUInt64LE(args.maxTotal, o); o += 8;
  body.writeBigUInt64LE(args.escalationThreshold, o); o += 8;
  body.writeBigInt64LE(args.notBefore, o); o += 8;
  body.writeBigInt64LE(args.expiresAt, o); o += 8;
  return Buffer.concat([discriminator('global', 'create_mandate'), body]);
}

export interface MandateAccountOnChain {
  /** Hex-encoded, like `MandateRecord.mandateHash` elsewhere in this repo. */
  mandateHash: string;
  owner: string;
  approver: string;
  agent: string;
  gateAuthority: string;
  mint: string;
  maxPerPayment: bigint;
  maxPerWindow: bigint;
  windowSeconds: bigint;
  maxTotal: bigint;
  escalationThreshold: bigint;
  notBefore: bigint;
  expiresAt: bigint;
  createdAt: bigint;
  revoked: boolean;
  revokedAt: bigint;
  revokedBy: string;
  nextRootSeq: bigint;
  bump: number;
}

const MANDATE_ACCOUNT_DISCRIMINATOR = discriminator('account', 'Mandate');
// mandate_hash + 5 pubkeys (owner, approver, agent, gate_authority, mint) + 8 numeric fields
// (max_per_payment, max_per_window, window_seconds, max_total, escalation_threshold, not_before,
// expires_at, created_at) + revoked(bool) + revoked_at(i64) + revoked_by(pubkey) +
// next_root_seq(u64) + bump(u8), after the 8-byte account discriminator.
// Matches `Mandate` in programs/atlas-mandate/src/lib.rs.
const MANDATE_ACCOUNT_BODY_LEN = 32 + 32 * 5 + 8 * 8 + 1 + 8 + 32 + 8 + 1;

/** Decodes a raw `Mandate` account's data (as returned by `getAccountInfo`). */
export function decodeMandateAccount(data: Buffer): MandateAccountOnChain {
  if (data.length < 8 + MANDATE_ACCOUNT_BODY_LEN) throw new Error('Mandate account data is too short');
  if (!data.subarray(0, 8).equals(MANDATE_ACCOUNT_DISCRIMINATOR)) {
    throw new Error('Account discriminator does not match Mandate — wrong program ID or account type');
  }
  let o = 8;
  const pubkey = () => {
    const key = new PublicKey(data.subarray(o, o + 32)).toBase58();
    o += 32;
    return key;
  };
  const u64 = () => {
    const value = data.readBigUInt64LE(o);
    o += 8;
    return value;
  };
  const i64 = () => {
    const value = data.readBigInt64LE(o);
    o += 8;
    return value;
  };
  const mandateHash = data.subarray(o, o + 32).toString('hex');
  o += 32;
  const owner = pubkey();
  const approver = pubkey();
  const agent = pubkey();
  const gateAuthority = pubkey();
  const mint = pubkey();
  const maxPerPayment = u64();
  const maxPerWindow = u64();
  const windowSeconds = i64();
  const maxTotal = u64();
  const escalationThreshold = u64();
  const notBefore = i64();
  const expiresAt = i64();
  const createdAt = i64();
  const revoked = data.readUInt8(o) === 1;
  o += 1;
  const revokedAt = i64();
  const revokedBy = pubkey();
  const nextRootSeq = u64();
  const bump = data.readUInt8(o);
  return {
    mandateHash,
    owner,
    approver,
    agent,
    gateAuthority,
    mint,
    maxPerPayment,
    maxPerWindow,
    windowSeconds,
    maxTotal,
    escalationThreshold,
    notBefore,
    expiresAt,
    createdAt,
    revoked,
    revokedAt,
    revokedBy,
    nextRootSeq,
    bump,
  };
}

export interface RootAccountOnChain {
  mandate: string;
  seq: bigint;
  /** Hex-encoded 32-byte Merkle root. */
  merkleRoot: string;
  leafCount: number;
  anchoredAt: bigint;
  bump: number;
}

const ROOT_ACCOUNT_DISCRIMINATOR = discriminator('account', 'Root');
// mandate(32) + seq(8) + merkle_root(32) + leaf_count(4) + anchored_at(8) + bump(1)
const ROOT_ACCOUNT_BODY_LEN = 32 + 8 + 32 + 4 + 8 + 1;

/** Decodes a raw `Root` account's data (as returned by `getAccountInfo`). */
export function decodeRootAccount(data: Buffer): RootAccountOnChain {
  if (data.length < 8 + ROOT_ACCOUNT_BODY_LEN) throw new Error('Root account data is too short');
  if (!data.subarray(0, 8).equals(ROOT_ACCOUNT_DISCRIMINATOR)) {
    throw new Error('Account discriminator does not match Root — wrong program ID or account type');
  }
  let o = 8;
  const mandate = new PublicKey(data.subarray(o, o + 32)).toBase58();
  o += 32;
  const seq = data.readBigUInt64LE(o);
  o += 8;
  const merkleRoot = data.subarray(o, o + 32).toString('hex');
  o += 32;
  const leafCount = data.readUInt32LE(o);
  o += 4;
  const anchoredAt = data.readBigInt64LE(o);
  o += 8;
  const bump = data.readUInt8(o);
  return { mandate, seq, merkleRoot, leafCount, anchoredAt, bump };
}

export interface AnchorRootOnChainArgs {
  seq: bigint;
  merkleRoot: Uint8Array;
  leafCount: number;
}

function encodeAnchorRootArgs(args: AnchorRootOnChainArgs): Buffer {
  if (args.merkleRoot.length !== 32) throw new Error('merkleRoot must be 32 bytes');
  if (!Number.isInteger(args.leafCount) || args.leafCount < 0 || args.leafCount > 0xffff_ffff) {
    throw new Error('leafCount must be a u32');
  }
  const body = Buffer.alloc(8 + 32 + 4);
  let o = 0;
  body.writeBigUInt64LE(args.seq, o); o += 8;
  Buffer.from(args.merkleRoot).copy(body, o); o += 32;
  body.writeUInt32LE(args.leafCount, o);
  return Buffer.concat([discriminator('global', 'anchor_root'), body]);
}

export interface BuildCreateMandateTransactionParams extends CreateMandateOnChainArgs {
  programId: string;
  owner: string;
  approver: string;
  agent: string;
  recentBlockhash: string;
}

/** Builds the unsigned v0 transaction for `create_mandate`. Owner, approver and agent must all sign. */
export function buildCreateMandateTransaction(params: BuildCreateMandateTransactionParams): string {
  const programId = new PublicKey(params.programId);
  const owner = new PublicKey(params.owner);
  const { address: mandatePda } = findMandatePda(params.programId, params.mandateHash);
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: new PublicKey(mandatePda), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: new PublicKey(params.approver), isSigner: true, isWritable: false },
      { pubkey: new PublicKey(params.agent), isSigner: true, isWritable: false },
      { pubkey: new PublicKey(ALLOWED_SOLANA_PROGRAM_IDS.SYSTEM_PROGRAM), isSigner: false, isWritable: false },
    ],
    data: encodeCreateMandateArgs(params),
  });
  const message = new TransactionMessage({
    payerKey: owner,
    recentBlockhash: params.recentBlockhash,
    instructions: [ix],
  }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(message).serialize()).toString('base64');
}

export interface BuildRevokeMandateTransactionParams {
  programId: string;
  mandatePda: string;
  authority: string;
  recentBlockhash: string;
}

/** Builds the unsigned v0 transaction for `revoke_mandate`. Only the owner or approver may sign. */
export function buildRevokeMandateTransaction(params: BuildRevokeMandateTransactionParams): string {
  const authority = new PublicKey(params.authority);
  const ix = new TransactionInstruction({
    programId: new PublicKey(params.programId),
    keys: [
      { pubkey: new PublicKey(params.mandatePda), isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data: discriminator('global', 'revoke_mandate'),
  });
  const message = new TransactionMessage({
    payerKey: authority,
    recentBlockhash: params.recentBlockhash,
    instructions: [ix],
  }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(message).serialize()).toString('base64');
}

export interface BuildAnchorRootTransactionParams extends AnchorRootOnChainArgs {
  programId: string;
  mandatePda: string;
  gateAuthority: string;
  recentBlockhash: string;
}

/** Builds the unsigned v0 transaction for `anchor_root`. Only the gate authority may sign. */
export function buildAnchorRootTransaction(params: BuildAnchorRootTransactionParams): string {
  const gateAuthority = new PublicKey(params.gateAuthority);
  const { address: rootPda } = findRootPda(params.programId, params.mandatePda, params.seq);
  const ix = new TransactionInstruction({
    programId: new PublicKey(params.programId),
    keys: [
      { pubkey: new PublicKey(params.mandatePda), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(rootPda), isSigner: false, isWritable: true },
      { pubkey: gateAuthority, isSigner: true, isWritable: true },
      { pubkey: new PublicKey(ALLOWED_SOLANA_PROGRAM_IDS.SYSTEM_PROGRAM), isSigner: false, isWritable: false },
    ],
    data: encodeAnchorRootArgs(params),
  });
  const message = new TransactionMessage({
    payerKey: gateAuthority,
    recentBlockhash: params.recentBlockhash,
    instructions: [ix],
  }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(message).serialize()).toString('base64');
}

/**
 * Reads a mandate's on-chain state directly (not via {@link ChainClient}, which has no raw account
 * read today). Returns `null` if the account does not exist (mandate never registered on-chain, or a
 * devnet reset). Constructs its own short-lived connection — this is called rarely (gate evaluation,
 * mandate presentation), not on a hot path.
 */
export async function fetchMandateAccount(rpcUrl: string, mandatePda: string): Promise<MandateAccountOnChain | null> {
  assertNotMainnet(rpcUrl);
  const connection = new Connection(rpcUrl, 'confirmed');
  const info = await connection.getAccountInfo(new PublicKey(mandatePda), 'confirmed');
  if (!info) return null;
  return decodeMandateAccount(info.data);
}
