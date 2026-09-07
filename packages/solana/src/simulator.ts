import { Transaction } from '@solana/web3.js';
import { ALLOWED_SOLANA_PROGRAM_IDS } from '@atlas-rail/config';
import { SimulationResultOutput } from './types';

export class DevnetTransactionSimulator {
  public static analyzeTransactionBase64(
    transactionBase64: string,
    simulatedRpcResult?: { err?: unknown; logs?: string[]; unitsConsumed?: number },
  ): SimulationResultOutput {
    const txBuffer = Buffer.from(transactionBase64, 'base64');
    const tx = Transaction.from(txBuffer);

    const programIds: string[] = [];
    const unknownProgramIds: string[] = [];
    const warnings: string[] = [];

    const allowedSet = new Set<string>(Object.values(ALLOWED_SOLANA_PROGRAM_IDS));

    for (const ix of tx.instructions) {
      const pid = ix.programId.toBase58();
      if (!programIds.includes(pid)) {
        programIds.push(pid);
      }
      if (!allowedSet.has(pid)) {
        unknownProgramIds.push(pid);
        warnings.push(`Unrecognized Program ID in transaction instruction: ${pid}`);
      }
    }

    const success = !simulatedRpcResult?.err;
    const logs = simulatedRpcResult?.logs || [];
    const unitsConsumed = simulatedRpcResult?.unitsConsumed || null;
    const errorStr = simulatedRpcResult?.err ? JSON.stringify(simulatedRpcResult.err) : null;

    return {
      success,
      error: errorStr,
      logs,
      unitsConsumed,
      programIds,
      unknownProgramIds,
      warnings,
    };
  }
}
