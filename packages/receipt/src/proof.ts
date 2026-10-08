import {
  AgentMandate,
  SignedDecision,
  hashMandate,
  parseReceiptMemo,
  verifyDecisionMatchesScope,
  verifyDecisionSignature,
  verifyMandateChain,
} from '@atlas-rail/mandate';
import type { ChainClient } from '@atlas-rail/solana';
import { BoundReceipt, ReceiptVerification, verifyReceipt } from './receipt';

/** What anyone gets back after handing us nothing but a devnet transaction signature. */
export type PaymentProof =
  | { verdict: 'NOT_FOUND'; txSignature: string; reason: string }
  | { verdict: 'NO_PROOF'; txSignature: string; reason: string; receiptId: string | null }
  | {
      verdict: 'PROVEN' | 'INVALID';
      txSignature: string;
      reason: string;
      receiptId: string;
      receipt: BoundReceipt;
      verification: ReceiptVerification;
      facts: PaymentFacts;
    };

export interface PaymentFacts {
  signers: Array<{ role: string; publicKey: string }>;
  limits: AgentMandate['scope']['limits'];
  decision: { outcome: string; kind: string | null; failedRules: string[]; reason: string };
  payment: { amount: string; mint: string; payTo: string; payer: string | null; slot: number | null; blockTime: number | null };
  anchor: { mechanism: string; merkleRoot: string; seq: number | null; txSignature: string } | null;
  /** Mandate state at the moment the payment landed, from the mandate itself and (when available) its on-chain account. */
  mandateAtPaymentTime: { withinValidity: boolean; revoked: boolean | null; revokedAt: number | null };
  instanceKey: string;
}

export interface OnchainMandateState {
  revoked: boolean;
  revokedAt: number;
}

export interface ProvePaymentOptions {
  chain: ChainClient;
  /** Fetches a published receipt by id (the public store, a local file, ...); null when nothing is published under it. */
  loadReceipt: (receiptId: string) => Promise<unknown | null>;
  /** Reads the mandate's on-chain registry account by mandate hash (hex); null if it isn't registered. */
  loadMandateState?: (mandateHashHex: string) => Promise<OnchainMandateState | null>;
  trustedInstanceKeys?: readonly string[];
  programId?: string;
}

export const NO_PROOF_MESSAGE = 'This payment carries no Atlas Rail proof of permission.';

/**
 * Proof of permission from a transaction signature alone. The memo names the receipt, the receipt
 * must name this exact transaction back, and then every receipt check runs — including the on-chain
 * anchor and the settlement read — plus whether the mandate had been revoked before the payment.
 * Nothing the payer or Atlas Rail says is trusted on its own: the memo is read from the chain and
 * the receipt is re-verified from scratch.
 */
export async function provePayment(txSignature: string, options: ProvePaymentOptions): Promise<PaymentProof> {
  const summary = await options.chain.getTransactionSummary(txSignature);
  if (!summary) return { verdict: 'NOT_FOUND', txSignature, reason: 'No transaction with this signature was found on Solana devnet.' };
  if (summary.err !== null) {
    return { verdict: 'NO_PROOF', txSignature, receiptId: null, reason: `${NO_PROOF_MESSAGE} The transaction failed on-chain, so it moved no funds.` };
  }

  const receiptId = parseReceiptMemo(summary.memos);
  if (!receiptId) return { verdict: 'NO_PROOF', txSignature, receiptId: null, reason: `${NO_PROOF_MESSAGE} Its memo does not name an Atlas Rail receipt.` };

  const loaded = await options.loadReceipt(receiptId);
  if (!loaded) {
    return { verdict: 'NO_PROOF', txSignature, receiptId, reason: `${NO_PROOF_MESSAGE} Its memo names ${receiptId}, but no receipt with that id has been published.` };
  }
  const receipt = loaded as BoundReceipt;
  if (receipt.settlement?.txSignature !== txSignature) {
    return { verdict: 'NO_PROOF', txSignature, receiptId, reason: `${NO_PROOF_MESSAGE} Its memo names ${receiptId}, but that receipt is for a different transaction.` };
  }

  const verification = await verifyReceipt(receipt, {
    chain: options.chain,
    requireAnchor: true,
    trustedInstanceKeys: options.trustedInstanceKeys,
    programId: options.programId,
  });

  const transfer = summary.tokenTransfers.find((t) => t.amount === receipt.offer.amount && t.mint === receipt.offer.asset) ?? summary.tokenTransfers[0];
  const blockTime = summary.blockTime;
  const mandate = receipt.mandate;
  const withinValidity = blockTime === null || (blockTime >= mandate.notBefore && blockTime <= mandate.expiresAt);

  let revoked: boolean | null = null;
  let revokedAt: number | null = null;
  if (options.loadMandateState) {
    const state = await options.loadMandateState(hashMandate(mandate));
    if (state) {
      revokedAt = state.revoked ? state.revokedAt : null;
      // Revoked after the payment is fine (the mandate was live when the gate allowed it); revoked
      // at or before it would mean an ALLOW the gate should never have issued.
      revoked = state.revoked && blockTime !== null && state.revokedAt <= blockTime;
    }
  }

  const anchor = receipt.anchor
    ? {
        mechanism: receipt.anchor.mechanism ?? 'memo',
        merkleRoot: receipt.anchor.merkleRoot,
        seq: receipt.anchor.seq ?? null,
        txSignature: receipt.anchor.txSignature,
      }
    : null;

  const record = receipt.decision.record;
  const facts: PaymentFacts = {
    signers: mandate.delegationChain.map((link) => ({ role: link.role, publicKey: link.publicKey })),
    limits: mandate.scope.limits,
    decision: { outcome: record.decision, kind: record.kind ?? null, failedRules: record.failedRules, reason: record.reason },
    payment: {
      amount: transfer?.amount ?? receipt.offer.amount,
      mint: transfer?.mint ?? receipt.offer.asset,
      payTo: receipt.offer.payTo,
      payer: transfer?.authority ?? null,
      slot: summary.slot,
      blockTime,
    },
    anchor,
    mandateAtPaymentTime: { withinValidity, revoked, revokedAt },
    instanceKey: receipt.instance.publicKey,
  };

  const problems: string[] = [];
  if (!verification.pass) problems.push(...verification.checks.filter((c) => c.status === 'FAIL').map((c) => c.title));
  if (!withinValidity) problems.push('Mandate was outside its validity window when the payment landed');
  if (revoked === true) problems.push('Mandate had already been revoked when the payment landed');

  return problems.length === 0
    ? { verdict: 'PROVEN', txSignature, receiptId, receipt, verification, facts, reason: 'Every check passed: this payment was allowed by a signed mandate, and the chain agrees.' }
    : { verdict: 'INVALID', txSignature, receiptId, receipt, verification, facts, reason: `The receipt does not hold up: ${problems.join('; ')}.` };
}

