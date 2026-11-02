import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SOLANA_DEVNET_CAIP2, SIGNATURE_DOMAIN, domainMessage, sha256Hex, toBase58, verifyEd25519 } from '@atlas-rail/mandate';
import { NOW, TEST_MINT, TEST_ORIGIN, signedTestMandate, signers } from '@atlas-rail/mandate/testing';
import { World, createWorld } from '@atlas-rail/receipt/testing';
import { DevnetKeypairSigner, DevnetKeyring, decodeTransaction } from '@atlas-rail/solana';
import { GateAuthorizationRequiredError, GatedSignerAdapter, HttpSignerClient, VoucherAuthorizer, VoucherRequest, startSignerService } from '@atlas-rail/x402';
import { mandateVoucherKeys } from './voucher-keys';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

const messageBytes = (transactionBase64: string) => decodeTransaction(transactionBase64).message.serialize();

async function httpSigner(gated: GatedSignerAdapter) {
  const service = await startSignerService({ signer: gated, host: '127.0.0.1', port: 0 });
  closers.push(service.close);
  const client = await HttpSignerClient.connect({ url: service.url });
  return { service, client };
}

function seed(label: string): Uint8Array {
  const out = new Uint8Array(32);
  new TextEncoder().encode(label).forEach((b, i) => (out[i] = b));
  return out;
}

function request(overrides: Partial<VoucherRequest> = {}): VoucherRequest {
  return {
    channelId: signers.facilitator.publicKey,
    cumulativeAmount: '10000',
    expiresAt: NOW + 600,
    recipient: signers.merchant.publicKey,
    resourceUrl: `${TEST_ORIGIN}/research/summary`,
    asset: TEST_MINT,
    network: SOLANA_DEVNET_CAIP2,
    ...overrides,
  };
}

