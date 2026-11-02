import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SIGNATURE_DOMAIN, SOLANA_DEVNET_CAIP2, domainMessage, sha256Hex, toBase58, verifyEd25519 } from '@atlas-rail/mandate';
import { NOW, TEST_MINT, TEST_ORIGIN, signedTestMandate, signers } from '@atlas-rail/mandate/testing';
import { verifyReceipt } from '@atlas-rail/receipt';
import { World, createWorld } from '@atlas-rail/receipt/testing';
import { DEFAULT_MANDATE_PROGRAM_ID, buildCreateMandateTransaction, decodeTransaction } from '@atlas-rail/solana';
import { GateAuthorizationRequiredError, MandateDeniedError, UnsupportedPaymentError } from './errors';
import { GatedSignerAdapter, isAgentDomainMessage } from './gated-signer';
import { HttpSignerClient, startSignerService } from './signer-service';
import { reservePort } from './testkit';
import { reservePort } from './testkit';
import { VoucherAuthorizer, encodeVoucherMessage } from './voucher';

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

const web3 = createRequire(join(__dirname, '../../solana/package.json'))('@solana/web3.js') as typeof import('@solana/web3.js');

function createMandateTx(world: World, overrides: { owner?: string; programId?: string } = {}): string {
  return buildCreateMandateTransaction({
    programId: overrides.programId ?? DEFAULT_MANDATE_PROGRAM_ID,
    mandateHash: new Uint8Array(32).fill(7),
    gateAuthority: world.keys.instance.publicKey,
    mint: TEST_MINT,
    maxPerPayment: 10n,
    maxPerWindow: 10n,
    windowSeconds: 3600n,
    maxTotal: 10n,
    escalationThreshold: 10n,
    notBefore: 0n,
    expiresAt: 10n,
    owner: overrides.owner ?? world.keys.owner.publicKey,
    approver: world.keys.approver.publicKey,
    agent: world.keys.agent.publicKey,
    recentBlockhash: '11111111111111111111111111111111',
  });
}

