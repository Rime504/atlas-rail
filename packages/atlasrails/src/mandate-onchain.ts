import type { Connection } from '@solana/web3.js';
import {
  DEFAULT_MANDATE_PROGRAM_ID,
  buildAnchorRootTransaction,
  buildCreateMandateTransaction,
  buildRevokeMandateTransaction,
  exportMandateAccountJson,
  findMandatePda,
  isMandateAccountActive,
  loadMandateAccount,
  type MandateAccountOnChain,
  type OnChainMandateExport,
} from '@atlas-rail/solana';
import { RECOVERY_CHANNEL } from './sdk-evidence';

export {
  DEFAULT_MANDATE_PROGRAM_ID,
  buildAnchorRootTransaction,
  buildCreateMandateTransaction,
  buildRevokeMandateTransaction,
  exportMandateAccountJson,
  findMandatePda,
  isMandateAccountActive,
  loadMandateAccount,
  type MandateAccountOnChain,
  type OnChainMandateExport,
};

export interface LoadMandateResult {
  address: string;
  programId: string;
  account: MandateAccountOnChain;
  active: boolean;
  export: OnChainMandateExport;
}

/**
 * Loads an Atlas Mandate PDA from Devnet and fails closed on missing/wrong-owner/undecodable data.
 * Does not trust caller JSON. Does not broadcast.
 */
export async function loadMandate(
  connection: Connection,
  address: string,
  options: { programId?: string; nowSeconds?: number; offChain?: OnChainMandateExport['off_chain'] } = {},
): Promise<LoadMandateResult> {
  if (address === RECOVERY_CHANNEL) throw new Error('Recovery payment channel is not a mandate account');
  const programId = options.programId ?? DEFAULT_MANDATE_PROGRAM_ID;
  const account = await loadMandateAccount(connection, address, programId);
  const active = isMandateAccountActive(account, options.nowSeconds);
  return {
    address,
    programId,
    account,
    active,
    export: exportMandateAccountJson(address, account, { programId, offChain: options.offChain }),
  };
}

/** Rejects revoked, not-yet-valid, or expired on-chain mandates before voucher work. */
export function assertMandateActiveForPayment(loaded: LoadMandateResult): void {
  if (loaded.account.revoked) throw new Error('Mandate is revoked on-chain');
  if (!loaded.active) throw new Error('Mandate is not active on-chain (check notBefore / expiresAt)');
}

/**
 * Cross-checks a payment intent against the authoritative on-chain account.
 * Recipients/resources are not on-chain — the gate still enforces those from the off-chain mandate.
 * Payment-channels settlement does not read this account.
 */
export function assertPaymentAgainstOnChainMandate(
  loaded: LoadMandateResult,
  intent: { agentPublicKey: string; mint: string; deltaAmount: bigint },
): void {
  assertMandateActiveForPayment(loaded);
  if (loaded.account.agent !== intent.agentPublicKey) {
    throw new Error('On-chain mandate agent does not match the voucher agent');
  }
  if (loaded.account.mint !== intent.mint) {
    throw new Error('On-chain mandate mint does not match the payment mint');
  }
  if (intent.deltaAmount <= 0n) throw new Error('Payment delta must be positive');
  if (intent.deltaAmount > loaded.account.maxPerPayment) {
    throw new Error('Payment delta exceeds on-chain maxPerPayment');
  }
  if (intent.deltaAmount > loaded.account.maxTotal) {
    throw new Error('Payment delta exceeds on-chain maxTotal');
  }
}
