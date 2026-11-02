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
export const DEFAULT_MANDATE_PROGRAM_ID = 'CnGoTE5Bxc8MFGaeK5LDv5uAZ7pNiktMunYy8JZcLY4k';

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
  /** SHA-256 of the canonical batch header. Null on roots written before this field existed. */
  batchHeader: string | null;
  /** SHA-256 of the canonical batch file. Null on roots written before this field existed. */
  batchFileHash: string | null;
  bump: number;
}

const ROOT_ACCOUNT_DISCRIMINATOR = discriminator('account', 'Root');
/** Written by `anchor_root_v2`: always carries the batch header and file hash. */
const ROOT_V2_ACCOUNT_DISCRIMINATOR = discriminator('account', 'RootV2');
const ROOT_PREFIX_LEN = 32 + 8 + 32 + 4 + 8;
const ROOT_OLD_BODY_LEN = ROOT_PREFIX_LEN + 1;
const ROOT_NEW_BODY_LEN = ROOT_PREFIX_LEN + 32 + 32 + 1;

/** Decodes a raw `Root` or `RootV2` account. `Root` accounts (deprecated `anchor_root`) omit the batch header and file hash. */
export function decodeRootAccount(data: Buffer): RootAccountOnChain {
  if (data.length < 8 + ROOT_OLD_BODY_LEN) throw new Error('Root account data is too short');
  const v2 = data.subarray(0, 8).equals(ROOT_V2_ACCOUNT_DISCRIMINATOR);
  if (!v2 && !data.subarray(0, 8).equals(ROOT_ACCOUNT_DISCRIMINATOR)) {
    throw new Error('Account discriminator does not match Root — wrong program ID or account type');
  }
  if (v2 && data.length < 8 + ROOT_NEW_BODY_LEN) throw new Error('RootV2 account data is too short');
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
  let batchHeader: string | null = null;
  let batchFileHash: string | null = null;
  if (data.length >= 8 + ROOT_NEW_BODY_LEN) {
    batchHeader = data.subarray(o, o + 32).toString('hex');
    o += 32;
    batchFileHash = data.subarray(o, o + 32).toString('hex');
    o += 32;
  }
  const bump = data.readUInt8(o);
  return { mandate, seq, merkleRoot, leafCount, anchoredAt, batchHeader, batchFileHash, bump };
}

export function pubkeyBytes(address: string): Uint8Array {
  return new PublicKey(address).toBytes();
}

export interface AnchorRootOnChainArgs {
  seq: bigint;
  merkleRoot: Uint8Array;
  leafCount: number;
  batchHeader: Uint8Array;
  batchFileHash: Uint8Array;
}

function encodeAnchorRootArgs(args: AnchorRootOnChainArgs, legacyInstruction = false): Buffer {
  if (args.merkleRoot.length !== 32) throw new Error('merkleRoot must be 32 bytes');
  if (args.batchHeader.length !== 32) throw new Error('batchHeader must be 32 bytes');
  if (args.batchFileHash.length !== 32) throw new Error('batchFileHash must be 32 bytes');
  if (!Number.isInteger(args.leafCount) || args.leafCount < 0 || args.leafCount > 0xffff_ffff) {
    throw new Error('leafCount must be a u32');
  }
  const body = Buffer.alloc(8 + 32 + 4 + 32 + 32);
  let o = 0;
  body.writeBigUInt64LE(args.seq, o); o += 8;
  Buffer.from(args.merkleRoot).copy(body, o); o += 32;
  body.writeUInt32LE(args.leafCount, o); o += 4;
  Buffer.from(args.batchHeader).copy(body, o); o += 32;
  Buffer.from(args.batchFileHash).copy(body, o);
  return Buffer.concat([discriminator('global', legacyInstruction ? 'anchor_root' : 'anchor_root_v2'), body]);
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
  /**
   * Until the Devnet program has anchor_root_v2: send the same bytes under the deprecated
   * anchor_root, which stores the root and leaf count and ignores the two hashes. They stay in the
   * instruction data, where `atlas verify` reads them.
   */
  legacyInstruction?: boolean;
}