describe('signer routes', () => {
  it('serves the agent public key on /v1/public-key', async () => {
    const world: World = await createWorld();
    const gated = new GatedSignerAdapter({ inner: world.keys.agent, trustedInstanceKeys: [world.keys.instance.publicKey], clock: () => world.clock.now });
    const { service, client } = await httpSigner(gated);
    expect(client.publicKey).toBe(world.keys.agent.publicKey);
    expect(service.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('refuses arbitrary bytes on /v1/sign-message, including a transaction and a voucher', async () => {
    const world: World = await createWorld();
    const gated = new GatedSignerAdapter({ inner: world.keys.agent, trustedInstanceKeys: [world.keys.instance.publicKey], clock: () => world.clock.now });
    const { client } = await httpSigner(gated);
    const { transactionBase64 } = await world.requestGate({});
    const voucher = new Uint8Array(50);
    voucher[0] = 0x56;
    voucher[1] = 0x01;
    await expect(client.signMessage(messageBytes(transactionBase64))).rejects.toBeInstanceOf(GateAuthorizationRequiredError);
    await expect(client.signMessage(voucher)).rejects.toBeInstanceOf(GateAuthorizationRequiredError);
    await expect(client.signMessage(new TextEncoder().encode('hello'))).rejects.toBeInstanceOf(GateAuthorizationRequiredError);
    await expect(client.signMessage(domainMessage(SIGNATURE_DOMAIN.decision, 'a'.repeat(64)))).rejects.toBeInstanceOf(GateAuthorizationRequiredError);
    const allowed = domainMessage(SIGNATURE_DOMAIN.agentRequest, sha256Hex(new TextEncoder().encode('request')));
    expect(verifyEd25519(client.publicKey, allowed, toBase58(await client.signMessage(allowed)))).toBe(true);
  });

  it('signs a transaction on /v1/sign-authorized only when the authorisation covers those exact bytes', async () => {
    const origin = 'http://127.0.0.1';
    const world: World = await createWorld({ mandate: { allowedResources: [`${origin}/research/*`] } });
    const gated = new GatedSignerAdapter({ inner: world.keys.agent, trustedInstanceKeys: [world.keys.instance.publicKey], clock: () => world.clock.now });
    const { client } = await httpSigner(gated);
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

  it('signs a 50-byte voucher on /v1/sign-voucher only when verifyGateAuthorization matches', async () => {
    process.env.ATLAS_ALLOW_MOCK_SIGNER = 'true';
    const mandate = await signedTestMandate({ threshold: '1000000' });
    const agent = new DevnetKeypairSigner(seed('agent'));
    const gated = new GatedSignerAdapter({
      inner: agent,
      trustedInstanceKeys: [signers.instance.publicKey],
      clock: () => NOW,
    });
    const authorizer = new VoucherAuthorizer({
      mandate,
      instance: signers.instance,
      signer: gated,
      organizationId: 'org_test',
      clock: () => NOW,
      authorizationTtlSeconds: 60,
    });
    const { client } = await httpSigner(gated);
    const first = await authorizer.requestVoucher(request());
    const second = await authorizer.requestVoucher(request({ cumulativeAmount: '20000' }));
    expect(first.message).toHaveLength(50);
    expect(first.message[0]).toBe(0x56);
    expect(first.message[1]).toBe(0x01);

    await expect(client.signVoucher(first.message, null, null, null)).rejects.toBeInstanceOf(GateAuthorizationRequiredError);
    await expect(client.signVoucher(new TextEncoder().encode('hello'), first.authorization, first.decision, mandate)).rejects.toBeInstanceOf(
      GateAuthorizationRequiredError,
    );
    const wrongMagic = Uint8Array.from(first.message);
    wrongMagic[0] = 0x00;
    await expect(client.signVoucher(wrongMagic, first.authorization, first.decision, mandate)).rejects.toBeInstanceOf(GateAuthorizationRequiredError);
    await expect(client.signVoucher(second.message, first.authorization, first.decision, mandate)).rejects.toBeInstanceOf(GateAuthorizationRequiredError);

    const remote = await client.signVoucher(first.message, first.authorization, first.decision, mandate);
    expect(verifyEd25519(client.publicKey, first.message, toBase58(Buffer.from(remote.signatureBase64, 'base64')))).toBe(true);
  });

  it('mints a different voucher key for each mandate and signs mandate acceptance with that key', async () => {
    process.env.ATLAS_ALLOW_MOCK_SIGNER = 'true';
    const dir = tmpdir();
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `voucher-keys-${Date.now()}.json`);
    const keyring = DevnetKeyring.load(path);
    const world: World = await createWorld();
    const trusted = [world.keys.instance.publicKey];
    const gated = new GatedSignerAdapter({ inner: world.keys.agent, trustedInstanceKeys: trusted, clock: () => world.clock.now });
    const service = await startSignerService({ signer: gated, voucherKeys: mandateVoucherKeys(keyring, trusted) });
    closers.push(async () => {
      await service.close();
      rmSync(path, { force: true });
    });
    const mint = (mandateId: string) =>
      fetch(`${service.url}/v1/voucher-key`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mandateId }),
      }).then(async (response) => {
        expect(response.status).toBe(200);
        return response.json() as Promise<{ publicKey: string }>;
      });
    const first = await mint('mnd_AAAAAAAAAA');
    const second = await mint('mnd_BBBBBBBBBB');
    const again = await mint('mnd_AAAAAAAAAA');
    expect(first.publicKey).not.toBe(second.publicKey);
    expect(again.publicKey).toBe(first.publicKey);
    expect(first.publicKey).not.toBe(world.keys.agent.publicKey);
    expect(DevnetKeyring.load(path).publicKey('voucher:mnd_AAAAAAAAAA')).toBe(first.publicKey);
    const message = domainMessage(SIGNATURE_DOMAIN.mandateLink, sha256Hex(new TextEncoder().encode('mandate')));
    const signed = await fetch(`${service.url}/v1/sign-message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messageBase64: Buffer.from(message).toString('base64'), mandateId: 'mnd_AAAAAAAAAA' }),
    });
    const body = (await signed.json()) as { signatureBase64: string };
    expect(verifyEd25519(first.publicKey, message, toBase58(Buffer.from(body.signatureBase64, 'base64')))).toBe(true);
    const deleted = await fetch(`${service.url}/v1/voucher-key?mandateId=mnd_AAAAAAAAAA`, { method: 'DELETE' });
    expect(deleted.status).toBe(200);
    expect(keyring.publicKey('voucher:mnd_AAAAAAAAAA')).toBeNull();
    keyring.remove('voucher:mnd_BBBBBBBBBB');
    expect(DevnetKeyring.load(path).publicKey('voucher:mnd_BBBBBBBBBB')).toBeNull();
  });
});
