import { afterEach, describe, expect, it } from 'vitest';
import { SIGNATURE_DOMAIN, domainMessage, sha256Hex, toBase58, verifyEd25519 } from '@atlas-rail/mandate';
import { verifyReceipt } from '@atlas-rail/receipt';
import { WORLD_ORG, World, createWorld } from '@atlas-rail/receipt/testing';
import { decodeTransaction } from '@atlas-rail/solana';
import { createAtlasFetch } from './fetch';
import { GateAuthorizationRequiredError } from './errors';
import { GatedSignerAdapter, isAgentDomainMessage } from './gated-signer';
import { HttpSignerClient, startSignerService } from './signer-service';
import { LocalGateClient, reservePort, startFakeSeller } from './testkit';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

async function setup(options: { token?: string } = {}) {
  const port = await reservePort();
  const origin = `http://127.0.0.1:${port}`;
  const world: World = await createWorld({ mandate: { allowedResources: [`${origin}/research/*`] } });
  const gated = new GatedSignerAdapter({ inner: world.keys.agent, trustedInstanceKeys: [world.keys.instance.publicKey], clock: () => world.clock.now });
  const service = await startSignerService({ signer: gated, token: options.token });
  closers.push(service.close);
  const client = await HttpSignerClient.connect({ url: service.url, token: options.token });
  return { world, origin, port, service, client };
}

/** The bytes a Solana signature actually covers: the transaction's message. */
const messageBytes = (transactionBase64: string) => decodeTransaction(transactionBase64).message.serialize();

describe('signer service: the agent key behind HTTP', () => {
  it('serves the agent public key and binds to localhost', async () => {
    const { world, service, client } = await setup();
    expect(client.publicKey).toBe(world.keys.agent.publicKey);
    expect(service.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('signs the agent request and mandate acceptance forms, and the signatures verify', async () => {
    const { client } = await setup();
    for (const domain of [SIGNATURE_DOMAIN.agentRequest, SIGNATURE_DOMAIN.mandateLink]) {
      const message = domainMessage(domain, sha256Hex(new TextEncoder().encode(domain)));
      const signature = await client.signMessage(message);
      expect(verifyEd25519(client.publicKey, message, toBase58(signature))).toBe(true);
    }
  });

  it('refuses to sign a transaction message passed off as a "message", and any other bytes', async () => {
    const { world, origin, client } = await setup();
    const { transactionBase64 } = await world.requestGate({ amount: '10000', resourceUrl: `${origin}/research/summary` });
    await expect(client.signMessage(messageBytes(transactionBase64))).rejects.toBeInstanceOf(GateAuthorizationRequiredError);
    await expect(client.signMessage(new TextEncoder().encode('hello'))).rejects.toBeInstanceOf(GateAuthorizationRequiredError);
    await expect(client.signMessage(domainMessage(SIGNATURE_DOMAIN.decision, 'a'.repeat(64)))).rejects.toBeInstanceOf(GateAuthorizationRequiredError);
  });

  it('signs a transaction only with the authorisation that covers its exact bytes', async () => {
    const { world, origin, client } = await setup();
    const research = { amount: '10000', resourceUrl: `${origin}/research/summary` };
    const first = await world.requestGate(research);
    const second = await world.requestGate(research);
    await expect(client.signWithAuthorization(first.transactionBase64, null, null, null)).rejects.toBeInstanceOf(GateAuthorizationRequiredError);
    await expect(
      client.signWithAuthorization(second.transactionBase64, first.outcome.authorization, first.outcome.decision, first.outcome.mandate),
    ).rejects.toBeInstanceOf(GateAuthorizationRequiredError);
    const signed = await client.signWithAuthorization(first.transactionBase64, first.outcome.authorization, first.outcome.decision, first.outcome.mandate);
    expect(signed.signedBase64.length).toBeGreaterThan(0);
  });

  it('requires the bearer token when one is configured', async () => {
    const { service } = await setup({ token: 'demo-token' });
    await expect(HttpSignerClient.connect({ url: service.url })).rejects.toThrow(/HTTP 401/);
    await expect(HttpSignerClient.connect({ url: service.url, token: 'wrong-token' })).rejects.toThrow(/HTTP 401/);
    const res = await fetch(`${service.url}/v1/sign-message`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
  });

  it('end to end: an agent with only the signer URL pays within its mandate, and the receipt verifies', async () => {
    const { world, origin, port, client } = await setup();
    const seller = await startFakeSeller({
      chain: world.chain,
      facilitator: world.keys.facilitator,
      payTo: world.keys.merchant.publicKey,
      mint: world.mandate.scope.limits.mint,
      port,
      routes: { '/research/summary': { amount: '10000', body: { summary: 'ok' } } },
    });
    closers.push(seller.close);
    const atlasFetch = createAtlasFetch({
      mandateId: world.mandate.id,
      signer: client,
      gate: new LocalGateClient({ organizationId: WORLD_ORG, gate: world.gate, store: world.store, receiptService: world.receiptService }),
      chain: world.chain,
      clock: () => world.clock.now,
      receiptRetryDelayMs: 0,
    });
    const res = await atlasFetch(`${origin}/research/summary`);
    expect(res.status).toBe(200);
    expect(res.atlas?.receipt).not.toBeNull();
    const verification = await verifyReceipt(res.atlas!.receipt!, { chain: world.chain });
    expect(verification.pass).toBe(true);
  });
});

describe('GatedSignerAdapter.signMessage — no signing oracle', () => {
  it('refuses transaction message bytes in-process too', async () => {
    const world = await createWorld();
    const gated = new GatedSignerAdapter({ inner: world.keys.agent, trustedInstanceKeys: [world.keys.instance.publicKey], clock: () => world.clock.now });
    const { transactionBase64 } = await world.requestGate({});
    await expect(gated.signMessage(messageBytes(transactionBase64))).rejects.toBeInstanceOf(GateAuthorizationRequiredError);
  });

  it('accepts exactly the agent domain forms', () => {
    const hash = 'b'.repeat(64);
    expect(isAgentDomainMessage(domainMessage(SIGNATURE_DOMAIN.agentRequest, hash))).toBe(true);
    expect(isAgentDomainMessage(domainMessage(SIGNATURE_DOMAIN.mandateLink, hash))).toBe(true);
    expect(isAgentDomainMessage(new TextEncoder().encode(`${SIGNATURE_DOMAIN.agentRequest}\n${hash}\n`))).toBe(false);
    expect(isAgentDomainMessage(new TextEncoder().encode(`${SIGNATURE_DOMAIN.agentRequest}\n${hash.toUpperCase()}`))).toBe(false);
    expect(isAgentDomainMessage(domainMessage(SIGNATURE_DOMAIN.receipt, hash))).toBe(false);
    expect(isAgentDomainMessage(new Uint8Array([0x80, 1, 0, 1]))).toBe(false);
  });
});
