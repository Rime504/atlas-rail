import { describe, expect, it, vi } from 'vitest';
import { SOLANA_DEVNET_CAIP2 } from '@atlas-rail/mandate';
import { NOW, TEST_MINT, TEST_ORIGIN, signedTestMandate, signers } from '@atlas-rail/mandate/testing';
import { DevnetKeypairSigner } from '@atlas-rail/solana';
import { GatedSignerAdapter, MandateDeniedError, VoucherAuthorizer, VoucherRequest } from '@atlas-rail/x402';
import { AtlasDenied } from './index';

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

async function setup() {
  process.env.ATLAS_ALLOW_MOCK_SIGNER = 'true';
  const mandate = await signedTestMandate();
  const signer = new GatedSignerAdapter({
    inner: new DevnetKeypairSigner(seed('agent')),
    trustedInstanceKeys: [signers.instance.publicKey],
    clock: () => NOW,
  });
  const authorizer = new VoucherAuthorizer({ mandate, instance: signers.instance, signer, organizationId: 'org_test', clock: () => NOW });
  const sign = vi.spyOn(signer, 'signVoucherWithAuthorization');
  return { authorizer, sign };
}

describe('voucher ask', () => {
  it('pays what the mandate allows and returns the receipt', async () => {
    const { authorizer, sign } = await setup();
    const allowed = await authorizer.requestVoucher(request());
    const receipt = await authorizer.recordAllowedReceipt(allowed, { txSignature: 'A'.repeat(64), slot: 1 });
    expect(sign).toHaveBeenCalledTimes(1);
    expect(receipt.id).toMatch(/^rcp_/);
    expect(receipt.response.contentType).toBe('application/vnd.payment-channels.voucher');
  });

  it('throws AtlasDenied with the refusing rules, and the wallet never signs', async () => {
    const { authorizer, sign } = await setup();
    const error = await authorizer.requestVoucher(request({ recipient: signers.attacker.publicKey, resourceUrl: `${TEST_ORIGIN}/research/drain` })).catch((e) => e);
    expect(error).toBeInstanceOf(MandateDeniedError);
    const denied = new AtlasDenied((error as MandateDeniedError).decision);
    expect(denied).toBeInstanceOf(AtlasDenied);
    expect(denied.reasons).toContain('PAYTO_ALLOWED');
    expect(sign).not.toHaveBeenCalled();
  });
});
