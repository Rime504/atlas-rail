import { describe, expect, it } from 'vitest';
import { formatReceiptMemo } from '@atlas-rail/mandate';
import { hashResponseBody } from '@atlas-rail/receipt';
import { WORLD_ORG, World, createWorld } from '@atlas-rail/receipt/testing';
import { BlobBackend, MAX_RECORD_BYTES, loadPublished, publishBlockedAttempt, publishReceipt } from './receipt-store';

function memoryBackend(): BlobBackend & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async read(p) {
      return files.get(p) ?? null;
    },
    async create(p, body) {
      if (files.has(p)) throw new Error('exists');
      files.set(p, body);
    },
  };
}

async function anchoredReceipt(world: World, anchor = true) {
  const id = `rcp_${'7'.repeat(32)}`;
  const { outcome, transactionBase64 } = await world.requestGate({ memo: formatReceiptMemo(id) });
  const txSignature = await world.settle(transactionBase64);
  const receipt = await world.receiptService.issue(WORLD_ORG, {
    decisionId: outcome.decision.record.id,
    txSignature,
    response: { status: 200, bodySha256: hashResponseBody('{}'), contentType: 'application/json' },
  });
  if (anchor) await world.anchorService.run();
  return (await world.receipts.get(WORLD_ORG, receipt.id))!.receipt;
}

describe('public receipt store', () => {
  it('publishes a receipt only once every check passes, including the on-chain anchor and settlement', async () => {
    const world = await createWorld();
    const backend = memoryBackend();
    const receipt = await anchoredReceipt(world);
    const result = await publishReceipt(receipt, { chain: world.chain, backend });
    expect(result.stored).toBe(true);
    expect(await loadPublished('receipt', receipt.id, backend)).toMatchObject({ id: receipt.id, receiptHash: receipt.receiptHash });
  });

  it('refuses an un-anchored receipt (a SKIP is not a PASS) and anything tampered with', async () => {
    const world = await createWorld();
    const backend = memoryBackend();
    const unanchored = await anchoredReceipt(world, false);
    expect((await publishReceipt(unanchored, { chain: world.chain, backend })).stored).toBe(false);
    const tampered = { ...unanchored, offer: { ...unanchored.offer, amount: '1' } };
    expect((await publishReceipt(tampered, { chain: world.chain, backend })).stored).toBe(false);
    expect(backend.files.size).toBe(0);
  });

  it('is idempotent for the identical record and never overwrites a published id with a different one', async () => {
    const world = await createWorld();
    const backend = memoryBackend();
    const receipt = await anchoredReceipt(world);
    expect((await publishReceipt(receipt, { chain: world.chain, backend })).stored).toBe(true);
    expect((await publishReceipt(receipt, { chain: world.chain, backend })).stored).toBe(true);
    backend.files.set(`receipts/${receipt.id}.json`, JSON.stringify({ ...receipt, receiptHash: 'something-else' }));
    const again = await publishReceipt(receipt, { chain: world.chain, backend });
    expect(again).toMatchObject({ stored: false });
  });

  it('caps record size', async () => {
    const backend = memoryBackend();
    const world = await createWorld();
    const huge = { padding: 'x'.repeat(MAX_RECORD_BYTES + 1) };
    expect((await publishReceipt(huge, { chain: world.chain, backend })).reason).toContain('exceeds');
  });

  it('publishes a genuine blocked attempt (signed DENY) and refuses an ALLOW', async () => {
    const world = await createWorld();
    const backend = memoryBackend();
    const denied = await world.requestGate({ payTo: world.keys.attacker.publicKey, amount: '10000' });
    expect((await publishBlockedAttempt({ mandate: world.mandate, decision: denied.outcome.decision }, { backend })).stored).toBe(true);
    const allowed = await world.requestGate({ amount: '10000' });
    expect((await publishBlockedAttempt({ mandate: world.mandate, decision: allowed.outcome.decision }, { backend })).stored).toBe(false);
  });

  it('never reads outside its own prefixes, whatever id it is handed', async () => {
    const backend = memoryBackend();
    backend.files.set('secret.json', '{}');
    for (const id of ['../secret', 'rcp_../../secret', 'secret', '', 'rcp_short']) {
      expect(await loadPublished('receipt', id, backend)).toBeNull();
    }
  });
});
