import { SOLANA_DEVNET_CAIP2 } from '@atlas-rail/mandate';
import { MerkleStep, verifyMerkleProof } from './merkle';
import { saltedLeafPreimage } from './batch-file';

/** Devnet USDC. Other mints stay in base units because this record does not store decimals. */
const USDC_DEVNET_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

export type PaymentStatus = 'settled' | 'authorized' | 'pending' | 'blocked' | 'failed' | 'verification_unavailable';

export type InclusionStatus = 'verified' | 'failed' | 'not_anchored' | 'unavailable';

export interface HistoryOffer {
  amount: string;
  asset: string;
  payTo: string;
  resourceUrl: string;
  network: string;
}

export interface HistoryDecision {
  organizationId: string;
  id: string;
  mandateId: string;
  decision: 'ALLOW' | 'DENY' | 'ESCALATE';
  kind: 'AUTONOMOUS' | 'APPROVED' | null;
  reason: string;
  failedRule: string | null;
  offer: HistoryOffer;
  createdAt: number;
  hasAuthorization: boolean;
}

export interface HistoryAnchor {
  merkleRoot: string;
  leafCount: number;
  leafIndex: number;
  proof: MerkleStep[];
  txSignature: string;
  network: string;
  anchoredAt: number | null;
  leafSalt?: string;
  batchHeader?: string;
  batchFileHash?: string;
}

export interface HistoryReceipt {
  organizationId: string;
  id: string;
  decisionId: string;
  receiptHash: string;
  offer: HistoryOffer;
  txSignature: string;
  issuedAt: number;
  anchor: HistoryAnchor | null;
}

export interface HistoryApproval {
  organizationId: string;
  decisionId: string;
  status: 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED' | 'CONSUMED';
}

export interface HistoryFailure {
  organizationId: string;
  decisionId: string;
}

export interface PaymentToken {
  mint: string;
  label: string;
  /** Null when the record does not say how to display this mint. */
  decimals: number | null;
}

export interface PaymentClaims {
  rootAnchored: boolean;
  rootDetail: string;
  inclusion: InclusionStatus;
  inclusionDetail: string;
  settlementRecorded: boolean;
  settlementDetail: string;
}

export interface TimelineStage {
  id: 'request' | 'policy' | 'authorization' | 'settlement' | 'anchor';
  label: string;
  state: 'done' | 'blocked' | 'waiting' | 'unavailable';
  detail: string;
}

export interface PaymentRow {
  id: string;
  organizationId: string;
  mandateId: string;
  status: PaymentStatus;
  statusLabel: string;
  purpose: string;
  recipient: string;
  token: PaymentToken;
  namespace: 'devnet' | 'other';
  network: string;
  requestedAmount: string | null;
  authorizedAmount: string | null;
  settledAmount: string | null;
  at: number;
  settlementSignature: string | null;
  receiptId: string | null;
  policy: string | null;
  claims: PaymentClaims;
  timeline: TimelineStage[];
  anchor: null | {
    txSignature: string;
    merkleRoot: string;
    leafIndex: number;
    leafCount: number;
    anchoredAt: number | null;
    network: string;
  };
  fees: { available: false; detail: string };
}

export interface PaymentBatch {
  txSignature: string;
  merkleRoot: string;
  leafCount: number;
  anchoredAt: number | null;
  network: string;
  namespace: 'devnet' | 'other';
  receiptCount: number;
  settlementsRecorded: number;
  inclusionVerified: number;
  inclusionFailed: number;
  confirmation: 'stored_not_rechecked';
  note: string;
}

export interface PaymentTotals {
  namespace: 'devnet' | 'other';
  mint: string;
  label: string;
  decimals: number | null;
  settledBaseUnits: string;
  settledCount: number;
}

export interface PaymentHistoryView {
  organizationId: string;
  payments: PaymentRow[];
  totals: PaymentTotals[];
  counts: { settled: number; authorized: number; pending: number; blocked: number; failed: number; verificationUnavailable: number };
  batches: PaymentBatch[];
  fees: { available: false; detail: string };
  limitNote: string;
}

const FEE_DETAIL = 'Network and settlement fees are not stored on this record.';
const BATCH_NOTE = 'The root signature is stored with these receipts. This list does not re-fetch the chain. A stored root does not prove each payment settled. Inclusion verified means the stored proof matches the stored root.';

