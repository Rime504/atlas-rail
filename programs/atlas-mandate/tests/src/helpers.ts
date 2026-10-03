import { createHash } from 'crypto';
import * as path from 'path';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { LiteSVM, FailedTransactionMetadata, TransactionMetadata, Clock } from 'litesvm';
import * as borsh from 'borsh';

/**
 * litesvm's public `LiteSVM` class only exposes `sendTransaction(tx)` typed against
 * `@solana/kit`'s Transaction (a different wire-building API from `@solana/web3.js`).
 * Underneath, `inner` is the native (NAPI) binding, which has plain
 * Uint8Array/legacy-transaction-bytes methods — the exact wire format `@solana/web3.js`'s
 * classic `Transaction.serialize()` already produces. We call `inner` directly so the rest
 * of this suite can use the familiar `@solana/web3.js` Transaction/Keypair API instead of
 * pulling in the whole `@solana/kit` instruction-building pipeline.
 */
interface LiteSvmInternal {
  addProgramFromFile(programId: Uint8Array, filePath: string): void;
  airdrop(pubkey: Uint8Array, lamports: bigint): TransactionMetadata | FailedTransactionMetadata | null;
  sendLegacyTransaction(bytes: Uint8Array): TransactionMetadata | FailedTransactionMetadata;
  getAccount(pubkey: Uint8Array): { data(): Uint8Array } | null;
  getClock(): Clock;
  setClock(clock: Clock): void;
}

function nativeSvm(svm: LiteSVM): LiteSvmInternal {
  return (svm as unknown as { inner: LiteSvmInternal }).inner;
}

const PROGRAM_SO_PATH = path.resolve(__dirname, '../../../../target/deploy/atlas_mandate.so');

// Must match `declare_id!` in programs/atlas-mandate/src/lib.rs and Anchor.toml (kept in sync
// by `anchor keys sync`).
export const PROGRAM_ID = new PublicKey('CnGoTE5Bxc8MFGaeK5LDv5uAZ7pNiktMunYy8JZcLY4k');

export function freshSvm(programId: PublicKey): LiteSVM {
  const svm = new LiteSVM();
  nativeSvm(svm).addProgramFromFile(programId.toBytes(), PROGRAM_SO_PATH);
  // Fixed, deterministic clock so expiry/validity-window tests don't depend on wall-clock time.
  const clock = nativeSvm(svm).getClock();
  clock.unixTimestamp = 1_700_000_000n;
  nativeSvm(svm).setClock(clock);
  return svm;
}

export const FIXED_NOW = 1_700_000_000n;

export function airdrop(svm: LiteSVM, pubkey: PublicKey, lamports = 10_000_000_000n): void {
  nativeSvm(svm).airdrop(pubkey.toBytes(), lamports);
}

export function getRawAccountData(svm: LiteSVM, pubkey: PublicKey): Buffer | null {
  const account = nativeSvm(svm).getAccount(pubkey.toBytes());
  return account ? Buffer.from(account.data()) : null;
}

/** Signs and sends a legacy transaction; `signers[0]` is the fee payer. */
export function send(
  svm: LiteSVM,
  ixs: TransactionInstruction[],
  signers: Keypair[],
): TransactionMetadata | FailedTransactionMetadata {
  const tx = new Transaction();
  tx.recentBlockhash = svmBlockhash(svm);
  tx.feePayer = signers[0].publicKey;
  tx.add(...ixs);
  tx.sign(...signers);
  return nativeSvm(svm).sendLegacyTransaction(tx.serialize());
}

/**
 * Builds and sends a transaction, but only signs with `signingSubset` while every account in
 * `allRequiredSigners` is still declared as a signer on the instruction. Used to test that a
 * required signature (e.g. the approver's or the agent's) cannot be omitted. The missing
 * signer's 64-byte signature slot is left as all zeros, so `sigverify` rejects the transaction
 * before the program ever runs.
 */