async function postMandateCreate(url: string, transactionBase64: string) {
  const response = await fetch(`${url}/v1/sign-mandate-create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transactionBase64 }),
  });
  return { status: response.status, json: (await response.json()) as { signedBase64?: string } };
}

const voucherBytes = () =>
  encodeVoucherMessage({ channelId: signers.facilitator.publicKey, cumulativeAmount: 10_000n, expiresAt: BigInt(NOW + 600) });

describe('signer service: network exposure', () => {
  it('refuses to listen beyond this machine without a token', async () => {
    const world: World = await createWorld();
    const gated = new GatedSignerAdapter({ inner: world.keys.agent, trustedInstanceKeys: [world.keys.instance.publicKey] });
    await expect(startSignerService({ signer: gated, host: '0.0.0.0', port: 0 })).rejects.toThrow('bearer token');
    const withToken = await startSignerService({ signer: gated, host: '0.0.0.0', port: 0, token: 't'.repeat(32) });
    closers.push(withToken.close);
  });
});

describe('signer service: co-signing create_mandate', () => {
  it('signs the agent slot of one create_mandate that names this key', async () => {
    const { world, service } = await setup();
    const { status, json } = await postMandateCreate(service.url, createMandateTx(world));
    expect(status).toBe(200);
    const tx = decodeTransaction(json.signedBase64!);
    const index = tx.message.staticAccountKeys.findIndex((key) => key.toBase58() === world.keys.agent.publicKey);
    expect(verifyEd25519(world.keys.agent.publicKey, tx.message.serialize(), toBase58(tx.signatures[index]))).toBe(true);
  });

  it('refuses another program, the agent as fee payer, and an extra instruction', async () => {
    const { world, service } = await setup();
    expect((await postMandateCreate(service.url, createMandateTx(world, { programId: world.keys.attacker.publicKey }))).status).toBe(403);
    expect((await postMandateCreate(service.url, createMandateTx(world, { owner: world.keys.agent.publicKey }))).status).toBe(403);
    const tx = decodeTransaction(createMandateTx(world));
    const decompiled = web3.TransactionMessage.decompile(tx.message);
    decompiled.instructions.push(
      web3.SystemProgram.transfer({
        fromPubkey: new web3.PublicKey(world.keys.agent.publicKey),
        toPubkey: new web3.PublicKey(world.keys.attacker.publicKey),
        lamports: 1,
      }),
    );
    const extra = new web3.VersionedTransaction(decompiled.compileToV0Message());
    expect((await postMandateCreate(service.url, Buffer.from(extra.serialize()).toString('base64'))).status).toBe(403);
  });
});

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

  it('refuses to sign a voucher passed off as a "message", and any other bytes', async () => {
    const { client } = await setup();
    await expect(client.signMessage(voucherBytes())).rejects.toBeInstanceOf(GateAuthorizationRequiredError);
    await expect(client.signMessage(new TextEncoder().encode('hello'))).rejects.toBeInstanceOf(GateAuthorizationRequiredError);
    await expect(client.signMessage(domainMessage(SIGNATURE_DOMAIN.decision, 'a'.repeat(64)))).rejects.toBeInstanceOf(GateAuthorizationRequiredError);
  });

  it('signs a voucher only with the authorisation that covers its exact bytes', async () => {
    const { world, client } = await setup();
    const signer = new GatedSignerAdapter({ inner: world.keys.agent, trustedInstanceKeys: [world.keys.instance.publicKey], clock: () => world.clock.now });
    const mandate = await signedTestMandate();
    const authorizer = new VoucherAuthorizer({
      mandate,
      instance: signers.instance,
      signer,
      organizationId: 'org_test',
      clock: () => NOW,
    });
    const first = await authorizer.requestVoucher({
      channelId: signers.facilitator.publicKey,
      cumulativeAmount: '10000',
      expiresAt: NOW + 600,
      recipient: signers.merchant.publicKey,
      resourceUrl: `${TEST_ORIGIN}/research/summary`,
      asset: TEST_MINT,
      network: SOLANA_DEVNET_CAIP2,
    });
    const other = encodeVoucherMessage({ channelId: signers.owner.publicKey, cumulativeAmount: 10_000n, expiresAt: BigInt(NOW + 700) });
    await expect(client.signVoucher(first.message, null, null, null)).rejects.toBeInstanceOf(GateAuthorizationRequiredError);
    await expect(client.signVoucher(other, first.authorization, first.decision, mandate)).rejects.toBeInstanceOf(GateAuthorizationRequiredError);
    expect(first.deltaAmount).toBe('10000');
    const signed = await client.signVoucher(first.message, first.authorization, first.decision, mandate);
    expect(verifyEd25519(client.publicKey, first.message, toBase58(Buffer.from(signed.signatureBase64, 'base64')))).toBe(true);
    await expect(
      authorizer.requestVoucher({
        channelId: signers.facilitator.publicKey,
        cumulativeAmount: '10000',
        expiresAt: NOW + 600,
        recipient: signers.merchant.publicKey,
        resourceUrl: `${TEST_ORIGIN}/research/summary`,
        asset: TEST_MINT,
        network: SOLANA_DEVNET_CAIP2,
      }),
    ).rejects.toBeInstanceOf(UnsupportedPaymentError);
    expect(authorizer.budgetSnapshot().totalBaseUnits).toBe('10000');
  });

  it('requires the bearer token when one is configured', async () => {
    const { service } = await setup({ token: 'demo-token' });
    await expect(HttpSignerClient.connect({ url: service.url })).rejects.toThrow(/HTTP 401/);
    await expect(HttpSignerClient.connect({ url: service.url, token: 'wrong-token' })).rejects.toThrow(/HTTP 401/);
    const res = await fetch(`${service.url}/v1/sign-message`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
  });

  it('end to end: an agent with only the signer URL signs an allowed voucher, and the receipt verifies', async () => {
    const { world, client } = await setup();
    const mandate = await signedTestMandate();
    const signer = new GatedSignerAdapter({ inner: world.keys.agent, trustedInstanceKeys: [world.keys.instance.publicKey], clock: () => NOW });
    let signs = 0;
    vi.spyOn(signer, 'signVoucherWithAuthorization').mockImplementation(async (message, authorization, decision, signedMandate) => {
      signs += 1;
      const signed = await client.signVoucher(message, authorization, decision, signedMandate);
      return { signature: Buffer.from(signed.signatureBase64, 'base64') };
    });
    const authorizer = new VoucherAuthorizer({
      mandate,
      instance: signers.instance,
      signer,
      organizationId: 'org_test',
      clock: () => NOW,
    });
    const denied = await authorizer
      .requestVoucher({
        channelId: signers.facilitator.publicKey,
        cumulativeAmount: '10000',
        expiresAt: NOW + 600,
        recipient: signers.attacker.publicKey,
        resourceUrl: `${TEST_ORIGIN}/research/summary`,
        asset: TEST_MINT,
        network: SOLANA_DEVNET_CAIP2,
      })
      .catch((e) => e);
    expect(denied).toBeInstanceOf(MandateDeniedError);
    expect(signs).toBe(0);
    const allowed = await authorizer.requestVoucher({
      channelId: signers.facilitator.publicKey,
      cumulativeAmount: '15000',
      settledAmount: '5000',
      expiresAt: NOW + 600,
      recipient: signers.merchant.publicKey,
      resourceUrl: `${TEST_ORIGIN}/research/summary`,
      asset: TEST_MINT,
      network: SOLANA_DEVNET_CAIP2,
    });
    expect(allowed.deltaAmount).toBe('10000');
    expect(allowed.message).toHaveLength(50);
    expect(signs).toBe(1);
    const receipt = await authorizer.recordAllowedReceipt(allowed, { txSignature: 'A'.repeat(64), slot: 1 });
    expect(verifyEd25519(client.publicKey, allowed.message, toBase58(allowed.signature))).toBe(true);
    const verification = await verifyReceipt(receipt, { trustedInstanceKeys: [signers.instance.publicKey] });
    expect(verification.pass).toBe(true);
  });
});

describe('GatedSignerAdapter.signMessage — no signing oracle', () => {
  it('refuses voucher bytes in-process too', async () => {
    const world = await createWorld();
    const gated = new GatedSignerAdapter({ inner: world.keys.agent, trustedInstanceKeys: [world.keys.instance.publicKey], clock: () => world.clock.now });
    await expect(gated.signMessage(voucherBytes())).rejects.toBeInstanceOf(GateAuthorizationRequiredError);
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
