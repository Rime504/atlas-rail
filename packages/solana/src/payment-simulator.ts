import { ChainClient } from './chain';
import { analyzeExactPaymentTransaction } from './x402-payment';

/** Structurally identical to `GateSimulation` in `@atlas-rail/mandate` (kept local so this package stays independent of it). */
export interface PaymentSimulationSummary {
  success: boolean;
  error: string | null;
  programIds: string[];
  unknownProgramIds: string[];
  transferCount: number;
  matchesOffer: boolean;
  mismatch: string | null;
  txMessageHash: string;
  unitsConsumed: number | null;
}

export interface PaymentSimulationInput {
  transactionBase64: string;
  offer: { payTo: string; asset: string; amount: string; feePayer: string | null };
  payer: string;
}

const ZERO_HASH = '0'.repeat(64);

/**
 * Pre-flight check of the exact transaction an agent intends to sign: strict static analysis (does it
 * pay exactly the offer, and nothing else?) plus a cluster simulation (would it succeed?). Used by
 * the mandate gate through its `PaymentSimulator` port.
 */
export class ChainPaymentSimulator {
  constructor(private readonly chain: ChainClient) {}

  async simulate(input: PaymentSimulationInput): Promise<PaymentSimulationSummary> {
    let analysis;
    try {
      analysis = analyzeExactPaymentTransaction(input.transactionBase64, {
        payer: input.payer,
        payTo: input.offer.payTo,
        mint: input.offer.asset,
        amountBaseUnits: input.offer.amount,
        feePayer: input.offer.feePayer,
      });
    } catch {
      return {
        success: false,
        error: 'transaction could not be decoded',
        programIds: [],
        unknownProgramIds: [],
        transferCount: 0,
        matchesOffer: false,
        mismatch: 'transaction could not be decoded',
        txMessageHash: ZERO_HASH,
        unitsConsumed: null,
      };
    }

    let success = false;
    let error: string | null = null;
    let unitsConsumed: number | null = null;
    try {
      const simulation = await this.chain.simulate(input.transactionBase64);
      success = simulation.success;
      error = simulation.error;
      unitsConsumed = simulation.unitsConsumed;
    } catch (cause) {
      error = `simulation could not be completed: ${cause instanceof Error ? cause.message : String(cause)}`;
    }

    return {
      success,
      error,
      programIds: analysis.programIds,
      unknownProgramIds: analysis.unknownProgramIds,
      transferCount: analysis.transferCount,
      matchesOffer: analysis.matchesOffer,
      mismatch: analysis.mismatch,
      txMessageHash: analysis.txMessageHash,
      unitsConsumed,
    };
  }
}