export function sendWithMissingSignature(
  svm: LiteSVM,
  ixs: TransactionInstruction[],
  feePayer: Keypair,
  signingSubset: Keypair[],
): TransactionMetadata | FailedTransactionMetadata {
  const tx = new Transaction();
  tx.recentBlockhash = svmBlockhash(svm);
  tx.feePayer = feePayer.publicKey;
  tx.add(...ixs);
  tx.sign(...signingSubset);
  const raw = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return nativeSvm(svm).sendLegacyTransaction(raw);
}

function svmBlockhash(svm: LiteSVM): string {
  return svm.latestBlockhash();
}

export function isFailure(
  result: TransactionMetadata | FailedTransactionMetadata,
): result is FailedTransactionMetadata {
  return result instanceof FailedTransactionMetadata;
}

/** Joined program logs, or '' if the transaction failed before any logs were emitted. */
export function logsOf(result: TransactionMetadata | FailedTransactionMetadata): string {
  try {
    const logs = result instanceof FailedTransactionMetadata ? result.meta().logs() : result.logs();
    return logs.join('\n');
  } catch {
    return '';
  }
}

/** Anchor's instruction discriminator: first 8 bytes of sha256("global:<snake_case_name>"). */
function instructionDiscriminator(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

/** Anchor's account discriminator: first 8 bytes of sha256("account:<StructName>"). */
function accountDiscriminator(name: string): Buffer {
  return createHash('sha256').update(`account:${name}`).digest().subarray(0, 8);
}

export const MANDATE_SEED = Buffer.from('mandate');
export const ROOT_SEED = Buffer.from('root');

export function findMandatePda(programId: PublicKey, mandateHash: Uint8Array): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([MANDATE_SEED, Buffer.from(mandateHash)], programId);
}

export function findRootPda(programId: PublicKey, mandatePda: PublicKey, seq: bigint): [PublicKey, number] {
  const seqBytes = Buffer.alloc(8);
  seqBytes.writeBigUInt64LE(seq);
  return PublicKey.findProgramAddressSync([ROOT_SEED, mandatePda.toBuffer(), seqBytes], programId);
}

export interface CreateMandateArgs {
  mandateHash: Uint8Array;
  gateAuthority: PublicKey;
  mint: PublicKey;
  maxPerPayment: bigint;
  maxPerWindow: bigint;
  windowSeconds: bigint;
  maxTotal: bigint;
  escalationThreshold: bigint;
  notBefore: bigint;
  expiresAt: bigint;
}

// Mirrors `CreateMandateArgs`' field order and types in programs/atlas-mandate/src/lib.rs
// exactly: Anchor borsh-serializes instruction args in declaration order, prefixed by the
// 8-byte instruction discriminator (see `instructionDiscriminator`), which is NOT part of
// this schema.
const createMandateArgsSchema = {
  struct: {
    mandateHash: { array: { type: 'u8', len: 32 } },
    gateAuthority: { array: { type: 'u8', len: 32 } },
    mint: { array: { type: 'u8', len: 32 } },
    maxPerPayment: 'u64',
    maxPerWindow: 'u64',
    windowSeconds: 'i64',
    maxTotal: 'u64',
    escalationThreshold: 'u64',
    notBefore: 'i64',
    expiresAt: 'i64',
  },
} as const;

export function encodeCreateMandateArgs(args: CreateMandateArgs): Buffer {
  const body = borsh.serialize(createMandateArgsSchema as any, {
    mandateHash: args.mandateHash,
    gateAuthority: args.gateAuthority.toBytes(),
    mint: args.mint.toBytes(),
    maxPerPayment: args.maxPerPayment,
    maxPerWindow: args.maxPerWindow,
    windowSeconds: args.windowSeconds,
    maxTotal: args.maxTotal,
    escalationThreshold: args.escalationThreshold,
    notBefore: args.notBefore,
    expiresAt: args.expiresAt,
  });
  return Buffer.concat([instructionDiscriminator('create_mandate'), Buffer.from(body)]);
}

