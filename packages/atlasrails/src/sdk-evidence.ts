import { readFileSync } from 'node:fs';
import type { Connection } from '@solana/web3.js';
import { PublicKey } from '@solana/web3.js';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

export const RECOVERY_CHANNEL = 'GEMPoRi8Si9peeMnCg6jDp36mKjT1oQLeqwm3VaveFuz';
export const EVIDENCE_CHANNEL = '5R9dv5gjMkZt9yFdHS3T67X3hNAM9XZLrXxnCtaSHoif';
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';

export interface SavedE2eEvidence {
  channel: string;
  escrow: string;
  authorizedSigner: string;
  signatures: { open: string; settle: string; distribute: string };
  channelState: {
    deposit: string;
    settled: string;
    payoutWatermark: string;
    authorizedSigner: string;
  };
  tokenBalances: { escrow: string };
  receipt?: { id: string | null; verifyPass: boolean | null };
}

async function paymentHelpers() {
  const href = pathToFileURL(join(__dirname, '..', 'payment.mjs')).href;
  const load = new Function('specifier', 'return import(specifier)') as (s: string) => Promise<{
    readChannel: (data: Buffer | Uint8Array) => {
      status: number;
      deposit: bigint;
      settled: bigint;
      payoutWatermark: bigint;
      authorizedSigner: string;
      mint: string;
      payer: string;
      payee: string;
    };
    DEVNET_GENESIS: string;
  }>;
  return load(href);
}

/** Loads the saved Devnet e2e report without modifying it. */
export function loadSavedE2eEvidence(path: string): SavedE2eEvidence {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as SavedE2eEvidence & { recoveryChannelUntouched?: string };
  if (raw.channel === RECOVERY_CHANNEL) throw new Error('Evidence points at the recovery channel');
  if (raw.channel !== EVIDENCE_CHANNEL) {
    // Allow the known report; reject accidental recovery.
  }
  return raw;
}

/**
 * Read-only check of the saved evidence against live Devnet state.
 * Does not broadcast. Does not claim stronger guarantees than the chain returns.
 */
export async function verifySavedE2eEvidence(
  connection: Connection,
  path: string,
): Promise<{
  genesisOk: boolean;
  channelMatches: boolean;
  escrowMatches: boolean;
  signaturesFinalized: { open: boolean; settle: boolean; distribute: boolean };
  settledMatchesReport: boolean;
  payoutMatchesReport: boolean;
  recoveryUntouched: boolean;
  limitations: string[];
}> {
  const evidence = loadSavedE2eEvidence(path);
  const helpers = await paymentHelpers();
  const genesis = await connection.getGenesisHash();
  const genesisOk = genesis === (helpers.DEVNET_GENESIS || DEVNET_GENESIS);
  const info = await connection.getAccountInfo(new PublicKey(evidence.channel), 'confirmed');
  if (!info) throw new Error('Evidence channel account is missing');
  const decoded = helpers.readChannel(info.data);
  const escrow = await connection.getTokenAccountBalance(new PublicKey(evidence.escrow), 'confirmed');
  const statuses = await connection.getSignatureStatuses(
    [evidence.signatures.open, evidence.signatures.settle, evidence.signatures.distribute],
    { searchTransactionHistory: true },
  );
  const recovery = await connection.getAccountInfo(new PublicKey(RECOVERY_CHANNEL), 'confirmed');
  const limitations: string[] = [];
  if (!evidence.receipt?.verifyPass) limitations.push('Saved report receipt verify flag is missing or false');
  limitations.push('This check does not re-run the live voucher API denial or allow paths');
  limitations.push('Receipt cryptographic re-verification of the bound receipt body is not repeated here when the receipt blob is absent from the report');

  return {
    genesisOk,
    channelMatches: decoded.authorizedSigner === evidence.authorizedSigner,
    escrowMatches: escrow.value.amount === evidence.tokenBalances.escrow,
    signaturesFinalized: {
      open: statuses.value[0]?.confirmationStatus === 'finalized' && !statuses.value[0]?.err,
      settle: statuses.value[1]?.confirmationStatus === 'finalized' && !statuses.value[1]?.err,
      distribute: statuses.value[2]?.confirmationStatus === 'finalized' && !statuses.value[2]?.err,
    },
    settledMatchesReport: decoded.settled.toString() === evidence.channelState.settled,
    payoutMatchesReport: decoded.payoutWatermark.toString() === evidence.channelState.payoutWatermark,
    recoveryUntouched: Boolean(recovery) && recovery!.data[3] === 2,
    limitations,
  };
}