const STATUS_LABEL: Record<PaymentStatus, string> = {
  settled: 'Settled',
  authorized: 'Authorized — awaiting settlement',
  pending: 'Pending',
  blocked: 'Blocked by policy',
  failed: 'Failed',
  verification_unavailable: 'Verification unavailable',
};

const BASE_UNITS = /^(0|[1-9][0-9]*)$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

export function paymentNamespace(network: string): 'devnet' | 'other' {
  return network === SOLANA_DEVNET_CAIP2 || network === 'solana-devnet' ? 'devnet' : 'other';
}

function validAmount(value: string | null | undefined): value is string {
  return typeof value === 'string' && BASE_UNITS.test(value);
}

function validMint(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length >= 32 && value.length <= 44 && BASE58.test(value);
}

/** A Solana signature is 64 bytes, which base58 encodes to 87 or 88 characters. */
function validSignature(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length >= 87 && value.length <= 88 && BASE58.test(value);
}

function tokenFor(mint: string): PaymentToken {
  if (mint === USDC_DEVNET_MINT) return { mint, label: 'USDC', decimals: 6 };
  return { mint, label: 'Unknown token', decimals: null };
}

function purposeOf(resourceUrl: string): string {
  try {
    return new URL(resourceUrl).host || 'Purpose unavailable';
  } catch {
    return 'Purpose unavailable';
  }
}

function addBaseUnits(left: string, right: string): string {
  return (BigInt(left) + BigInt(right)).toString();
}

function inclusionOf(receipt: HistoryReceipt): InclusionStatus {
  if (!receipt.anchor) return 'not_anchored';
  if (!receipt.receiptHash || !receipt.anchor.merkleRoot) return 'unavailable';
  const leaf = receipt.anchor.leafSalt ? saltedLeafPreimage(receipt.receiptHash, receipt.anchor.leafSalt) : receipt.receiptHash;
  return verifyMerkleProof(leaf, receipt.anchor.proof, receipt.anchor.merkleRoot) ? 'verified' : 'failed';
}

function claimsFor(receipt: HistoryReceipt | null, settled: boolean): PaymentClaims {
  const inclusion = receipt ? inclusionOf(receipt) : 'not_anchored';
  const rootAnchored = Boolean(receipt?.anchor?.txSignature);
  return {
    rootAnchored,
    rootDetail: rootAnchored
      ? 'A root signature is stored. Chain confirmation is not re-checked here.'
      : 'No root is stored for this payment.',
    inclusion,
    inclusionDetail:
      inclusion === 'verified'
        ? 'The stored inclusion proof matches the stored Merkle root. That does not re-check the chain.'
        : inclusion === 'failed'
          ? 'The stored inclusion proof does not match the stored Merkle root.'
          : inclusion === 'not_anchored'
            ? 'This payment is not in an anchored batch.'
            : 'The inclusion proof cannot be checked from the stored receipt.',
    settlementRecorded: settled,
    settlementDetail: settled
      ? 'A settlement signature is stored on the receipt. This page has not re-fetched that transaction.'
      : 'No verified settlement is stored. An anchor transaction does not settle a payment.',
  };
}

function timelineFor(input: {
  decision: HistoryDecision | null;
  receipt: HistoryReceipt | null;
  status: PaymentStatus;
  claims: PaymentClaims;
}): TimelineStage[] {
  const stages: TimelineStage[] = [];
  const { decision, receipt, status, claims } = input;
  if (decision) {
    stages.push({
      id: 'request',
      label: 'Request',
      state: 'done',
      detail: 'The gate recorded this request.',
    });
    stages.push({
      id: 'policy',
      label: 'Policy evaluation',
      state: status === 'blocked' ? 'blocked' : 'done',
      detail: decision.reason || decision.decision,
    });
  }
  if (status === 'blocked') return stages;
  if (decision?.hasAuthorization || decision?.decision === 'ALLOW' || decision?.kind) {
    stages.push({
      id: 'authorization',
      label: 'Authorization',
      state: decision.hasAuthorization || decision.decision === 'ALLOW' || decision.kind === 'APPROVED' ? 'done' : 'waiting',
      detail: decision.hasAuthorization
        ? 'The gate stored a signed authorization. That is not a settlement.'
        : 'The decision allowed the request. No separate authorization record is stored.',
    });
  } else if (status === 'pending') {
    stages.push({
      id: 'authorization',
      label: 'Authorization',
      state: 'waiting',
      detail: 'A person still has to approve this request.',
    });
  }
  if (receipt && validSignature(receipt.txSignature)) {
    stages.push({
      id: 'settlement',
      label: 'Settlement',
      state: 'done',
      detail: 'The receipt stores a settlement signature. The chain has not been re-read here.',
    });
  } else if (decision?.decision === 'ALLOW' || receipt) {
    stages.push({
      id: 'settlement',
      label: 'Settlement',
      state: 'unavailable',
      detail: 'No settlement signature is stored.',
    });
  }
  if (receipt?.anchor) {
    stages.push({
      id: 'anchor',
      label: 'Merkle anchoring',
      state: claims.inclusion === 'verified' ? 'done' : claims.inclusion === 'failed' ? 'blocked' : 'unavailable',
      detail: claims.inclusionDetail,
    });
  } else if (receipt) {
    stages.push({
      id: 'anchor',
      label: 'Merkle anchoring',
      state: 'waiting',
      detail: 'This receipt is not in an anchored batch yet.',
    });
  }
  return stages;
}

