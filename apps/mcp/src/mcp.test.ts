import { describe, expect, it, vi } from 'vitest';
import { AtlasDenied } from '@atlas-rail/agent';
import { SOLANA_DEVNET_CAIP2 } from '@atlas-rail/mandate';
import { NOW, TEST_MINT, TEST_ORIGIN, signedTestMandate, signers } from '@atlas-rail/mandate/testing';
import { DevnetKeypairSigner } from '@atlas-rail/solana';
import { AtlasFetch, GatedSignerAdapter, MandateDeniedError, VoucherAuthorizer, VoucherRequest } from '@atlas-rail/x402';
import { payTool } from './pay';

function seed(label: string): Uint8Array {
  const out = new Uint8Array(32);
  new TextEncoder().encode(label).forEach((b, i) => (out[i] = b));
  return out;
}

describe('the pay tool', () => {
  it('pays within the mandate and reports the receipt; reports the refusing rules otherwise', async () => {
    process.env.ATLAS_ALLOW_MOCK_SIGNER = 'true';
    const mandate = await signedTestMandate();
    const signer = new GatedSignerAdapter({
      inner: new DevnetKeypairSigner(seed('agent')),
      trustedInstanceKeys: [signers.instance.publicKey],
      clock: () => NOW,
    });
    const authorizer = new VoucherAuthorizer({ mandate, instance: signers.instance, signer, organizationId: 'org_test', clock: () => NOW });
    const sign = vi.spyOn(signer, 'signVoucherWithAuthorization');
    const pay: AtlasFetch = async (input) => {
      const url = String(input);
      const ask: VoucherRequest = {
        channelId: url.endsWith('/drain') ? signers.owner.publicKey : signers.facilitator.publicKey,
        cumulativeAmount: '10000',
        expiresAt: NOW + 600,
        recipient: url.endsWith('/drain') ? signers.attacker.publicKey : signers.merchant.publicKey,
        resourceUrl: url,
        asset: TEST_MINT,
        network: SOLANA_DEVNET_CAIP2,
      };
      try {
        const allowed = await authorizer.requestVoucher(ask);
        const receipt = await authorizer.recordAllowedReceipt(allowed, { txSignature: 'A'.repeat(64), slot: 1 });
        const response = new Response(JSON.stringify({ ok: true }), { status: 200 }) as Awaited<ReturnType<AtlasFetch>>;
        response.atlas = {
          decision: allowed.decision,
          approvalId: null,
          escalated: false,
          txSignature: receipt.settlement.txSignature,
          receipt,
          receiptError: null,
          expectedReceiptId: receipt.id,
        };
        return response;
      } catch (error) {
        if (error instanceof MandateDeniedError) throw new AtlasDenied(error.decision);
        throw error;
      }
    };
    expect(await payTool(pay, `${TEST_ORIGIN}/research/summary`)).toMatch(/HTTP 200[\s\S]*Receipt: rcp_/);
    expect(await payTool(pay, `${TEST_ORIGIN}/research/drain`)).toMatch(/REFUSED[\s\S]*PAYTO_ALLOWED/);
    expect(sign).toHaveBeenCalledTimes(1);
  });
});
