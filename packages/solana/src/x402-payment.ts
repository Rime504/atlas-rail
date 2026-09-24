import { createHash } from 'crypto';
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { ALLOWED_SOLANA_PROGRAM_IDS } from '@atlas-rail/config';

/**
 * The x402 "exact" scheme on Solana, as implemented by the reference `@x402/svm` package:
 * a partially-signed v0 transaction with the layout
 *
 *   [ SetComputeUnitLimit, SetComputeUnitPrice, TransferChecked, Memo ]
 *
 * fee-paid by the facilitator (`extra.feePayer`), signed by the payer, carrying either the seller's
 * `extra.memo` or a random 16-byte hex nonce. Builder and analyzer live side by side so the layout
 * the client produces is exactly the layout the gate verifies.
 */

export const X402_DEFAULT_COMPUTE_UNIT_LIMIT = 20_000;
export const X402_DEFAULT_COMPUTE_UNIT_PRICE_MICROLAMPORTS = 1;
export const X402_MAX_COMPUTE_UNIT_LIMIT = 400_000;
export const X402_MAX_COMPUTE_UNIT_PRICE_MICROLAMPORTS = 5_000_000;

const COMPUTE_BUDGET_ID = ALLOWED_SOLANA_PROGRAM_IDS.COMPUTE_BUDGET_PROGRAM;
const MEMO_ID = ALLOWED_SOLANA_PROGRAM_IDS.MEMO_PROGRAM;
const TOKEN_ID = ALLOWED_SOLANA_PROGRAM_IDS.TOKEN_PROGRAM;

export interface BuildExactPaymentParams {
  payer: string;
  feePayer: string;
  mint: string;
  decimals: number;
  payTo: string;
  amountBaseUnits: string;
  recentBlockhash: string;
  /** Seller-provided memo (`extra.memo`); a random nonce is generated when absent. */
  memo?: string | null;
}

function randomNonceHex(): string {
  return createHash('sha256').update(globalThis.crypto.getRandomValues(new Uint8Array(32))).digest('hex').slice(0, 32);
}

/** Builds the unsigned (fee-payer and payer slots empty) v0 payment transaction. */
export function buildExactPaymentTransaction(params: BuildExactPaymentParams): VersionedTransaction {
  const payer = new PublicKey(params.payer);
  const feePayer = new PublicKey(params.feePayer);
  const mint = new PublicKey(params.mint);
  const payTo = new PublicKey(params.payTo);

  const source = getAssociatedTokenAddressSync(mint, payer, false, TOKEN_PROGRAM_ID);
  const destination = getAssociatedTokenAddressSync(mint, payTo, false, TOKEN_PROGRAM_ID);

  const memoText = params.memo && params.memo.length > 0 ? params.memo : randomNonceHex();
  const memoData = Buffer.from(memoText, 'utf8');
  if (memoData.byteLength > 256) throw new Error('memo exceeds the 256 byte limit');

  const instructions: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: X402_DEFAULT_COMPUTE_UNIT_LIMIT }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: X402_DEFAULT_COMPUTE_UNIT_PRICE_MICROLAMPORTS }),
    createTransferCheckedInstruction(
      source,
      mint,
      destination,
      payer,
      BigInt(params.amountBaseUnits),
      params.decimals,
      [],
      TOKEN_PROGRAM_ID,
    ),
    new TransactionInstruction({ keys: [], programId: new PublicKey(MEMO_ID), data: memoData }),
  ];

  const message = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: params.recentBlockhash,
    instructions,
  }).compileToV0Message();
  return new VersionedTransaction(message);
}

export function transactionMessageHash(tx: VersionedTransaction): string {
  return createHash('sha256').update(tx.message.serialize()).digest('hex');
}

export function decodeTransaction(transactionBase64: string): VersionedTransaction {
  return VersionedTransaction.deserialize(Buffer.from(transactionBase64, 'base64'));
}

export interface ExpectedPayment {
  payer: string;
  payTo: string;
  mint: string;
  amountBaseUnits: string;
  /** When provided, the transaction's fee payer must be this address. */
  feePayer?: string | null;
}

export interface PaymentTransactionAnalysis {
  programIds: string[];
  unknownProgramIds: string[];
  transferCount: number;
  matchesOffer: boolean;
  mismatch: string | null;
  txMessageHash: string;
  feePayer: string;
}

/** SPL Token `TransferChecked` instruction data: [12, amount u64 LE, decimals u8]. */
function parseTransferChecked(data: Uint8Array): { amount: bigint; decimals: number } | null {
  if (data.length !== 10 || data[0] !== 12) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { amount: view.getBigUint64(1, true), decimals: data[9] };
}

/**
 * Strictly analyzes a payment transaction against what the mandate gate was asked about. The layout
 * must be exactly compute-budget limit/price, ONE token TransferChecked, and optionally one memo:
 * no System transfers, no account closures, no extra signers, no address lookup tables (they can
 * hide accounts), and the fee payer must not appear in any instruction. Anything else is reported
 * in `mismatch` and makes `matchesOffer` false.
 */