export function encodeRevokeMandateArgs(): Buffer {
  return instructionDiscriminator('revoke_mandate');
}

export interface AnchorRootArgs {
  seq: bigint;
  merkleRoot: Uint8Array;
  leafCount: number;
}

// Mirrors `AnchorRootArgs` field order/types in lib.rs.
const anchorRootArgsSchema = {
  struct: {
    seq: 'u64',
    merkleRoot: { array: { type: 'u8', len: 32 } },
    leafCount: 'u32',
  },
} as const;

export function encodeAnchorRootArgs(args: AnchorRootArgs): Buffer {
  const body = borsh.serialize(anchorRootArgsSchema as any, {
    seq: args.seq,
    merkleRoot: args.merkleRoot,
    leafCount: args.leafCount,
  });
  return Buffer.concat([instructionDiscriminator('anchor_root'), Buffer.from(body)]);
}

// Mirrors the `Mandate` account struct field order/types in lib.rs, prefixed by its 8-byte
// account discriminator (sha256("account:Mandate")[0..8]).
const mandateAccountSchema = {
  struct: {
    mandateHash: { array: { type: 'u8', len: 32 } },
    owner: { array: { type: 'u8', len: 32 } },
    approver: { array: { type: 'u8', len: 32 } },
    agent: { array: { type: 'u8', len: 32 } },
    gateAuthority: { array: { type: 'u8', len: 32 } },
    mint: { array: { type: 'u8', len: 32 } },
    maxPerPayment: 'u64',
    maxPerWindow: 'u64',
    windowSeconds: 'i64',
    maxTotal: 'u64',
    escalationThreshold: 'u64',
    notBefore: 'i64',
    expiresAt: 'i64',
    createdAt: 'i64',
    revoked: 'bool',
    revokedAt: 'i64',
    revokedBy: { array: { type: 'u8', len: 32 } },
    nextRootSeq: 'u64',
    bump: 'u8',
  },
} as const;

export interface MandateAccount {
  mandateHash: Uint8Array;
  owner: PublicKey;
  approver: PublicKey;
  agent: PublicKey;
  gateAuthority: PublicKey;
  mint: PublicKey;
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
  revokedBy: PublicKey;
  nextRootSeq: bigint;
  bump: number;
}

export function decodeMandateAccount(data: Buffer): MandateAccount {
  const expectedDisc = accountDiscriminator('Mandate');
  if (!data.subarray(0, 8).equals(expectedDisc)) {
    throw new Error('account discriminator mismatch: not a Mandate account');
  }
  const raw: any = borsh.deserialize(mandateAccountSchema as any, data.subarray(8));
  return {
    mandateHash: raw.mandateHash,
    owner: new PublicKey(raw.owner),
    approver: new PublicKey(raw.approver),
    agent: new PublicKey(raw.agent),
    gateAuthority: new PublicKey(raw.gateAuthority),
    mint: new PublicKey(raw.mint),
    maxPerPayment: raw.maxPerPayment,
    maxPerWindow: raw.maxPerWindow,
    windowSeconds: raw.windowSeconds,
    maxTotal: raw.maxTotal,
    escalationThreshold: raw.escalationThreshold,
    notBefore: raw.notBefore,
    expiresAt: raw.expiresAt,
    createdAt: raw.createdAt,
    revoked: raw.revoked,
    revokedAt: raw.revokedAt,
    revokedBy: new PublicKey(raw.revokedBy),
    nextRootSeq: raw.nextRootSeq,
    bump: raw.bump,
  };
}

// Mirrors the `Root` account struct field order/types in lib.rs.
const rootAccountSchema = {
  struct: {
    mandate: { array: { type: 'u8', len: 32 } },
    seq: 'u64',
    merkleRoot: { array: { type: 'u8', len: 32 } },
    leafCount: 'u32',
    anchoredAt: 'i64',
    bump: 'u8',
  },
} as const;

export interface RootAccount {
  mandate: PublicKey;
  seq: bigint;
  merkleRoot: Uint8Array;
  leafCount: number;
  anchoredAt: bigint;
  bump: number;
}

