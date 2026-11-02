import type { Connection, Transaction } from '@solana/web3.js';

export interface FundWallet {
  publicKey: string;
  signTransaction(transaction: Transaction): Promise<Transaction>;
}

export interface FundingPreview {
  treasury: string;
  payerAta: string;
  payeeAta: string;
  treasuryAta: string;
  mintOwner: string | null;
  mintDecimals: number | null;
  tokenMint: string | null;
  tokenOwner: string | null;
  tokenBalance: string | null;
  payeeAtaExists: boolean;
  treasuryAtaExists: boolean;
}

export function fundingPreview(connection: Connection, options: { mint: string; payer: string; recipient: string }): Promise<FundingPreview>;

export function quoteAtaFunding(connection: Connection, options: {
  payer: string;
  mint: string;
  payee: string;
  payeeAta: string;
  treasuryOwner: string;
  treasuryAta: string;
  createPayee: boolean;
  createTreasury: boolean;
}): Promise<{
  required: boolean;
  computeUnitLimit?: number;
  priorityPriceMicroLamports?: number;
  maxPriorityFeeLamports?: number;
  baseFeeLamports?: number;
  ataRentLamports?: number | null;
  feeCapLamports?: number;
  feeLamports?: number | null;
  unitsConsumed?: number | null;
}>;

export function priorityFeeLamports(units: number, microLamports: number): number;
export function ataComputeUnitLimit(ataCount: number): number;
export function ataTransactionFeeLamports(ataCount: number): number;

export const ATA_PRIORITY_PRICE_MICROLAMPORTS: number;
export const ATA_FEE_CAP_LAMPORTS: number;
export const SIGNATURE_FEE_LAMPORTS: number;
export const SIMULATED_ATA_CREATE_UNITS: number;
export const SIMULATED_BUDGET_UNITS: number;

export function openComputeUnitLimit(): number;
export function openTransactionFeeLamports(): number;

export const OPEN_FEE_CAP_LAMPORTS: number;
export const SIMULATED_OPEN_UNITS: number;

export interface ChannelOpenPlan {
  transaction: Transaction;
  channel: string;
  channelAta: string;
  eventAuthority: string;
  deposit: string;
  mint: string;
  payer: string;
  payee: string;
  agent: string;
  programId: string;
  computeUnitLimit: number;
  priorityPriceMicroLamports: number;
  maxPriorityFeeLamports: number;
  baseFeeLamports: number;
  channelRentLamports: number;
  tokenRentLamports: number;
  feeLamports: number;
  feeCapLamports: number;
  unitsConsumed: number;
}

export function prepareChannelOpen(session: Record<string, unknown>): Promise<ChannelOpenPlan>;
export function submitPreparedOpen(session: Record<string, unknown>, prepared: ChannelOpenPlan): Promise<{ channel: string; deposit: string; openSignature: string; ataSignature?: string }>;
export function fundAccounts(session: Record<string, unknown>, mint: string, wallet: FundWallet): Promise<{ ataSignature?: string }>;

export function fundChannel(
  session: Record<string, unknown>,
  mint: string,
  wallet?: FundWallet,
): Promise<{ channel: string; deposit: string; openSignature: string; ataSignature?: string }>;
