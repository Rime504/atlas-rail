import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashResponseBody } from '@atlas-rail/receipt';
import { WORLD_ORG, createWorld } from '@atlas-rail/receipt/testing';
import { publishPublicReceipt } from './public-receipts.service';

const rows = new Map<string, { id: string; receiptHash: string; document: unknown; source: string }>();

vi.mock('@atlas-rail/database', () => ({
  prisma: {
    publicReceipt: {
      findUnique: vi.fn(async ({ where: { id } }: { where: { id: string } }) => rows.get(id) ?? null),
      create: vi.fn(async ({ data }: { data: { id: string; receiptHash: string; document: unknown; source: string } }) => {
        rows.set(data.id, data);
        return data;
      }),
    },
  },
}));

async function validReceipt() {
  const world = await createWorld();
  const { outcome, transactionBase64 } = await world.requestGate({ amount: '10000' });
  const txSignature = await world.settle(transactionBase64);
  return world.receiptService.issue(WORLD_ORG, {
    decisionId: outcome.decision.record.id,
    txSignature,
    response: { status: 200, bodySha256: hashResponseBody('{}'), contentType: 'application/json' },
  });
}

describe('publishPublicReceipt', () => {
  // Each createWorld() restarts its own id counter from 1, so receipts from different tests can
  // share an id (rcp_000001) despite being unrelated — this mock's store must not let that masquerade
  // as a real collision across tests.
  beforeEach(() => rows.clear());

  it('accepts a well-formed, internally-consistent receipt and stores it', async () => {
    const receipt = await validReceipt();
    const result = await publishPublicReceipt(receipt, 'demo-agent');
    expect(result.accepted).toBe(true);
    expect(rows.get(receipt.id)?.receiptHash).toBe(receipt.receiptHash);
  });

  it('rejects garbage input without throwing', async () => {
    const result = await publishPublicReceipt({ not: 'a receipt' }, 'playground');
    expect(result.accepted).toBe(false);
    expect(result.reason).toContain('SCHEMA');
  });

  it('rejects a receipt whose hash has been tampered with', async () => {
    const receipt = await validReceipt();
    const tampered = { ...receipt, offer: { ...receipt.offer, amount: '999999999' } };
    const result = await publishPublicReceipt(tampered, 'demo-agent');
    expect(result.accepted).toBe(false);
    expect(result.reason).toContain('RECEIPT_HASH');
  });

  it('is idempotent for a retried publish of the exact same receipt', async () => {
    const receipt = await validReceipt();
    expect((await publishPublicReceipt(receipt, 'demo-agent')).accepted).toBe(true);
    expect((await publishPublicReceipt(receipt, 'demo-agent')).accepted).toBe(true);
  });

  it('never overwrites an existing id with a different receipt (replay / collision protection)', async () => {
    const first = await validReceipt();
    await publishPublicReceipt(first, 'demo-agent');
    const second = await validReceipt();
    const impostor = { ...second, id: first.id };
    const result = await publishPublicReceipt(impostor, 'playground');
    expect(result.accepted).toBe(false);
    expect(result.reason).toContain('already used');
    expect(rows.get(first.id)?.receiptHash).toBe(first.receiptHash); // untouched
  });
});
