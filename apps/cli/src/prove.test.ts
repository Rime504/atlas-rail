import { describe, expect, it } from 'vitest';
import { formatReceiptMemo } from '@atlas-rail/mandate';
import { hashResponseBody } from '@atlas-rail/receipt';
import { WORLD_ORG, World, createWorld } from '@atlas-rail/receipt/testing';
import { runProveTx } from './prove';

async function pay(world: World, memo: string | null) {
  const { outcome, transactionBase64 } = await world.requestGate({ memo });
  const txSignature = await world.settle(transactionBase64);
  await world.receiptService.issue(WORLD_ORG, {
    decisionId: outcome.decision.record.id,
    txSignature,
    response: { status: 200, bodySha256: hashResponseBody('{}'), contentType: 'application/json' },
  });
  await world.anchorService.run();
  return txSignature;
}

function deps(world: World) {
  return {
    chain: world.chain,
    loadReceipt: async (id: string) => (await world.receipts.get(WORLD_ORG, id))?.receipt ?? null,
    loadMandateState: async () => null,
  };
}

const base = { rpc: null, store: null, trustedKeys: [], json: false, color: false };

describe('atlas verify --tx', () => {
  it('prints PROVEN with who signed, the limits and the decision, and exits 0', async () => {
    const world = await createWorld();
    const tx = await pay(world, formatReceiptMemo(`rcp_${'4'.repeat(32)}`));
    const lines: string[] = [];
    const code = await runProveTx({ ...base, txSignature: tx }, deps(world), (l) => lines.push(l));
    const text = lines.join('\n');
    expect(code).toBe(0);
    expect(text).toContain('PROVEN');
    expect(text).toMatch(/Mandate signed by: owner .*approver .*agent /);
    expect(text).toContain('Decision: ALLOW');
  });

  it('prints NO PROOF for a payment without an Atlas Rail memo, and exits 1', async () => {
    const world = await createWorld();
    const tx = await pay(world, null);
    const lines: string[] = [];
    const code = await runProveTx({ ...base, txSignature: tx }, deps(world), (l) => lines.push(l));
    expect(code).toBe(1);
    expect(lines.join('\n')).toContain('This payment carries no Atlas Rail proof of permission.');
  });
});