function approvalRank(status: HistoryApproval['status']): number {
  if (status === 'PENDING') return 4;
  if (status === 'APPROVED' || status === 'CONSUMED') return 3;
  return 1;
}

function statusFor(input: {
  decision: HistoryDecision | null;
  receipt: HistoryReceipt | null;
  approval: HistoryApproval | null;
  failed: boolean;
}): PaymentStatus {
  const { decision, receipt, approval, failed } = input;
  if (receipt) {
    if (validSignature(receipt.txSignature) && validAmount(receipt.offer.amount) && validMint(receipt.offer.asset)) return 'settled';
    return 'verification_unavailable';
  }
  if (failed) return 'failed';
  if (!decision) return 'verification_unavailable';
  if (decision.decision === 'DENY') return 'blocked';
  if (decision.decision === 'ESCALATE') {
    if (!approval || approval.status === 'PENDING') return 'pending';
    if (approval.status === 'DENIED' || approval.status === 'EXPIRED') return 'blocked';
    return 'authorized';
  }
  if (decision.decision === 'ALLOW') return 'authorized';
  return 'verification_unavailable';
}

function rowFrom(input: {
  organizationId: string;
  decision: HistoryDecision | null;
  receipt: HistoryReceipt | null;
  approval: HistoryApproval | null;
  failed: boolean;
}): PaymentRow | null {
  const { decision, receipt } = input;
  if (!decision && !receipt) return null;
  const offer = receipt?.offer ?? decision!.offer;
  if (!validMint(offer.asset)) return null;
  const status = statusFor(input);
  const claims = claimsFor(receipt, status === 'settled');
  const requested = decision && validAmount(decision.offer.amount) ? decision.offer.amount : null;
  const authorized =
    decision && validAmount(decision.offer.amount) && (decision.decision === 'ALLOW' || input.approval?.status === 'APPROVED' || input.approval?.status === 'CONSUMED')
      ? decision.offer.amount
      : null;
  return {
    id: decision?.id ?? receipt!.id,
    organizationId: input.organizationId,
    mandateId: decision?.mandateId ?? '',
    status,
    statusLabel: STATUS_LABEL[status],
    purpose: purposeOf(offer.resourceUrl),
    recipient: offer.payTo,
    token: tokenFor(offer.asset),
    namespace: paymentNamespace(offer.network),
    network: offer.network,
    requestedAmount: requested,
    authorizedAmount: authorized,
    settledAmount: status === 'settled' && receipt ? receipt.offer.amount : null,
    at: receipt?.issuedAt ?? decision!.createdAt,
    settlementSignature: status === 'settled' && receipt ? receipt.txSignature : null,
    receiptId: receipt?.id ?? null,
    policy: decision ? decision.reason || decision.failedRule : null,
    claims,
    timeline: timelineFor({ decision, receipt, status, claims }),
    anchor: receipt?.anchor
      ? {
          txSignature: receipt.anchor.txSignature,
          merkleRoot: receipt.anchor.merkleRoot,
          leafIndex: receipt.anchor.leafIndex,
          leafCount: receipt.anchor.leafCount,
          anchoredAt: receipt.anchor.anchoredAt,
          network: receipt.anchor.network,
        }
      : null,
    fees: { available: false, detail: FEE_DETAIL },
  };
}

