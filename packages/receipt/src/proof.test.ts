import { describe, expect, it } from 'vitest';
import { formatReceiptMemo } from '@atlas-rail/mandate';
import { WORLD_ORG, World, createWorld } from './testing';
import { hashResponseBody } from './service';
import { NO_PROOF_MESSAGE, provePayment, proveBlockedAttempt } from './proof';

const response = { status: 200, bodySha256: hashResponseBody('{"summary":"ok"}'), contentType: 'application/json' };
const hex32 = (c: string) => `rcp_${c.repeat(32)}`;

async function selfProvingPayment(world: World, id: string, memo: string | null = formatReceiptMemo(id)) {
  const { outcome, transactionBase64 } = await world.requestGate({ memo });
  const txSignature = await world.settle(transactionBase64);
  const receipt = await world.receiptService.issue(WORLD_ORG, { decisionId: outcome.decision.record.id, txSignature, response });
  await world.anchorService.run();
  const stored = (await world.receipts.get(WORLD_ORG, receipt.id))!.receipt;
  return { txSignature, receipt: stored };
}

const loaderFor = (world: World) => async (id: string) => (await world.receipts.get(WORLD_ORG, id))?.receipt ?? null;

describe('provePayment: from a transaction signature alone', () => {
  it('PROVEN for a self-proving, anchored payment, with the facts a stranger needs', async () => {
    const world = await createWorld();
    const { txSignature, receipt } = await selfProvingPayment(world, hex32('a'));
    const proof = await provePayment(txSignature, { chain: world.chain, loadReceipt: loaderFor(world) });
    expect(proof.verdict).toBe('PROVEN');
    if (proof.verdict !== 'PROVEN') return;
    expect(proof.receiptId).toBe(receipt.id);
    expect(proof.facts.signers.map((s) => s.role)).toEqual(['OWNER', 'APPROVER', 'AGENT']);
    expect(proof.facts.payment).toMatchObject({ amount: receipt.offer.amount, payTo: receipt.offer.payTo, payer: world.keys.agent.publicKey });
    expect(proof.facts.anchor?.txSignature).toBeTruthy();
    expect(proof.verification.checks.every((c) => c.status === 'PASS')).toBe(true);
  });

  it('NO_PROOF for a payment whose memo names no Atlas Rail receipt', async () => {
    const world = await createWorld();
    const { txSignature } = await selfProvingPayment(world, hex32('b'), null); // random-nonce memo
    const proof = await provePayment(txSignature, { chain: world.chain, loadReceipt: loaderFor(world) });
    expect(proof.verdict).toBe('NO_PROOF');
    expect(proof.reason).toContain(NO_PROOF_MESSAGE);
  });

  it('NO_PROOF when the memo names a receipt nobody published', async () => {
    const world = await createWorld();
    const { txSignature } = await selfProvingPayment(world, hex32('c'));
    const proof = await provePayment(txSignature, { chain: world.chain, loadReceipt: async () => null });
    expect(proof.verdict).toBe('NO_PROOF');
    expect(proof.reason).toContain('no receipt with that id has been published');
  });

  it('NO_PROOF when the memo points at a real receipt belonging to a different payment', async () => {
    const world = await createWorld();
    const real = await selfProvingPayment(world, hex32('d'));
    // A second payment whose memo copies the first receipt's id: it borrows a pointer, not a proof.
    const { transactionBase64 } = await world.requestGate({ memo: formatReceiptMemo(real.receipt.id) });
    const copycat = await world.settle(transactionBase64);
    const proof = await provePayment(copycat, { chain: world.chain, loadReceipt: loaderFor(world) });
    expect(proof.verdict).toBe('NO_PROOF');
    expect(proof.reason).toContain('different transaction');
  });

  it('NOT_FOUND for a signature that is not on the cluster', async () => {
    const world = await createWorld();
    const proof = await provePayment('1'.repeat(88), { chain: world.chain, loadReceipt: loaderFor(world) });
    expect(proof.verdict).toBe('NOT_FOUND');
  });

  it('INVALID when the published receipt has been tampered with', async () => {
    const world = await createWorld();
    const { txSignature, receipt } = await selfProvingPayment(world, hex32('e'));
    const tampered = { ...receipt, offer: { ...receipt.offer, amount: '1' } };
    const proof = await provePayment(txSignature, { chain: world.chain, loadReceipt: async () => tampered });
    expect(proof.verdict).toBe('INVALID');
  });

  it('INVALID when the mandate was already revoked on-chain before the payment landed; PROVEN if revoked only afterwards', async () => {
    const world = await createWorld();
    const { txSignature } = await selfProvingPayment(world, hex32('f'));
    const now = world.clock.now;
    const before = await provePayment(txSignature, { chain: world.chain, loadReceipt: loaderFor(world), loadMandateState: async () => ({ revoked: true, revokedAt: now - 60 }) });
    expect(before.verdict).toBe('INVALID');
    const after = await provePayment(txSignature, { chain: world.chain, loadReceipt: loaderFor(world), loadMandateState: async () => ({ revoked: true, revokedAt: now + 60 }) });
    expect(after.verdict).toBe('PROVEN');
  });

  it('INVALID when a pinned instance key does not match', async () => {
    const world = await createWorld();
    const { txSignature } = await selfProvingPayment(world, hex32('9'));
    const proof = await provePayment(txSignature, { chain: world.chain, loadReceipt: loaderFor(world), trustedInstanceKeys: [world.keys.attacker.publicKey] });
    expect(proof.verdict).toBe('INVALID');
  });
});

describe('proveBlockedAttempt: a denial has no transaction, so the signed decision is the proof', () => {
  it('BLOCKED for a genuine signed DENY under a valid mandate', async () => {
    const world = await createWorld();
    const { outcome } = await world.requestGate({ payTo: world.keys.attacker.publicKey, amount: '10000' });
    const proof = proveBlockedAttempt({ mandate: world.mandate, decision: outcome.decision });
    expect(proof.verdict).toBe('BLOCKED');
    expect(proof.facts?.failedRules).toContain('PAYTO_ALLOWED');
  });

  it('INVALID for an ALLOW decision, a tampered decision, or garbage', async () => {
    const world = await createWorld();
    const allowed = await world.requestGate({ amount: '10000' });
    expect(proveBlockedAttempt({ mandate: world.mandate, decision: allowed.outcome.decision }).verdict).toBe('INVALID');

    const denied = await world.requestGate({ payTo: world.keys.attacker.publicKey, amount: '10000' });
    const tampered = { ...denied.outcome.decision, record: { ...denied.outcome.decision.record, failedRules: [] } };
    expect(proveBlockedAttempt({ mandate: world.mandate, decision: tampered }).verdict).toBe('INVALID');

    expect(proveBlockedAttempt({ nope: true }).verdict).toBe('INVALID');
  });
});