export function decodeRootAccount(data: Buffer): RootAccount {
  const expectedDisc = accountDiscriminator('Root');
  if (!data.subarray(0, 8).equals(expectedDisc)) {
    throw new Error('account discriminator mismatch: not a Root account');
  }
  const raw: any = borsh.deserialize(rootAccountSchema as any, data.subarray(8));
  return {
    mandate: new PublicKey(raw.mandate),
    seq: raw.seq,
    merkleRoot: raw.merkleRoot,
    leafCount: raw.leafCount,
    anchoredAt: raw.anchoredAt,
    bump: raw.bump,
  };
}

export interface MandateParties {
  owner: Keypair;
  approver: Keypair;
  agent: Keypair;
}

export function freshParties(): MandateParties {
  return { owner: Keypair.generate(), approver: Keypair.generate(), agent: Keypair.generate() };
}

let mandateHashCounter = 0;
/** A fresh 32-byte "mandate hash" per test, so PDAs never collide across test cases. */
export function freshMandateHash(): Uint8Array {
  mandateHashCounter += 1;
  return createHash('sha256').update(`test-mandate-${mandateHashCounter}`).digest();
}

export function defaultArgs(overrides: Partial<CreateMandateArgs> = {}): CreateMandateArgs {
  return {
    mandateHash: freshMandateHash(),
    gateAuthority: Keypair.generate().publicKey,
    mint: Keypair.generate().publicKey,
    maxPerPayment: 50_000_000n,
    maxPerWindow: 100_000_000n,
    windowSeconds: 86_400n,
    maxTotal: 500_000_000n,
    escalationThreshold: 25_000_000n,
    notBefore: FIXED_NOW - 1_000n,
    expiresAt: FIXED_NOW + 1_000_000n,
    ...overrides,
  };
}

export function buildCreateMandateIx(
  programId: PublicKey,
  parties: MandateParties,
  args: CreateMandateArgs,
): { ix: TransactionInstruction; mandatePda: PublicKey } {
  const [mandatePda] = findMandatePda(programId, args.mandateHash);
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: mandatePda, isSigner: false, isWritable: true },
      { pubkey: parties.owner.publicKey, isSigner: true, isWritable: true },
      { pubkey: parties.approver.publicKey, isSigner: true, isWritable: false },
      { pubkey: parties.agent.publicKey, isSigner: true, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: encodeCreateMandateArgs(args),
  });
  return { ix, mandatePda };
}

export function buildRevokeMandateIx(
  programId: PublicKey,
  mandatePda: PublicKey,
  authority: PublicKey,
): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: mandatePda, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data: encodeRevokeMandateArgs(),
  });
}

export function buildAnchorRootIx(
  programId: PublicKey,
  mandatePda: PublicKey,
  gateAuthority: PublicKey,
  args: AnchorRootArgs,
): { ix: TransactionInstruction; rootPda: PublicKey } {
  const [rootPda] = findRootPda(programId, mandatePda, args.seq);
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: mandatePda, isSigner: false, isWritable: true },
      { pubkey: rootPda, isSigner: false, isWritable: true },
      { pubkey: gateAuthority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: encodeAnchorRootArgs(args),
  });
  return { ix, rootPda };
}

/** Anchor's custom program errors are numbered from 6000 in `#[error_code]` declaration order. */
export const MandateErrorCode = {
  ApproverIsOwner: 6000,
  AgentNotIndependent: 6001,
  ZeroLimit: 6002,
  PerPaymentAboveTotal: 6003,
  WindowAboveTotal: 6004,
  InvalidWindow: 6005,
  InvalidValidity: 6006,
  AlreadyExpired: 6007,
  NotAuthorizedToRevoke: 6008,
  AlreadyRevoked: 6009,
  UnauthorizedAnchor: 6010,
  OutOfOrderSeq: 6011,
  EmptyBatch: 6012,
} as const;