/** Builds the unsigned v0 transaction for `anchor_root_v2`. Only the gate authority may sign.
 * One instruction: seq, Merkle root, leaf count, batch header hash, and batch file hash.
 * No memo is attached. A memo would publish payment identifiers. */
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
    data: encodeAnchorRootArgs(params, params.legacyInstruction),
  });
  const message = new TransactionMessage({
    payerKey: gateAuthority,
    recentBlockhash: params.recentBlockhash,
    instructions: [ix],
  }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(message).serialize()).toString('base64');
}

/** Loads a mandate account. Returns null when the account does not exist. */
export async function fetchMandateAccount(rpcUrl: string, mandatePda: string): Promise<MandateAccountOnChain | null> {
  assertNotMainnet(rpcUrl);
  const connection = new Connection(rpcUrl, 'confirmed');
  const info = await connection.getAccountInfo(new PublicKey(mandatePda), 'confirmed');
  if (!info) return null;
  if (!info.owner.equals(new PublicKey(DEFAULT_MANDATE_PROGRAM_ID))) {
    throw new Error('Account owner is not the Atlas Mandate program');
  }
  return decodeMandateAccount(info.data);
}

/** Loads a mandate PDA and fails closed if missing, wrong owner, or undecodable. */
export async function loadMandateAccount(
  connection: Connection,
  mandatePda: string,
  programId: string = DEFAULT_MANDATE_PROGRAM_ID,
): Promise<MandateAccountOnChain> {
  const info = await connection.getAccountInfo(new PublicKey(mandatePda), 'confirmed');
  if (!info) throw new Error('Mandate account is missing');
  if (!info.owner.equals(new PublicKey(programId))) {
    throw new Error('Account owner is not the Atlas Mandate program');
  }
  return decodeMandateAccount(info.data);
}

/** True when the account is not revoked and the clock is inside [notBefore, expiresAt). */
export function isMandateAccountActive(account: MandateAccountOnChain, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  return !account.revoked && nowSeconds >= Number(account.notBefore) && nowSeconds < Number(account.expiresAt);
}

export interface OnChainMandateExport {
  schema_version: 'atlasrail.onchain-mandate/1';
  network: 'devnet';
  program_id: string;
  mandate_address: string;
  mandate_hash: string;
  owner: string;
  approver: string;
  agent: string;
  gate_authority: string;
  token_mint: string;
  max_payment: string;
  max_per_window: string;
  window_seconds: string;
  total_budget: string;
  escalation_threshold: string;
  not_before: string;
  expires_at: string;
  created_at: string;
  revoked: boolean;
  revoked_at: string;
  next_root_seq: string;
  /** Off-chain-only fields the program does not store. Optional portable snapshot. */
  off_chain?: {
    label?: string;
    allowed_recipients?: string[];
    allowed_resources?: string[];
    note?: string;
  };
  tx_signature?: string;
}

export function exportMandateAccountJson(
  mandatePda: string,
  account: MandateAccountOnChain,
  options: {
    programId?: string;
    offChain?: OnChainMandateExport['off_chain'];
    txSignature?: string;
  } = {},
): OnChainMandateExport {
  return {
    schema_version: 'atlasrail.onchain-mandate/1',
    network: 'devnet',
    program_id: options.programId ?? DEFAULT_MANDATE_PROGRAM_ID,
    mandate_address: mandatePda,
    mandate_hash: account.mandateHash,
    owner: account.owner,
    approver: account.approver,
    agent: account.agent,
    gate_authority: account.gateAuthority,
    token_mint: account.mint,
    max_payment: account.maxPerPayment.toString(),
    max_per_window: account.maxPerWindow.toString(),
    window_seconds: account.windowSeconds.toString(),
    total_budget: account.maxTotal.toString(),
    escalation_threshold: account.escalationThreshold.toString(),
    not_before: account.notBefore.toString(),
    expires_at: account.expiresAt.toString(),
    created_at: account.createdAt.toString(),
    revoked: account.revoked,
    revoked_at: account.revokedAt.toString(),
    next_root_seq: account.nextRootSeq.toString(),
    off_chain: options.offChain,
    tx_signature: options.txSignature,
  };
}
