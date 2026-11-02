import { afterEach, describe, expect, it } from 'vitest';
import { SOLANA_DEVNET_CAIP2, hashMandate, toBase58, verifyEd25519 } from '@atlas-rail/mandate';
import { NOW, TEST_MINT, TEST_ORIGIN, signedTestMandate, signers } from '@atlas-rail/mandate/testing';
import { GatedSignerAdapter, startSignerService, RunningSignerService } from '@atlas-rail/x402';
import { InMemoryVoucherSpendStore } from '@atlas-rail/database';
import { askChannelVoucher, voucherTokenProblem } from './channel-voucher';

const channelId = signers.facilitator.publicKey;

function request(mandate: Awaited<ReturnType<typeof signedTestMandate>>, recipient: string, extra: Record<string, unknown> = {}) {
  return {
    mandate,
    channelId,
    cumulativeAmount: '10000',
    expiresAt: NOW + 300,
    recipient,
    resourceUrl: `${TEST_ORIGIN}/research/summary`,
    asset: TEST_MINT,
    network: SOLANA_DEVNET_CAIP2,
    ...extra,
  };
}

describe('POST /v1/channel-voucher', () => {
  let signer: RunningSignerService | undefined;
  let voucherPosts = 0;

  afterEach(async () => {
    voucherPosts = 0;
    await signer?.close();
    signer = undefined;
  });

  async function rail() {
    const gated = new GatedSignerAdapter({
      inner: {
        name: 'test-agent',
        publicKey: signers.agent.publicKey,
        signMessage: (message) => signers.agent.signMessage(message),
        signTransaction: async () => {
          throw new Error('the test signer does not sign transactions');
        },
      },
      trustedInstanceKeys: [signers.instance.publicKey],
      clock: () => NOW,
    });
    signer = await startSignerService({ signer: gated, host: '127.0.0.1', port: 0 });
    const fetchCounting: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/v1/sign-voucher')) voucherPosts += 1;
      return fetch(input, init);
    };
    return {
      signerUrl: signer.url,
      fetch: fetchCounting,
      instance: signers.instance,
      clock: () => NOW,
      readChannel: async () => ({ payer: signers.facilitator.publicKey, payee: signers.merchant.publicKey, mint: TEST_MINT, settled: 0n }),
      spends: new InMemoryVoucherSpendStore(),
      readMandate: async () => ({ agent: signers.agent.publicKey, mint: TEST_MINT, revoked: false, revokedAt: 0 }),
    };
  }

  it('returns no signature for a denied payee, and a signature only after the gate allows the payee', async () => {
    const mandate = await signedTestMandate();
    const deps = await rail();

    const denied = await askChannelVoucher(request(mandate, signers.attacker.publicKey), deps);
    expect(denied.signed).toBe(false);
    expect(denied).not.toHaveProperty('signatureBase64');
    expect(voucherPosts).toBe(0);

    const allowed = await askChannelVoucher(request(mandate, signers.merchant.publicKey), deps);
    expect(allowed.signed).toBe(true);
    expect(voucherPosts).toBe(1);
    if (!allowed.signed) throw new Error('allowed');
    const message = Buffer.from(allowed.messageBase64, 'base64');
    expect(message.length).toBe(50);
    expect(verifyEd25519(signers.agent.publicKey, message, toBase58(Buffer.from(allowed.signatureBase64, 'base64')))).toBe(true);
  });

  it('returns no signature for a revoked mandate and does not ask the signer to sign', async () => {
    const mandate = await signedTestMandate();
    const deps = await rail();
    const denied = await askChannelVoucher(
      request(mandate, signers.merchant.publicKey, { revoked: { revokedAt: NOW - 10, reason: 'user revoked' } }),
      deps,
    );
    expect(denied.signed).toBe(false);
    expect(denied).not.toHaveProperty('signatureBase64');
    expect(voucherPosts).toBe(0);
  });

  it('returns no signature when the mandate is revoked on-chain, even if the caller leaves the flag out', async () => {
    const mandate = await signedTestMandate();
    const deps = await rail();
    const revoked = await askChannelVoucher(request(mandate, signers.merchant.publicKey), {
      ...deps,
      readMandate: async () => ({ agent: signers.agent.publicKey, mint: TEST_MINT, revoked: true, revokedAt: NOW - 10 }),
    });
    expect(revoked.signed).toBe(false);
    const missing = await askChannelVoucher(request(mandate, signers.merchant.publicKey), { ...deps, readMandate: async () => null });
    expect(missing).toEqual({ signed: false, message: 'MandateNotOnChain' });
    expect(voucherPosts).toBe(0);
  });

  it('keeps the endpoint closed without ATLAS_VOUCHER_TOKEN and refuses a wrong token', () => {
    expect(voucherTokenProblem('Bearer anything', '')?.status).toBe(503);
    expect(voucherTokenProblem(undefined, 'secret-token')?.status).toBe(401);
    expect(voucherTokenProblem('Bearer wrong-token', 'secret-token')?.status).toBe(401);
    expect(voucherTokenProblem('Bearer secret-token', 'secret-token')).toBeNull();
  });

  it('returns no signature when the fee payer is not the channel payer', async () => {
    const mandate = await signedTestMandate();
    const deps = await rail();
    const denied = await askChannelVoucher(
      request(mandate, signers.merchant.publicKey, { feePayer: signers.attacker.publicKey }),
      deps,
    );
    expect(denied.signed).toBe(false);
    expect(voucherPosts).toBe(0);
    const allowed = await askChannelVoucher(request(mandate, signers.merchant.publicKey), deps);
    expect(allowed.signed).toBe(true);
    expect(voucherPosts).toBe(1);
  });

  it('returns no signature when the allowed recipient is not the channel payee, or the asset is not the channel mint', async () => {
    const mandate = await signedTestMandate();
    const deps = await rail();
    const otherPayee = await askChannelVoucher(request(mandate, signers.merchant.publicKey), {
      ...deps,
      readChannel: async () => ({ payer: signers.facilitator.publicKey, payee: signers.attacker.publicKey, mint: TEST_MINT, settled: 0n }),
    });
    expect(otherPayee).toEqual({ signed: false, message: 'RecipientIsNotChannelPayee' });
    const otherMint = await askChannelVoucher(request(mandate, signers.merchant.publicKey), {
      ...deps,
      readChannel: async () => ({ payer: signers.facilitator.publicKey, payee: signers.merchant.publicKey, mint: signers.attacker.publicKey, settled: 0n }),
    });
    expect(otherMint).toEqual({ signed: false, message: 'AssetIsNotChannelMint' });
    expect(voucherPosts).toBe(0);
  });

  it('counts earlier vouchers against the window budget across requests and channels', async () => {
    const mandate = await signedTestMandate({ maxPerWindow: '1500000' });
    const deps = await rail();
    const first = await askChannelVoucher(request(mandate, signers.merchant.publicKey, { cumulativeAmount: '800000' }), deps);
    expect(first.signed).toBe(true);
    const otherChannel = signers.owner.publicKey;
    const second = await askChannelVoucher(
      request(mandate, signers.merchant.publicKey, { channelId: otherChannel, cumulativeAmount: '800000' }),
      deps,
    );
    expect(second.signed).toBe(false);
    expect(voucherPosts).toBe(1);
  });

  it('keeps the caps and the channel watermark across a restart, because they live in the store', async () => {
    const mandate = await signedTestMandate({ maxPerWindow: '1500000' });
    const store = new InMemoryVoucherSpendStore();
    const first = await askChannelVoucher(request(mandate, signers.merchant.publicKey, { cumulativeAmount: '800000' }), { ...(await rail()), spends: store });
    expect(first.signed).toBe(true);

    // A restart: new signer, new deps, nothing kept in process. Only the store carries over.
    await signer?.close();
    signer = undefined;
    const restarted = { ...(await rail()), spends: store };
    // Same channel, higher total: only the 200000 above the last signed voucher is charged.
    const next = await askChannelVoucher(request(mandate, signers.merchant.publicKey, { cumulativeAmount: '1000000' }), restarted);
    expect(next.signed && next.deltaAmount).toBe('200000');
    // Another channel: 800000 + 200000 + 800000 is above the 1500000 window, so no signature.
    const over = await askChannelVoucher(
      request(mandate, signers.merchant.publicKey, { channelId: signers.owner.publicKey, cumulativeAmount: '800000' }),
      restarted,
    );
    expect(over.signed).toBe(false);
    expect((await store.list(hashMandate(mandate))).map((row) => row.delta)).toEqual(['800000', '200000']);
  });

  it('scores the voucher against the settled amount on the chain, not the one the caller claims', async () => {
    const mandate = await signedTestMandate();
    const deps = await rail();
    // 90_000_000 is above the 50_000_000 per-payment cap. Claiming 89_999_999 is already settled
    // would make it look like a 1-unit payment if the server believed the caller.
    const denied = await askChannelVoucher(
      request(mandate, signers.merchant.publicKey, { cumulativeAmount: '90000000', chainSettled: '89999999', settledAmount: '89999999' }),
      deps,
    );
    expect(denied.signed).toBe(false);
    expect(voucherPosts).toBe(0);
  });

  it('returns no signature when the channel account is missing, and fails when the RPC is down', async () => {
    const mandate = await signedTestMandate();
    const deps = await rail();
    const missing = await askChannelVoucher(request(mandate, signers.merchant.publicKey), { ...deps, readChannel: async () => null });
    expect(missing.signed).toBe(false);
    await expect(
      askChannelVoucher(request(mandate, signers.merchant.publicKey), {
        ...deps,
        readChannel: async () => {
          throw new Error('Solana RPC is down');
        },
      }),
    ).rejects.toThrow('down');
    expect(voucherPosts).toBe(0);
  });
});
