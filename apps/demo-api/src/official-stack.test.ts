import { afterEach, describe, expect, it } from 'vitest';
import { verifyReceipt } from '@atlas-rail/receipt';
import { WORLD_ORG, TEST_MINT, World, createWorld } from '@atlas-rail/receipt/testing';
import { AtlasFetch, GatedSignerAdapter, createAtlasFetch } from '@atlas-rail/x402';
import { ChainFacilitatorSigner } from './chain-signer';
import { createFacilitator, createFacilitatorApp } from './facilitator';
import { createDemoApi } from './server';
import { LocalGateClient, reservePort } from '@atlas-rail/x402/testkit';

/**
 * The compatibility proof: Atlas Rail's agent client pays a real x402 seller built with the official
 * `@x402/fastify` middleware, settled by the official `@x402/svm` exact-scheme facilitator (all of its
 * verification logic: instruction layout, memo, compute limits, fee-payer isolation, duplicate
 * settlement). Only the Solana cluster is in-memory (see docs/DEMO.md for the live-devnet run).
 */

const closers: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

async function stack(): Promise<{ world: World; atlasFetch: AtlasFetch; origin: string; events: string[]; signCalls: string[] }> {
  const apiPort = await reservePort();
  const facilitatorPort = await reservePort();
  const origin = `http://127.0.0.1:${apiPort}`;
  const world = await createWorld({
    mandate: { allowedResources: [`${origin}/research/*`], escalationResources: [`${origin}/inference/*`] },
  });

  const facilitator = createFacilitator(new ChainFacilitatorSigner(world.keys.facilitator, world.chain));
  const facilitatorApp = createFacilitatorApp(facilitator);
  await facilitatorApp.listen({ port: facilitatorPort, host: '127.0.0.1' });
  closers.push(() => facilitatorApp.close());

  const api = await createDemoApi({
    facilitatorUrl: `http://127.0.0.1:${facilitatorPort}`,
    payTo: world.keys.merchant.publicKey,
    mint: TEST_MINT,
  });
  await api.listen({ port: apiPort, host: '127.0.0.1' });
  closers.push(() => api.close());

  const signCalls: string[] = [];
  const inner = world.keys.agent;
  const original = inner.signTransaction.bind(inner);
  inner.signTransaction = async (tx: string) => {
    signCalls.push(tx);
    return original(tx);
  };
  const events: string[] = [];
  const atlasFetch = createAtlasFetch({
    mandateId: world.mandate.id,
    signer: new GatedSignerAdapter({ inner, trustedInstanceKeys: [world.keys.instance.publicKey], clock: () => world.clock.now }),
    gate: new LocalGateClient({ organizationId: WORLD_ORG, gate: world.gate, store: world.store, receiptService: world.receiptService }),
    chain: world.chain,
    clock: () => world.clock.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 2))),
    receiptRetryDelayMs: 5,
    escalation: { mode: 'wait', timeoutMs: 10_000, pollIntervalMs: 5 },
    onEvent: (e) => events.push(e.type),
  });
  return { world, atlasFetch, origin, events, signCalls };
}

describe('Atlas Rail agent client × official x402 seller and facilitator', () => {
  it('advertises the facilitator fee payer and devnet exact scheme to the seller', async () => {
    const { world, origin } = await stack();
    const res = await fetch(`${origin}/research/summary`);
    expect(res.status).toBe(402);
    const header = res.headers.get('payment-required');
    expect(header).toBeTruthy();
    const required = JSON.parse(Buffer.from(header!, 'base64').toString('utf8'));
    expect(required.x402Version).toBe(2);
    expect(required.accepts[0]).toMatchObject({
      scheme: 'exact',
      network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
      amount: '10000',
      asset: TEST_MINT,
      payTo: world.keys.merchant.publicKey,
    });
    expect(required.accepts[0].extra.feePayer).toBe(world.keys.facilitator.publicKey);
  });

  it('scene 2: the official facilitator verifies and settles the agent’s payment; the receipt verifies end to end', async () => {
    const { world, atlasFetch, origin, events } = await stack();
    const res = await atlasFetch(`${origin}/research/summary`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { topic: string };
    expect(body.topic).toContain('stablecoin');

    expect(world.chain.tokenBalance(world.keys.merchant.publicKey, TEST_MINT)).toBe(10_000n);
    expect(res.atlas?.receipt).not.toBeNull();
    expect(events).toEqual(['payment_required', 'gate_decision', 'payment_signed', 'settled', 'receipt_issued']);

    await world.anchorService.run();
    const stored = await world.receipts.get(WORLD_ORG, res.atlas!.receipt!.id);
    const result = await verifyReceipt(stored!.receipt, { chain: world.chain, requireAnchor: true, trustedInstanceKeys: [world.keys.instance.publicKey] });
    expect(result.checks.filter((c) => c.status === 'FAIL')).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it('scene 4: escalates the $40 inference job, a human approves, and the official facilitator settles it', async () => {
    const { world, atlasFetch, origin, events, signCalls } = await stack();
    const pending = atlasFetch(`${origin}/inference/heavy`);
    for (let i = 0; i < 400 && !events.includes('awaiting_approval'); i++) await new Promise((r) => setTimeout(r, 5));
    expect(events).toContain('awaiting_approval');
    expect(signCalls).toHaveLength(0);
    const [approval] = await world.store.approvals.list(WORLD_ORG, { status: 'PENDING', limit: 5 });
    await world.lifecycle.decideApproval(WORLD_ORG, approval.id, { approve: true, approver: { userId: 'usr_approver', role: 'APPROVER' }, comment: 'ok' });

    const res = await pending;
    expect(res.status).toBe(200);
    expect(res.atlas?.escalated).toBe(true);
    expect(res.atlas?.receipt?.decision.record.kind).toBe('APPROVED');
    expect(world.chain.tokenBalance(world.keys.merchant.publicKey, TEST_MINT)).toBe(40_000_000n);
  });

  it('scene 3 and 6: a denied or revoked payment never reaches the seller or the facilitator', async () => {
    const { world, atlasFetch, origin, signCalls } = await stack();
    expect((await atlasFetch(`${origin}/research/summary`)).status).toBe(200);
    await world.lifecycle.revoke(WORLD_ORG, world.mandate.id, { userId: 'usr_owner', reason: 'test' });
    await expect(atlasFetch(`${origin}/research/summary`)).rejects.toMatchObject({ code: 'MANDATE_DENIED' });
    expect(signCalls).toHaveLength(1);
    expect(world.chain.tokenBalance(world.keys.merchant.publicKey, TEST_MINT)).toBe(10_000n);
  });
});
