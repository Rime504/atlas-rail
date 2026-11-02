import { describe, expect, it } from 'vitest';
import { merkleProof, merkleRoot } from './merkle';
import {
  HistoryDecision,
  HistoryReceipt,
  projectPaymentHistory,
  redactedPaymentLog,
} from './payment-history';

const ORG = 'org_a';
const OTHER = 'org_b';
const DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
const USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const SIG = '3'.repeat(88);

function decision(overrides: Partial<HistoryDecision> = {}): HistoryDecision {
  return {
    organizationId: ORG,
    id: 'dec_1',
    mandateId: 'man_1',
    decision: 'ALLOW',
    kind: 'AUTONOMOUS',
    reason: 'Within the mandate.',
    failedRule: null,
    offer: {
      amount: '500',
      asset: USDC,
      payTo: 'Payee111111111111111111111111111111111111111',
      resourceUrl: 'https://research.example/job',
      network: DEVNET,
    },
    createdAt: 1_700_000_000,
    hasAuthorization: true,
    ...overrides,
  };
}

function receipt(leaves: string[], index: number, overrides: Partial<HistoryReceipt> = {}): HistoryReceipt {
  const root = merkleRoot(leaves);
  return {
    organizationId: ORG,
    id: `rcp_${index}`,
    decisionId: 'dec_1',
    receiptHash: leaves[index]!,
    offer: decision().offer,
    txSignature: SIG,
    issuedAt: 1_700_000_100,
    anchor: {
      merkleRoot: root,
      leafCount: leaves.length,
      leafIndex: index,
      proof: merkleProof(leaves, index),
      txSignature: 'A'.repeat(88),
      network: DEVNET,
      anchoredAt: 1_700_000_200,
    },
    ...overrides,
  };
}

const HASH = 'ab'.repeat(32);

