import { describe, expect, it } from 'vitest';
import { hashOffer, verifyDecisionMatchesScope } from '@atlas-rail/mandate';
import { WORLD_ORG, World, createWorld, testOffer } from './testing';
import { BoundReceipt, verifyReceipt } from './receipt';
import { hashResponseBody } from './service';

async function payOnce(world: World, amount = '10000') {
  const { outcome, transactionBase64, offer } = await world.requestGate({ amount });
  expect(outcome.decision.record.decision).toBe('ALLOW');
  const txSignature = await world.settle(transactionBase64);
  const receipt = await world.receiptService.issue(WORLD_ORG, {
    decisionId: outcome.decision.record.id,
    txSignature,
    response: { status: 200, bodySha256: hashResponseBody('{"summary":"ok"}'), contentType: 'application/json' },
  });
  return { receipt, outcome, txSignature, offer };
}

const byId = (checks: { id: string; status: string }[], id: string) => checks.find((c) => c.id === id)?.status;

describe('receipt issuance', () => {
  it('issues a receipt for a settled ALLOW decision and marks the spend settled', async () => {
    const world = await createWorld();
    const { receipt, txSignature } = await payOnce(world);
    expect(receipt.settlement.txSignature).toBe(txSignature);
    expect(receipt.settlement.payer).toBe(world.keys.agent.publicKey);
    expect(receipt.hashes.offerHash).toBe(hashOffer(receipt.offer));
    expect(world.chain.tokenBalance(world.keys.merchant.publicKey, receipt.offer.asset)).toBe(10000n);
    const audit = (world.store.audit as unknown as { entries: { action: string }[] }).entries.map((e) => e.action);
    expect(audit).toContain('AGENT_RECEIPT_ISSUED');
  });

  it('is idempotent per decision and rejects a different transaction for the same decision', async () => {
    const world = await createWorld();
    const { receipt, outcome, txSignature } = await payOnce(world);
    const again = await world.receiptService.issue(WORLD_ORG, {
      decisionId: outcome.decision.record.id,
      txSignature,
      response: receipt.response,
    });
    expect(again.id).toBe(receipt.id);
    await expect(
      world.receiptService.issue(WORLD_ORG, { decisionId: outcome.decision.record.id, txSignature: 'x'.repeat(88), response: receipt.response }),
    ).rejects.toMatchObject({ code: 'NONCE_REUSED' });
  });

  it('refuses receipts for DENY decisions, unknown decisions, and unsettled or mismatching transactions', async () => {
    const world = await createWorld();
    const denied = await world.requestGate({ payTo: world.keys.attacker.publicKey, amount: '10000' });
    expect(denied.outcome.decision.record.decision).toBe('DENY');
    const response = { status: 200, bodySha256: hashResponseBody('x'), contentType: null };
    await expect(world.receiptService.issue(WORLD_ORG, { decisionId: denied.outcome.decision.record.id, txSignature: 'a'.repeat(88), response })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(world.receiptService.issue(WORLD_ORG, { decisionId: 'dec_nope', txSignature: 'a'.repeat(88), response })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const allowed = await world.requestGate({ amount: '10000' });
    // No settlement was ever sent: the cluster has no such transaction.
    await expect(world.receiptService.issue(WORLD_ORG, { decisionId: allowed.outcome.decision.record.id, txSignature: 'b'.repeat(88), response })).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('refuses to attest a settlement that paid a different amount than the decision allowed', async () => {
    const world = await createWorld();
    const cheap = await world.requestGate({ amount: '10000' });
    const other = await world.requestGate({ amount: '20000' });
    const sigOfOther = await world.settle(other.transactionBase64);
    await expect(
      world.receiptService.issue(WORLD_ORG, {
        decisionId: cheap.outcome.decision.record.id,
        txSignature: sigOfOther,
        response: { status: 200, bodySha256: hashResponseBody('x'), contentType: null },
      }),
    ).rejects.toThrow(/Settlement not verified/);
  });
});

describe('verifyReceipt', () => {
  it('passes every check for an anchored receipt, including the on-chain anchor and settlement', async () => {
    const world = await createWorld();
    await payOnce(world);
    const { receipt } = await payOnce(world, '20000');
    const run = await world.anchorService.run();
    expect(run?.anchored).toBe(2);
    const stored = await world.receipts.get(WORLD_ORG, receipt.id);
    const result = await verifyReceipt(stored!.receipt, { chain: world.chain, trustedInstanceKeys: [world.keys.instance.publicKey], requireAnchor: true });
    expect(result.checks.filter((c) => c.status === 'FAIL')).toEqual([]);
    expect(result.pass).toBe(true);
    for (const id of ['SCHEMA', 'RECEIPT_HASH', 'INSTANCE_SIGNATURE', 'MANDATE_CHAIN', 'DECISION_SIGNATURE', 'DECISION_MATCHES_SCOPE', 'DECISION_ALLOWED', 'ANCHOR_MERKLE', 'ANCHOR_ONCHAIN', 'SETTLEMENT_ONCHAIN']) {
      expect(byId(result.checks, id), id).toBe('PASS');
    }
    expect(world.chain.memos.some((m) => m.startsWith('atlasrail:anchor:v1:'))).toBe(true);
  });

  it('works fully offline (no chain): on-chain checks are SKIPPED, everything else PASSes', async () => {
    const world = await createWorld();
    const { receipt } = await payOnce(world);
    await world.anchorService.run();
    const stored = await world.receipts.get(WORLD_ORG, receipt.id);
    const result = await verifyReceipt(stored!.receipt);
    expect(result.pass).toBe(true);
    expect(byId(result.checks, 'ANCHOR_MERKLE')).toBe('PASS');
    expect(byId(result.checks, 'ANCHOR_ONCHAIN')).toBe('SKIP');
    expect(byId(result.checks, 'SETTLEMENT_ONCHAIN')).toBe('SKIP');
  });

  it('un-anchored receipts SKIP the anchor checks, or FAIL when an anchor is required', async () => {
    const world = await createWorld();
    const { receipt } = await payOnce(world);
    expect(byId((await verifyReceipt(receipt)).checks, 'ANCHOR_MERKLE')).toBe('SKIP');
    expect((await verifyReceipt(receipt, { requireAnchor: true })).pass).toBe(false);
  });

  it('detects tampering with each bound field', async () => {
    const world = await createWorld();
    await payOnce(world);
    const { receipt } = await payOnce(world, '20000'); // two leaves, so the Merkle proof is non-trivial
    await world.anchorService.run();
    const anchored = (await world.receipts.get(WORLD_ORG, receipt.id))!.receipt;
    const clone = () => JSON.parse(JSON.stringify(anchored)) as BoundReceipt;

    const cases: Array<[string, (r: BoundReceipt) => void, string]> = [
      ['amount edited', (r) => { r.offer.amount = '1'; }, 'RECEIPT_HASH'],
      ['tx signature swapped', (r) => { r.settlement.txSignature = 'z'.repeat(88); }, 'RECEIPT_HASH'],
      ['response body hash swapped', (r) => { r.response.bodySha256 = 'f'.repeat(64); }, 'RECEIPT_HASH'],
      ['timestamp moved', (r) => { r.issuedAt += 1; }, 'RECEIPT_HASH'],
      ['mandate scope widened', (r) => { r.mandate.scope.limits.maxTotal = '999999999999'; }, 'MANDATE_CHAIN'],
      ['decision flipped to ALLOW from something else', (r) => { r.decision.record.reason = 'edited'; }, 'DECISION_SIGNATURE'],
      ['merkle proof damaged', (r) => { r.anchor!.proof = []; }, 'ANCHOR_MERKLE'],
    ];
    for (const [name, mutate, expectedFail] of cases) {
      const copy = clone();
      mutate(copy);
      const result = await verifyReceipt(copy, { chain: world.chain });
      expect(result.pass, name).toBe(false);
      expect(byId(result.checks, expectedFail), `${name} -> ${expectedFail}`).toBe('FAIL');
    }
  });

  it('detects a forged receipt signed by some other key, and a wrong pinned key', async () => {
    const world = await createWorld();
    const { receipt } = await payOnce(world);
    const forged = { ...receipt, instance: { publicKey: world.keys.attacker.publicKey, signature: receipt.instance.signature } };
    expect(byId((await verifyReceipt(forged)).checks, 'INSTANCE_SIGNATURE')).toBe('FAIL');
    const pinned = await verifyReceipt(receipt, { trustedInstanceKeys: [world.keys.attacker.publicKey] });
    expect(byId(pinned.checks, 'INSTANCE_SIGNATURE')).toBe('FAIL');
  });

  it('fails the anchor check if the memo on-chain does not match (wrong signer or wrong root)', async () => {
    const world = await createWorld();
    const { receipt } = await payOnce(world);
    await world.anchorService.run();
    const anchored = (await world.receipts.get(WORLD_ORG, receipt.id))!.receipt;
    const wrongRoot = JSON.parse(JSON.stringify(anchored)) as BoundReceipt;
    wrongRoot.anchor!.txSignature = anchored.settlement.txSignature; // a real tx, but not the anchor memo
    const result = await verifyReceipt(wrongRoot, { chain: world.chain });
    expect(byId(result.checks, 'ANCHOR_ONCHAIN')).toBe('FAIL');
  });

  it('fails settlement verification when the on-chain transfer was made by a different key', async () => {
    const world = await createWorld();
    const { receipt } = await payOnce(world);
    const lie = JSON.parse(JSON.stringify(receipt)) as BoundReceipt;
    lie.mandate.agent.publicKey = world.keys.attacker.publicKey;
    const result = await verifyReceipt(lie, { chain: world.chain });
    expect(result.pass).toBe(false);
  });

  it('rejects junk input without throwing', async () => {
    for (const junk of [null, undefined, 3, 'x', {}, { type: 'atlasrail.bound-receipt' }]) {
      const result = await verifyReceipt(junk);
      expect(result.pass).toBe(false);
      expect(result.checks[0].id).toBe('SCHEMA');
    }
  });

  it('the recorded decision reproduces from the mandate scope', async () => {
    const world = await createWorld();
    const { receipt } = await payOnce(world);
    expect(verifyDecisionMatchesScope(receipt.mandate, receipt.decision).ok).toBe(true);
    expect(receipt.offer).toEqual(testOffer({ payTo: world.keys.merchant.publicKey, feePayer: world.keys.facilitator.publicKey, amount: '10000' }));
  });
});

describe('anchoring', () => {
  it('returns null when nothing is pending and anchors only new receipts on later runs', async () => {
    const world = await createWorld();
    expect(await world.anchorService.run()).toBeNull();
    await payOnce(world);
    const first = await world.anchorService.run();
    expect(first?.anchored).toBe(1);
    expect(await world.anchorService.run()).toBeNull();
    await payOnce(world, '20000');
    const second = await world.anchorService.run();
    expect(second?.anchored).toBe(1);
    expect(second?.batch.merkleRoot).not.toBe(first?.batch.merkleRoot);
  });

  it('a failed anchor leaves receipts pending for retry and records a FAILED batch', async () => {
    const world = await createWorld();
    await payOnce(world);
    const original = world.chain.sendAndConfirm.bind(world.chain);
    world.chain.sendAndConfirm = async () => {
      throw new Error('rpc unavailable');
    };
    await expect(world.anchorService.run()).rejects.toThrow('rpc unavailable');
    expect((await world.receipts.listBatches(5))[0].status).toBe('FAILED');
    expect((await world.receipts.listUnanchored(10)).length).toBe(1);
    world.chain.sendAndConfirm = original;
    expect((await world.anchorService.run())?.anchored).toBe(1);
  });
});
