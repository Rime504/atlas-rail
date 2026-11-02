import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildDecisionRecord, evaluateGate, signDecision } from '@atlas-rail/mandate';
import { buildReceipt, hashResponseBody } from '@atlas-rail/receipt';
import { NOW, WORLD_ORG, createWorld, testOffer } from '@atlas-rail/receipt/testing';

/** Worker schedule in src/main.ts. Default stays five minutes; a positive env value overrides it. */
const DEFAULT_AGENT_ANCHOR_INTERVAL_MS = 5 * 60 * 1000;

describe('agent anchor interval', () => {
  const source = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');

  it('keeps the five minute default and repeats the anchor job on that interval', () => {
    expect(source).toContain(
      'const AGENT_ANCHOR_INTERVAL_MS = Number(process.env.AGENT_ANCHOR_INTERVAL_MS) > 0 ? Number(process.env.AGENT_ANCHOR_INTERVAL_MS) : 5 * 60 * 1000;',
    );
    expect(source).toContain('repeat: { every: AGENT_ANCHOR_INTERVAL_MS }');
    expect(DEFAULT_AGENT_ANCHOR_INTERVAL_MS).toBe(300_000);
  });
});

describe('agent anchor job', () => {
  it('anchors a voucher receipt with AnchorService the same way it anchors an exact payment receipt', async () => {
    const world = await createWorld();

    const exact = await world.requestGate({ amount: '10000' });
    expect(exact.outcome.decision.record.decision).toBe('ALLOW');
    const exactSignature = await world.settle(exact.transactionBase64);
    const exactReceipt = await world.receiptService.issue(WORLD_ORG, {
      decisionId: exact.outcome.decision.record.id,
      txSignature: exactSignature,
      response: { status: 200, bodySha256: hashResponseBody('{"summary":"ok"}'), contentType: 'application/json' },
    });

    // Same offer the voucher authorizer sends: delta as the amount, channel memo, no SPL simulation.
    const offer = testOffer({
      amount: '10000',
      payTo: world.keys.merchant.publicKey,
      feePayer: world.keys.facilitator.publicKey,
      memo: 'channel:vch_worker',
    });
    const context = {
      now: NOW,
      revoked: null,
      spend: { windowAutonomousBaseUnits: '0', totalBaseUnits: '0' },
      simulation: null,
      requireSimulation: false,
      approval: null,
    };
    const result = evaluateGate(world.mandate, offer, context);
    expect(result.decision).toBe('ALLOW');
    const decision = await signDecision(
      buildDecisionRecord({
        id: 'dec_voucher_worker',
        organizationId: WORLD_ORG,
        mandate: world.mandate,
        offer,
        result,
        context,
        request: null,
      }),
      world.keys.instance,
    );
    const voucherReceipt = await buildReceipt(
      {
        id: 'rcp_voucher_worker',
        mandate: world.mandate,
        decision,
        settlement: {
          txSignature: 'V'.repeat(88),
          network: offer.network,
          payer: world.keys.agent.publicKey,
          settledAt: NOW,
          slot: 1,
        },
        response: {
          status: 200,
          bodySha256: hashResponseBody('voucher'),
          contentType: 'application/vnd.payment-channels.voucher',
        },
        issuedAt: NOW,
      },
      world.keys.instance,
    );
    await world.receipts.insert({ organizationId: WORLD_ORG, receipt: voucherReceipt, createdAt: NOW, batchId: null });

    // processAgentAnchorJob is AnchorService.run() on whatever is still unanchored.
    const run = await world.anchorService.run();
    expect(run?.anchored).toBe(2);

    const storedExact = await world.receipts.get(WORLD_ORG, exactReceipt.id);
    const storedVoucher = await world.receipts.get(WORLD_ORG, voucherReceipt.id);
    expect(storedExact?.receipt.anchor?.mechanism).toBe('root');
    expect(storedVoucher?.receipt.response.contentType).toBe('application/vnd.payment-channels.voucher');
    expect(storedVoucher?.receipt.anchor?.mechanism).toBe('root');
    expect(storedVoucher?.receipt.anchor?.merkleRoot).toBe(storedExact?.receipt.anchor?.merkleRoot);
    expect(storedVoucher?.receipt.anchor?.batchId).toBe(run?.batch.id);
  });
});