export function projectPaymentHistory(input: {
  organizationId: string;
  decisions: readonly HistoryDecision[];
  receipts: readonly HistoryReceipt[];
  approvals: readonly HistoryApproval[];
  failures?: readonly HistoryFailure[];
  from?: number | null;
  to?: number | null;
  namespace?: 'devnet' | 'other' | 'all';
}): PaymentHistoryView {
  const org = input.organizationId;
  const decisions = input.decisions.filter((row) => row.organizationId === org);
  const receipts = input.receipts.filter((row) => row.organizationId === org);
  const approvals = input.approvals.filter((row) => row.organizationId === org);
  const failures = new Set((input.failures ?? []).filter((row) => row.organizationId === org).map((row) => row.decisionId));
  const receiptByDecision = new Map<string, HistoryReceipt>();
  for (const receipt of receipts) {
    if (!receiptByDecision.has(receipt.decisionId)) receiptByDecision.set(receipt.decisionId, receipt);
  }
  const approvalByDecision = new Map<string, HistoryApproval>();
  for (const approval of approvals) {
    const current = approvalByDecision.get(approval.decisionId);
    if (!current || approvalRank(approval.status) > approvalRank(current.status)) approvalByDecision.set(approval.decisionId, approval);
  }
  const seen = new Set<string>();
  const rows: PaymentRow[] = [];
  for (const decision of decisions) {
    seen.add(decision.id);
    const row = rowFrom({
      organizationId: org,
      decision,
      receipt: receiptByDecision.get(decision.id) ?? null,
      approval: approvalByDecision.get(decision.id) ?? null,
      failed: failures.has(decision.id),
    });
    if (row) rows.push(row);
  }
  for (const receipt of receipts) {
    if (seen.has(receipt.decisionId)) continue;
    const row = rowFrom({ organizationId: org, decision: null, receipt, approval: null, failed: false });
    if (row) rows.push(row);
  }
  const namespace = input.namespace ?? 'all';
  const from = input.from ?? null;
  const to = input.to ?? null;
  const payments = rows
    .filter((row) => namespace === 'all' || row.namespace === namespace)
    .filter((row) => (from === null || row.at >= from) && (to === null || row.at <= to))
    .sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));

  const totals = new Map<string, PaymentTotals>();
  for (const row of payments) {
    if (row.status !== 'settled' || !row.settledAmount) continue;
    const key = `${row.namespace}:${row.token.mint}`;
    const current = totals.get(key);
    if (current) {
      current.settledBaseUnits = addBaseUnits(current.settledBaseUnits, row.settledAmount);
      current.settledCount += 1;
    } else {
      totals.set(key, {
        namespace: row.namespace,
        mint: row.token.mint,
        label: row.token.label,
        decimals: row.token.decimals,
        settledBaseUnits: row.settledAmount,
        settledCount: 1,
      });
    }
  }

  const batches = new Map<string, PaymentBatch>();
  for (const row of payments) {
    if (!row.anchor?.txSignature) continue;
    const key = row.anchor.txSignature;
    let batch = batches.get(key);
    if (!batch) {
      batch = {
        txSignature: row.anchor.txSignature,
        merkleRoot: row.anchor.merkleRoot,
        leafCount: row.anchor.leafCount,
        anchoredAt: row.anchor.anchoredAt,
        network: row.anchor.network,
        namespace: paymentNamespace(row.anchor.network),
        receiptCount: 0,
        settlementsRecorded: 0,
        inclusionVerified: 0,
        inclusionFailed: 0,
        confirmation: 'stored_not_rechecked',
        note: BATCH_NOTE,
      };
      batches.set(key, batch);
    }
    batch.receiptCount += 1;
    if (row.claims.settlementRecorded) batch.settlementsRecorded += 1;
    if (row.claims.inclusion === 'verified') batch.inclusionVerified += 1;
    if (row.claims.inclusion === 'failed') batch.inclusionFailed += 1;
  }

  const count = (status: PaymentStatus) => payments.filter((row) => row.status === status).length;
  return {
    organizationId: org,
    payments,
    totals: [...totals.values()],
    counts: {
      settled: count('settled'),
      authorized: count('authorized'),
      pending: count('pending'),
      blocked: count('blocked'),
      failed: count('failed'),
      verificationUnavailable: count('verification_unavailable'),
    },
    batches: [...batches.values()],
    fees: { available: false, detail: FEE_DETAIL },
    limitNote: 'Totals count settled receipts only, split by token and network. Pending, blocked, failed, and authorized requests are excluded.',
  };
}

/** Fields safe to write to a log line. Amounts, recipients, and purposes stay out. */
export function redactedPaymentLog(view: PaymentHistoryView): { organizationId: string; counts: PaymentHistoryView['counts'] } {
  return { organizationId: view.organizationId, counts: view.counts };
}
