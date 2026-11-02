import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import {
  DEFAULT_MANDATE_PROGRAM_ID,
  buildAnchorRootTransaction,
  buildCreateMandateTransaction,
  buildRevokeMandateTransaction,
  findMandatePda,
  type CreateMandateOnChainArgs,
} from '@atlas-rail/solana';
import { loadMandate, type LoadMandateResult } from './mandate-onchain';

export interface PreparedMandateInstruction {
  programId: string;
  mandatePda: string;
  transactionBase64: string;
  broadcast: false;
}

export function prepareCreateMandateInstruction(input: CreateMandateOnChainArgs & {
  programId?: string;
  owner: string;
  approver: string;
  agent: string;
  recentBlockhash: string;
}): PreparedMandateInstruction {
  const programId = input.programId ?? DEFAULT_MANDATE_PROGRAM_ID;
  const { address: mandatePda } = findMandatePda(programId, input.mandateHash);
  return {
    programId,
    mandatePda,
    transactionBase64: buildCreateMandateTransaction({ ...input, programId }),
    broadcast: false,
  };
}

export function prepareRevokeMandateInstruction(input: {
  programId?: string;
  mandatePda: string;
  authority: string;
  recentBlockhash: string;
}): PreparedMandateInstruction {
  const programId = input.programId ?? DEFAULT_MANDATE_PROGRAM_ID;
  return {
    programId,
    mandatePda: input.mandatePda,
    transactionBase64: buildRevokeMandateTransaction({ ...input, programId }),
    broadcast: false,
  };
}

export function prepareAnchorRootInstruction(input: {
  programId?: string;
  mandatePda: string;
  gateAuthority: string;
  seq: bigint;
  merkleRoot: Uint8Array;
  leafCount: number;
  batchHeader: Uint8Array;
  batchFileHash: Uint8Array;
  recentBlockhash: string;
}): PreparedMandateInstruction {
  const programId = input.programId ?? DEFAULT_MANDATE_PROGRAM_ID;
  return {
    programId,
    mandatePda: input.mandatePda,
    transactionBase64: buildAnchorRootTransaction({ ...input, programId }),
    broadcast: false,
  };
}

export function signMandateTransaction(transactionBase64: string, signers: Keypair[]): string {
  const tx = VersionedTransaction.deserialize(Buffer.from(transactionBase64, 'base64'));
  tx.sign(signers);
  return Buffer.from(tx.serialize()).toString('base64');
}

/** Sends an already-signed versioned transaction. Callers must opt in. */
export async function sendMandateTransaction(connection: Connection, signedBase64: string): Promise<string> {
  const raw = Buffer.from(signedBase64, 'base64');
  const signature = await connection.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: 'confirmed' });
  const confirmation = await connection.confirmTransaction(signature, 'confirmed');
  if (confirmation.value.err) {
    throw new Error(`Mandate transaction failed: ${JSON.stringify(confirmation.value.err)}`);
  }
  return signature;
}

/** The agent key behind the signer service. It co-signs `create_mandate` and never leaves that process. */
export interface MandateAgentSigner {
  publicKey: string;
  /** Returns the transaction with the agent signature added. */
  signCreateMandate(transactionBase64: string): Promise<string>;
}

export interface CreateMandateCall {
  owner: Keypair;
  approver: Keypair;
  /** A `Keypair` only in tests. Use `signerAgent()` so the agent key stays in the signer service. */
  agent: Keypair | MandateAgentSigner;
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
  /** Broadcasts only when true. Default prepares a signed transaction and stops. */
  submit?: boolean;
}

export interface RevokeMandateCall {
  mandatePda: string;
  authority: Keypair;
  submit?: boolean;
  /**
   * When set with `submit: true`, the payer wallet also closes this channel.
   * Pass `payee` to seal immediately. Without it, the payer starts the grace wait.
   */
  channel?: string;
  /** Channel payee. Signs settle_and_seal so an already-signed voucher cannot be settled during grace. */
  payee?: Keypair;
}

export interface AnchorRootCall {
  mandatePda: string;
  gate: Keypair;
  merkleRoot: Uint8Array;
  leafCount: number;
  batchHeader: Uint8Array;
  batchFileHash: Uint8Array;
  submit?: boolean;
}

