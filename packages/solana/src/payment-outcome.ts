import { decodeTransaction, transactionMessageHash } from './x402-payment';

/** The chain reads needed to find out what became of one exact transaction. */
export interface PaymentHistory {
  /** Signatures of recent transactions that involve `address`, newest first. */
  signaturesForAddress(address: string, limit: number): Promise<Array<{ signature: string; blockTime: number | null }>>;
  /** sha256 of the transaction's serialized message and its execution error, or null if not found. */
  getTransactionMessage(signature: string): Promise<{ messageHash: string; err: unknown | null } | null>;
  /** Whether a transaction using `blockhash` could still land (checked at finalized commitment). */
  isBlockhashValid(blockhash: string): Promise<boolean>;
}

/**
 * What became of the exact transaction a gate authorisation covers.
 * - LANDED: it executed; the tokens moved.
 * - FAILED: it landed with an error; no tokens moved.
 * - PENDING: it could still land, or the lookup could not be completed. Keep the budget held.
 * - EXPIRED: its blockhash can no longer land anything and it is not on-chain. No tokens moved.
 * - MISMATCH: the transaction presented is not the one the authorisation covers.
 */
export type PaymentOutcome =
  | { status: 'LANDED'; txSignature: string }
  | { status: 'FAILED'; txSignature: string }
  | { status: 'PENDING' }
  | { status: 'EXPIRED' }
  | { status: 'MISMATCH' };

export interface PaymentOutcomeInput {
  /** The authorised transaction, signed or not; only its message is used. */
  transactionBase64: string;
  /** The message hash the gate authorised. */
  expectedMessageHash: string;
  /** The agent wallet, a signer of the transaction. */
  payer: string;
  /** Epoch seconds when the authorisation was issued; older history is not scanned. */
  notBefore: number;
}

/** How many of the payer's recent transactions are scanned before giving up with PENDING. */
const SCAN_LIMIT = 100;
/** Slack for block-time vs. gate-clock skew when deciding history is older than the authorisation. */
const CLOCK_SLACK_SECONDS = 120;

/**
 * Finds the authorised transaction on-chain by its message hash (the transaction id is the fee
 * payer's signature, which the agent may never have seen). "Not found" only counts once the
 * blockhash is invalid at finalized commitment, and the history is scanned again after that check:
 * any block that could have included the transaction is then finalized and visible.
 */
export async function findPaymentOutcome(history: PaymentHistory, input: PaymentOutcomeInput): Promise<PaymentOutcome> {
  let tx;
  try {
    tx = decodeTransaction(input.transactionBase64);
  } catch {
    return { status: 'MISMATCH' };
  }
  if (transactionMessageHash(tx) !== input.expectedMessageHash) return { status: 'MISMATCH' };

  const scan = async (): Promise<PaymentOutcome | 'NOT_FOUND' | 'INCOMPLETE'> => {
    const recent = await history.signaturesForAddress(input.payer, SCAN_LIMIT);
    for (const { signature, blockTime } of recent) {
      if (blockTime !== null && blockTime < input.notBefore - CLOCK_SLACK_SECONDS) return 'NOT_FOUND';
      const found = await history.getTransactionMessage(signature);
      if (found?.messageHash === input.expectedMessageHash) {
        return found.err === null ? { status: 'LANDED', txSignature: signature } : { status: 'FAILED', txSignature: signature };
      }
    }
    return recent.length >= SCAN_LIMIT ? 'INCOMPLETE' : 'NOT_FOUND';
  };

  const first = await scan();
  if (typeof first === 'object') return first;
  if (first === 'INCOMPLETE') return { status: 'PENDING' };
  if (await history.isBlockhashValid(tx.message.recentBlockhash)) return { status: 'PENDING' };
  const second = await scan();
  if (typeof second === 'object') return second;
  return second === 'INCOMPLETE' ? { status: 'PENDING' } : { status: 'EXPIRED' };
}

/** The gate's `PaymentOutcomeLookup` port, backed by the chain. */
export class ChainPaymentOutcomeLookup {
  constructor(private readonly history: PaymentHistory) {}

  lookup(input: PaymentOutcomeInput): Promise<PaymentOutcome> {
    return findPaymentOutcome(this.history, input);
  }
}