/** A blocked attempt: nothing was ever signed or sent, so there is no transaction — the proof is the signed DENY decision itself. */
export interface BlockedAttemptRecord {
  mandate: AgentMandate;
  decision: SignedDecision;
}

export interface BlockedAttemptProof {
  verdict: 'BLOCKED' | 'INVALID';
  reason: string;
  checks: Array<{ id: string; ok: boolean; message: string }>;
  facts: {
    decisionId: string;
    failedRules: string[];
    decisionReason: string;
    offer: { amount: string; payTo: string; resourceUrl: string };
    instanceKey: string;
    signers: Array<{ role: string; publicKey: string }>;
  } | null;
}

export function proveBlockedAttempt(input: unknown, trustedInstanceKeys?: readonly string[]): BlockedAttemptProof {
  const candidate = input as Partial<BlockedAttemptRecord> | null;
  if (!candidate || typeof candidate !== 'object' || !candidate.mandate || !candidate.decision?.record) {
    return { verdict: 'INVALID', reason: 'Not a blocked-attempt record (expected a mandate and a signed decision).', checks: [], facts: null };
  }
  const { mandate, decision } = candidate as BlockedAttemptRecord;
  const chain = verifyMandateChain(mandate);
  const checks = [
    { id: 'MANDATE_CHAIN', ok: chain.valid, message: chain.valid ? 'Owner, approver and agent signatures on the mandate all verify' : chain.errors.join('; ') },
    verifyDecisionSignature(decision),
    verifyDecisionMatchesScope(mandate, decision),
    { id: 'DECISION_DENIED', ok: decision.record.decision === 'DENY', message: `Gate decision was ${decision.record.decision}` },
  ];
  if (trustedInstanceKeys) {
    const trusted = trustedInstanceKeys.includes(decision.instance.publicKey);
    checks.push({ id: 'TRUSTED_INSTANCE', ok: trusted, message: trusted ? 'Signed by a pinned Atlas Rail instance key' : 'Signed by an instance key that is not pinned' });
  }
  const ok = checks.every((c) => c.ok);
  return {
    verdict: ok ? 'BLOCKED' : 'INVALID',
    reason: ok
      ? 'The gate refused this payment before anything was signed. No transaction exists; this signed decision is the proof.'
      : `The decision record does not hold up: ${checks.filter((c) => !c.ok).map((c) => c.message).join('; ')}.`,
    checks,
    facts: {
      decisionId: decision.record.id,
      failedRules: decision.record.failedRules,
      decisionReason: decision.record.reason,
      offer: { amount: decision.record.offer.amount, payTo: decision.record.offer.payTo, resourceUrl: decision.record.offer.resourceUrl },
      instanceKey: decision.instance.publicKey,
      signers: mandate.delegationChain.map((link) => ({ role: link.role, publicKey: link.publicKey })),
    },
  };
}