export type MandateInstructionResult =
  | { status: 'prepared'; mandatePda: string; transactionBase64: string; broadcast: false }
  | {
      status: 'confirmed';
      mandatePda: string;
      signature: string;
      broadcast: true;
      account: LoadMandateResult;
      /** Present when revoke also started the payer close. Regular settle is then rejected. */
      requestCloseSignature?: string;
      settleBlocked?: boolean;
      /** Set when the channel could not be closed. The mandate revoke still stands. */
      closeError?: string;
    };

async function blockhash(connection: Connection): Promise<string> {
  const latest = await connection.getLatestBlockhash('confirmed');
  return latest.blockhash;
}

export async function runCreateMandate(
  connection: Connection,
  input: CreateMandateCall,
  programId?: string,
): Promise<MandateInstructionResult> {
  const prepared = prepareCreateMandateInstruction({
    programId,
    owner: input.owner.publicKey.toBase58(),
    approver: input.approver.publicKey.toBase58(),
    agent: input.agent instanceof Keypair ? input.agent.publicKey.toBase58() : input.agent.publicKey,
    recentBlockhash: await blockhash(connection),
    mandateHash: input.mandateHash,
    gateAuthority: input.gateAuthority,
    mint: input.mint,
    maxPerPayment: input.maxPerPayment,
    maxPerWindow: input.maxPerWindow,
    windowSeconds: input.windowSeconds,
    maxTotal: input.maxTotal,
    escalationThreshold: input.escalationThreshold,
    notBefore: input.notBefore,
    expiresAt: input.expiresAt,
  });
  const signed = input.agent instanceof Keypair
    ? signMandateTransaction(prepared.transactionBase64, [input.owner, input.approver, input.agent])
    : await input.agent.signCreateMandate(signMandateTransaction(prepared.transactionBase64, [input.owner, input.approver]));
  if (!input.submit) {
    return { status: 'prepared', mandatePda: prepared.mandatePda, transactionBase64: signed, broadcast: false };
  }
  const signature = await sendMandateTransaction(connection, signed);
  const account = await loadMandate(connection, prepared.mandatePda, { programId: prepared.programId });
  return { status: 'confirmed', mandatePda: prepared.mandatePda, signature, broadcast: true, account };
}

export async function runRevokeMandate(
  connection: Connection,
  input: RevokeMandateCall,
  programId?: string,
): Promise<MandateInstructionResult> {
  const prepared = prepareRevokeMandateInstruction({
    programId,
    mandatePda: input.mandatePda,
    authority: input.authority.publicKey.toBase58(),
    recentBlockhash: await blockhash(connection),
  });
  const signed = signMandateTransaction(prepared.transactionBase64, [input.authority]);
  if (!input.submit) {
    return { status: 'prepared', mandatePda: prepared.mandatePda, transactionBase64: signed, broadcast: false };
  }
  const signature = await sendMandateTransaction(connection, signed);
  const account = await loadMandate(connection, prepared.mandatePda, { programId: prepared.programId });
  return { status: 'confirmed', mandatePda: prepared.mandatePda, signature, broadcast: true, account };
}

export async function runAnchorRoot(
  connection: Connection,
  input: AnchorRootCall,
  programId?: string,
): Promise<MandateInstructionResult> {
  const id = programId ?? DEFAULT_MANDATE_PROGRAM_ID;
  const existing = await loadMandate(connection, input.mandatePda, { programId: id });
  if (existing.account.gateAuthority !== input.gate.publicKey.toBase58()) {
    throw new Error('Gate key is not the on-chain gate authority');
  }
  const prepared = prepareAnchorRootInstruction({
    programId: id,
    mandatePda: input.mandatePda,
    gateAuthority: input.gate.publicKey.toBase58(),
    seq: existing.account.nextRootSeq,
    merkleRoot: input.merkleRoot,
    leafCount: input.leafCount,
    batchHeader: input.batchHeader,
    batchFileHash: input.batchFileHash,
    recentBlockhash: await blockhash(connection),
  });
  const signed = signMandateTransaction(prepared.transactionBase64, [input.gate]);
  if (!input.submit) {
    return { status: 'prepared', mandatePda: prepared.mandatePda, transactionBase64: signed, broadcast: false };
  }
  const signature = await sendMandateTransaction(connection, signed);
  const account = await loadMandate(connection, prepared.mandatePda, { programId: id });
  return { status: 'confirmed', mandatePda: prepared.mandatePda, signature, broadcast: true, account };
}
