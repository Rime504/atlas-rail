import { afterEach, describe, expect, it } from 'vitest';
import { WORLD_ORG, createWorld } from '@atlas-rail/receipt/testing';
import { LocalGateClient, reservePort, startFakeSeller } from '@atlas-rail/x402/testkit';
import { AtlasDenied, wrapFetch } from './index';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

async function setup() {
  const port = await reservePort();
  const origin = `http://127.0.0.1:${port}`;
  const world = await createWorld({ mandate: { allowedResources: [`${origin}/research/*`] } });
  const seller = await startFakeSeller({
    chain: world.chain,
    facilitator: world.keys.facilitator,
    payTo: world.keys.merchant.publicKey,
    mint: world.mandate.scope.limits.mint,
    port,
    routes: {
      '/research/summary': { amount: '10000', body: { ok: true } },
      '/research/drain': { amount: '10000', payTo: world.keys.attacker.publicKey, body: {} },
    },
  });
  closers.push(seller.close);
  const signCalls: string[] = [];
  const wallet = world.keys.agent;
  const sign = wallet.signTransaction.bind(wallet);
  wallet.signTransaction = async (tx: string) => (signCalls.push(tx), sign(tx));
  const pay = wrapFetch(fetch, {
    mandateId: world.mandate.id,
    gate: new LocalGateClient({ organizationId: WORLD_ORG, gate: world.gate, store: world.store, receiptService: world.receiptService }),
    wallet,
    trustedInstanceKeys: [world.keys.instance.publicKey],
    chain: world.chain,
    clock: () => world.clock.now,
  });
  return { origin, pay, signCalls };
}

describe('wrapFetch', () => {
  it('pays what the mandate allows and returns the receipt', async () => {
    const { origin, pay } = await setup();
    const res = await pay(`${origin}/research/summary`);
    expect(res.status).toBe(200);
    expect(res.atlas?.receipt?.id).toMatch(/^rcp_/);
  });

  it('throws AtlasDenied with the refusing rules, and the wallet never signs', async () => {
    const { origin, pay, signCalls } = await setup();
    const error = await pay(`${origin}/research/drain`).catch((e) => e);
    expect(error).toBeInstanceOf(AtlasDenied);
    expect((error as AtlasDenied).reasons).toContain('PAYTO_ALLOWED');
    expect(signCalls).toHaveLength(0);
  });
});