export function analyzeExactPaymentTransaction(
  transactionBase64: string,
  expected: ExpectedPayment,
): PaymentTransactionAnalysis {
  const tx = decodeTransaction(transactionBase64);
  const message = tx.message;
  const keys = message.staticAccountKeys;
  const feePayer = keys[0].toBase58();
  const problems: string[] = [];

  if (message.addressTableLookups.length > 0) problems.push('transaction uses address lookup tables');
  if (message.header.numRequiredSignatures > 2) problems.push('transaction requires more than payer and fee-payer signatures');
  if (expected.feePayer && expected.feePayer !== feePayer) problems.push(`fee payer is ${feePayer}, expected ${expected.feePayer}`);

  const allowed = new Set<string>(Object.values(ALLOWED_SOLANA_PROGRAM_IDS));
  const programIds: string[] = [];
  const unknownProgramIds: string[] = [];
  let transferCount = 0;
  let transferMatches = false;
  let memoCount = 0;

  const expectedDestination = getAssociatedTokenAddressSync(
    new PublicKey(expected.mint),
    new PublicKey(expected.payTo),
    false,
    TOKEN_PROGRAM_ID,
  ).toBase58();
  const expectedSource = getAssociatedTokenAddressSync(
    new PublicKey(expected.mint),
    new PublicKey(expected.payer),
    false,
    TOKEN_PROGRAM_ID,
  ).toBase58();

  for (const ix of message.compiledInstructions) {
    const programId = keys[ix.programIdIndex].toBase58();
    if (!programIds.includes(programId)) programIds.push(programId);
    if (!allowed.has(programId) && !unknownProgramIds.includes(programId)) unknownProgramIds.push(programId);

    const accountAddresses = ix.accountKeyIndexes.map((i) => keys[i].toBase58());
    if (accountAddresses.includes(feePayer)) problems.push('fee payer appears in an instruction account list');

    if (programId === COMPUTE_BUDGET_ID) {
      const data = ix.data;
      if (data[0] === 2 && data.length === 5) {
        const units = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(1, true);
        if (units > X402_MAX_COMPUTE_UNIT_LIMIT) problems.push(`compute unit limit ${units} is above ${X402_MAX_COMPUTE_UNIT_LIMIT}`);
      } else if (data[0] === 3 && data.length === 9) {
        const price = new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(1, true);
        if (price > BigInt(X402_MAX_COMPUTE_UNIT_PRICE_MICROLAMPORTS)) problems.push(`compute unit price ${price} is too high`);
      } else {
        problems.push('unsupported compute-budget instruction');
      }
    } else if (programId === TOKEN_ID) {
      const parsed = parseTransferChecked(ix.data);
      if (!parsed) {
        problems.push('token program instruction is not TransferChecked');
        continue;
      }
      transferCount += 1;
      const [source, mint, destination, authority] = accountAddresses;
      const reasons: string[] = [];
      if (mint !== expected.mint) reasons.push(`mint ${mint} is not ${expected.mint}`);
      if (destination !== expectedDestination) reasons.push('destination is not the payTo associated token account');
      if (source !== expectedSource) reasons.push('source is not the payer associated token account');
      if (authority !== expected.payer) reasons.push('transfer authority is not the payer');
      if (parsed.amount.toString() !== expected.amountBaseUnits) reasons.push(`amount ${parsed.amount} is not ${expected.amountBaseUnits}`);
      if (reasons.length === 0) transferMatches = true;
      else problems.push(reasons.join('; '));
    } else if (programId === MEMO_ID) {
      memoCount += 1;
      if (memoCount > 1) problems.push('more than one memo instruction');
    } else {
      problems.push(`unexpected instruction for program ${programId}`);
    }
  }

  if (transferCount === 1 && !transferMatches && problems.length === 0) problems.push('transfer does not match the offer');
  const matchesOffer = problems.length === 0 && transferCount === 1 && transferMatches;

  return {
    programIds,
    unknownProgramIds,
    transferCount,
    matchesOffer,
    mismatch: matchesOffer ? null : problems.join('; ') || 'transaction does not contain exactly one matching transfer',
    txMessageHash: transactionMessageHash(tx),
    feePayer,
  };
}

export interface PreflightSimulation {
  success: boolean;
  error: string | null;
  logs: string[];
  unitsConsumed: number | null;
}

/**
 * Simulates a partially-signed payment transaction. Signature verification is off (the fee payer
 * has not signed yet) and the blockhash is replaced, so this checks the *effects* of the payment:
 * balances, token accounts, program errors.
 */
export async function simulatePaymentTransaction(
  connection: Connection,
  transactionBase64: string,
): Promise<PreflightSimulation> {
  const tx = decodeTransaction(transactionBase64);
  const { value } = await connection.simulateTransaction(tx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: 'confirmed',
  });
  return {
    success: value.err === null,
    error: value.err === null ? null : JSON.stringify(value.err),
    logs: value.logs ?? [],
    unitsConsumed: value.unitsConsumed ?? null,
  };
}
