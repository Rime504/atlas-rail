export interface SimulationResultOutput {
  success: boolean;
  error?: string | null;
  logs: string[];
  unitsConsumed?: number | null;
  programIds: string[];
  unknownProgramIds: string[];
  warnings: string[];
}

export interface BuildPayoutTxParams {
  senderWallet: string;
  recipientWallet: string;
  mintAddress: string;
  amountBaseUnits: string;
  decimals?: number;
  memo?: string | null;
  recentBlockhash: string;
}

export interface SignerAdapter {
  name: string;
  signTransaction(transactionBase64: string): Promise<{ signedBase64: string; signature: string }>;
}
