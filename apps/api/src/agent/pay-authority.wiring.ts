import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { agentMandateSchema, type AgentMandate } from '@atlas-rail/mandate';
import { PrismaDecisionReceiptStore, PrismaPayOperationStore, PrismaVoucherSpendStore, generateUlid, prisma } from '@atlas-rail/database';
import { DevnetKeyring } from '@atlas-rail/solana';
import { defaultApprovals, readMandateAccount } from './channel-voucher';
import { PayAuthority, type PayCaller } from './pay-authority';

/**
 * Which caller uses which mandate: ATLAS_PAY_CALLERS_FILE points at
 *   { "callers": [ { "caller_id": "research-agent", "mandate_file": "mandates/research.json" } ] }
 * Each mandate file is the signed mandate document. Unknown callers are denied.
 */
export function callersFromFile(path = process.env.ATLAS_PAY_CALLERS_FILE): (callerId: string) => Promise<PayCaller | null> {
  if (!path) return async () => null;
  const file = resolve(path);
  const config = JSON.parse(readFileSync(file, 'utf8')) as { callers?: Array<{ caller_id?: unknown; mandate_file?: unknown }> };
  const callers = new Map<string, AgentMandate>();
  for (const entry of config.callers ?? []) {
    if (typeof entry.caller_id !== 'string' || typeof entry.mandate_file !== 'string') throw new Error('Each caller needs caller_id and mandate_file');
    const mandate = agentMandateSchema.parse(JSON.parse(readFileSync(resolve(file, '..', entry.mandate_file), 'utf8'))) as AgentMandate;
    callers.set(entry.caller_id, mandate);
  }
  return async (callerId) => {
    const mandate = callers.get(callerId);
    return mandate ? { mandate } : null;
  };
}

let authority: PayAuthority | null = null;
let receipts: PrismaDecisionReceiptStore | null = null;

export function decisionReceipts(): PrismaDecisionReceiptStore {
  receipts ??= new PrismaDecisionReceiptStore(prisma);
  return receipts;
}

/** The API's authority: Postgres stores, the devnet gate key, callers from ATLAS_PAY_CALLERS_FILE. */
export function defaultPayAuthority(): PayAuthority {
  if (!authority) {
    const keyring = DevnetKeyring.load();
    if (!keyring.publicKey('instance')) throw new Error('Gate key is missing');
    authority = new PayAuthority({
      callers: callersFromFile(),
      instance: keyring.signer('instance'),
      spends: new PrismaVoucherSpendStore(prisma),
      operations: new PrismaPayOperationStore(prisma),
      saveReceipt: (receipt) => decisionReceipts().insert(receipt),
      approvals: defaultApprovals(),
      readMandate: readMandateAccount,
      newId: generateUlid,
      onError: (error) => console.error(`pay authority could not decide: ${error instanceof Error ? error.message : String(error)}`),
    });
  }
  return authority;
}