describe('payment history', () => {
  it('excludes blocked, pending, authorized, and failed rows from settled totals', () => {
    const view = projectPaymentHistory({
      organizationId: ORG,
      decisions: [
        decision({ id: 'settled' }),
        decision({ id: 'blocked', decision: 'DENY', reason: 'Recipient is not allowed.', hasAuthorization: false }),
        decision({ id: 'pending', decision: 'ESCALATE', hasAuthorization: false, kind: null }),
        decision({ id: 'authorized' }),
        decision({ id: 'failed-row' }),
      ],
      receipts: [receipt([HASH], 0, { decisionId: 'settled', offer: { ...decision().offer, amount: '500' } })],
      approvals: [{ organizationId: ORG, decisionId: 'pending', status: 'PENDING' }],
      failures: [{ organizationId: ORG, decisionId: 'failed-row' }],
    });
    expect(view.payments.find((row) => row.id === 'blocked')?.statusLabel).toBe('Blocked by policy');
    expect(view.payments.find((row) => row.id === 'pending')?.status).toBe('pending');
    expect(view.payments.find((row) => row.id === 'authorized')?.status).toBe('authorized');
    expect(view.payments.find((row) => row.id === 'failed-row')?.status).toBe('failed');
    expect(view.totals).toEqual([
      expect.objectContaining({ mint: USDC, settledBaseUnits: '500', settledCount: 1, namespace: 'devnet' }),
    ]);
  });

  it('does not treat a stored root as a settled payment', () => {
    const view = projectPaymentHistory({
      organizationId: ORG,
      decisions: [decision()],
      receipts: [receipt([HASH], 0, { txSignature: '' })],
      approvals: [],
    });
    expect(view.payments[0]?.status).toBe('verification_unavailable');
    expect(view.payments[0]?.claims.rootAnchored).toBe(true);
    expect(view.payments[0]?.claims.settlementRecorded).toBe(false);
    expect(view.totals).toEqual([]);
    expect(view.payments[0]?.timeline.find((stage) => stage.id === 'settlement')?.state).toBe('unavailable');
  });

  it('fails an inclusion proof that does not match the stored root', () => {
    const bad = receipt([HASH], 0);
    bad.anchor!.proof = [{ position: 'left', hash: 'ff'.repeat(32) }];
    bad.anchor!.leafCount = 2;
    const view = projectPaymentHistory({
      organizationId: ORG,
      decisions: [decision()],
      receipts: [bad],
      approvals: [],
    });
    expect(view.payments[0]?.status).toBe('settled');
    expect(view.payments[0]?.claims.inclusion).toBe('failed');
    expect(view.batches[0]?.inclusionFailed).toBe(1);
    expect(view.batches[0]?.settlementsRecorded).toBe(1);
  });

  it('takes the settled amount from the receipt, not from a different requested amount', () => {
    const view = projectPaymentHistory({
      organizationId: ORG,
      decisions: [decision({ offer: { ...decision().offer, amount: '9999' } })],
      receipts: [receipt([HASH], 0, { offer: { ...decision().offer, amount: '500' } })],
      approvals: [],
    });
    expect(view.payments[0]?.requestedAmount).toBe('9999');
    expect(view.payments[0]?.settledAmount).toBe('500');
    expect(view.totals[0]?.settledBaseUnits).toBe('500');
  });

  it('keeps devnet and other networks in separate totals', () => {
    const other = receipt([HASH], 0, {
      id: 'rcp_other',
      decisionId: 'other',
      offer: { ...decision().offer, amount: '700', network: 'solana:mainnet-example' },
    });
    const view = projectPaymentHistory({
      organizationId: ORG,
      decisions: [decision(), decision({ id: 'other' })],
      receipts: [receipt([HASH], 0, { offer: { ...decision().offer, amount: '500' } }), other],
      approvals: [],
    });
    expect(view.totals).toHaveLength(2);
    expect(view.totals.find((row) => row.namespace === 'devnet')?.settledBaseUnits).toBe('500');
    expect(view.totals.find((row) => row.namespace === 'other')?.settledBaseUnits).toBe('700');
    const devnetOnly = projectPaymentHistory({
      organizationId: ORG,
      decisions: [decision(), decision({ id: 'other' })],
      receipts: [receipt([HASH], 0), other],
      approvals: [],
      namespace: 'devnet',
    });
    expect(devnetOnly.payments.every((row) => row.namespace === 'devnet')).toBe(true);
  });

  it('does not add two mints into one total', () => {
    const sol = receipt(['cd'.repeat(32)], 0, {
      id: 'rcp_sol',
      decisionId: 'sol',
      offer: { ...decision().offer, amount: '9', asset: SOL_MINT },
    });
    const view = projectPaymentHistory({
      organizationId: ORG,
      decisions: [decision(), decision({ id: 'sol', offer: { ...decision().offer, asset: SOL_MINT, amount: '9' } })],
      receipts: [receipt([HASH], 0), sol],
      approvals: [],
    });
    expect(view.totals.map((row) => row.mint).sort()).toEqual([SOL_MINT, USDC].sort());
    expect(view.payments.find((row) => row.id === 'sol')?.token.decimals).toBeNull();
  });

  it('drops another organisation from the session view and from the log line', () => {
    const view = projectPaymentHistory({
      organizationId: ORG,
      decisions: [decision(), decision({ id: 'foreign', organizationId: OTHER, offer: { ...decision().offer, amount: '1', resourceUrl: 'https://secret.example/a@b.com' } })],
      receipts: [receipt([HASH], 0, { organizationId: OTHER, decisionId: 'foreign', offer: { ...decision().offer, amount: '1', payTo: 'OtherPayee111111111111111111111111111111111' } })],
      approvals: [{ organizationId: OTHER, decisionId: 'foreign', status: 'PENDING' }],
    });
    expect(view.payments.map((row) => row.id)).toEqual(['dec_1']);
    expect(JSON.stringify(view)).not.toContain('secret.example');
    expect(JSON.stringify(view)).not.toContain('OtherPayee');
    const log = JSON.stringify(redactedPaymentLog(view));
    expect(log).not.toContain('secret.example');
    expect(log).not.toContain('research.example');
    expect(log).not.toContain('Payee');
    expect(log).not.toContain(USDC);
    expect(log).not.toContain(SIG);
  });
});
