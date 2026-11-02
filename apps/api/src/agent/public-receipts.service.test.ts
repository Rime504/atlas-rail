import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SOLANA_DEVNET_CAIP2 } from '@atlas-rail/mandate';
import { TEST_MINT, TEST_ORIGIN, WORLD_ORG, createWorld } from '@atlas-rail/receipt/testing';
import { GatedSignerAdapter, VoucherAuthorizer } from '@atlas-rail/x402';
import { publishPublicReceipt } from './public-receipts.service';

const rows = new Map<string, { id: string; receiptHash: string; document: unknown; source: string }>();
let voucherSeq = 0;

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
  const authorizer = new VoucherAuthorizer({
    mandate: world.mandate,
    instance: world.keys.instance,
    signer: new GatedSignerAdapter({
      inner: world.keys.agent,
      trustedInstanceKeys: [world.keys.instance.publicKey],
      clock: () => world.clock.now,
    }),
    organizationId: WORLD_ORG,
    clock: () => world.clock.now,
  });
  const settledAmount = '2500';
  const cumulativeAmount = '12500';
  const allowed = await authorizer.requestVoucher({
    channelId: world.keys.facilitator.publicKey,
    cumulativeAmount,
    settledAmount,
    expiresAt: world.clock.now + 600 + voucherSeq++,
    recipient: world.keys.merchant.publicKey,
    resourceUrl: `${TEST_ORIGIN}/research/summary`,
    asset: TEST_MINT,
    network: SOLANA_DEVNET_CAIP2,
  });
  // Gate scores cumulative − settled. The signer runs only after that decision is ALLOW.
  expect(allowed.decision.record.decision).toBe('ALLOW');
  expect(allowed.deltaAmount).toBe('10000');
  expect(allowed.decision.record.offer.amount).toBe(allowed.deltaAmount);
  return authorizer.recordAllowedReceipt(allowed, { txSignature: `V${String(voucherSeq).padStart(87, 'V')}`, slot: 1 });
}

describe('publishPublicReceipt', () => {
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
