import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SOLANA_DEVNET_CAIP2, sha256Hex } from '@atlas-rail/mandate';
import { NOW, TEST_MINT, TEST_ORIGIN, signedTestMandate, signers } from '@atlas-rail/mandate/testing';
import { GateAuthorizationRequiredError, GatedSignerAdapter, MandateDeniedError, UnsupportedPaymentError, VoucherAuthorizer, VoucherRequest, encodeVoucherMessage } from '@atlas-rail/x402';
import { DevnetKeypairSigner } from './keypair-signer';
import { decodeTransaction } from './x402-payment';

const originalEnv = { ...process.env };
beforeEach(() => {
  process.env.ATLAS_ALLOW_MOCK_SIGNER = 'true';
  process.env.NODE_ENV = 'test';
});
afterEach(() => {
  process.env = { ...originalEnv };
});

const payer = Keypair.generate();
const merchant = Keypair.generate();
const attacker = Keypair.generate();
const blockhash = Keypair.generate().publicKey.toBase58();
const CHANNEL = signers.facilitator.publicKey;

function seed(label: string): Uint8Array {
  const out = new Uint8Array(32);
  new TextEncoder().encode(label).forEach((b, i) => (out[i] = b));
  return out;
}

function request(overrides: Partial<VoucherRequest> = {}): VoucherRequest {
  return {
    channelId: CHANNEL,
    cumulativeAmount: '10000',
    expiresAt: NOW + 600,
    recipient: signers.merchant.publicKey,
    resourceUrl: `${TEST_ORIGIN}/research/summary`,
    asset: TEST_MINT,
    network: SOLANA_DEVNET_CAIP2,
    ...overrides,
  };
}

async function authorizer() {
  const mandate = await signedTestMandate();
  const signer = new GatedSignerAdapter({
    inner: new DevnetKeypairSigner(seed('agent')),
    trustedInstanceKeys: [signers.instance.publicKey],
    clock: () => NOW,
  });
  return {
    mandate,
    signer,
    authorizer: new VoucherAuthorizer({
      mandate,
      instance: signers.instance,
      signer,
      organizationId: 'org_test',
      clock: () => NOW,
    }),
  };
}

describe('payment-channel voucher instead of an exact SPL transfer', () => {
  it('builds the 50-byte voucher and the signer accepts only those bytes', async () => {
    const message = encodeVoucherMessage({ channelId: CHANNEL, cumulativeAmount: 10_000n, expiresAt: BigInt(NOW + 600) });
    expect(message).toHaveLength(50);
    expect(Array.from(message.slice(0, 2))).toEqual([0x56, 0x01]);
    const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
    expect(view.getBigUint64(34, true)).toBe(10_000n);
    expect(view.getBigInt64(42, true)).toBe(BigInt(NOW + 600));
    const { authorizer: gate, signer } = await authorizer();
    const allowed = await gate.requestVoucher(request());
    expect(sha256Hex(allowed.message)).toBe(allowed.messageHash);
    expect(allowed.deltaAmount).toBe('10000');
    const again = encodeVoucherMessage({ channelId: CHANNEL, cumulativeAmount: 10_000n, expiresAt: BigInt(NOW + 600) });
    expect(sha256Hex(again)).toBe(sha256Hex(allowed.message));
    await expect(signer.signMessage(allowed.message)).rejects.toBeInstanceOf(GateAuthorizationRequiredError);
  });

  it('is unaffected by signing: the voucher hash does not include the signature', async () => {
    const { authorizer: gate } = await authorizer();
    const allowed = await gate.requestVoucher(request());
    expect(sha256Hex(allowed.message)).toBe(allowed.messageHash);
    expect(allowed.signature.length).toBe(64);
  });

  describe('rejects a voucher that does not pay exactly the offer', () => {
    const cases: Array<[string, (input: VoucherRequest) => Partial<VoucherRequest>, 'deny' | 'reject']> = [
      ['different recipient', () => ({ recipient: signers.attacker.publicKey }), 'deny'],
      ['different amount (one base unit more than the ceiling)', () => ({ cumulativeAmount: '50000001' }), 'deny'],
      ['different mint', () => ({ asset: signers.attacker.publicKey }), 'deny'],
      ['no new spend at all', () => ({ cumulativeAmount: '0' }), 'reject'],
      ['expired voucher', () => ({ expiresAt: NOW }), 'reject'],
      ['channel id is not a key', () => ({ channelId: 'not-a-key' }), 'reject'],
    ];
    for (const [name, patch, kind] of cases) {
      it(name, async () => {
        const { authorizer: gate, signer } = await authorizer();
        const sign = vi.spyOn(signer, 'signVoucherWithAuthorization');
        const ask = gate.requestVoucher(request(patch(request())));
        if (kind === 'deny') await expect(ask).rejects.toBeInstanceOf(MandateDeniedError);
        else await expect(ask).rejects.toBeInstanceOf(UnsupportedPaymentError);
        expect(sign).not.toHaveBeenCalled();
      });
    }

    it('two spends of the same voucher (double payment)', async () => {
      const { authorizer: gate, signer } = await authorizer();
      await gate.requestVoucher(request());
      const sign = vi.spyOn(signer, 'signVoucherWithAuthorization');
      await expect(gate.requestVoucher(request())).rejects.toBeInstanceOf(UnsupportedPaymentError);
      expect(sign).not.toHaveBeenCalled();
    });

    it('a later cumulative that rewinds the watermark', async () => {
      const { authorizer: gate, signer } = await authorizer();
      await gate.requestVoucher(request());
      const sign = vi.spyOn(signer, 'signVoucherWithAuthorization');
      await expect(gate.requestVoucher(request({ cumulativeAmount: '20000', settledAmount: '0' }))).rejects.toBeInstanceOf(UnsupportedPaymentError);
      expect(sign).not.toHaveBeenCalled();
    });

    it('tampered voucher bytes are not covered by the authorisation', async () => {
      const { authorizer: gate, signer, mandate } = await authorizer();
      const allowed = await gate.requestVoucher(request());
      const tampered = Uint8Array.from(allowed.message);
      tampered[34] ^= 0xff;
      await expect(signer.signVoucherWithAuthorization(tampered, allowed.authorization, allowed.decision, mandate)).rejects.toBeInstanceOf(
        GateAuthorizationRequiredError,
      );
    });

    it('flags a message that is not the 50-byte voucher', async () => {
      const { signer } = await authorizer();
      await expect(signer.signVoucherWithAuthorization(new Uint8Array(50), null, null, null)).rejects.toBeInstanceOf(GateAuthorizationRequiredError);
    });
  });
});

describe('DevnetKeypairSigner', () => {
  it('refuses to construct in production or without the explicit devnet flag', () => {
    process.env.NODE_ENV = 'production';
    expect(() => new DevnetKeypairSigner(payer.secretKey)).toThrow(/production/);
    process.env.NODE_ENV = 'test';
    process.env.ATLAS_ALLOW_MOCK_SIGNER = 'false';
    expect(() => new DevnetKeypairSigner(payer.secretKey)).toThrow(/disabled/);
  });

  function lonePayerTx(): string {
    const message = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: merchant.publicKey, lamports: 1 })],
    }).compileToV0Message();
    return Buffer.from(new VersionedTransaction(message).serialize()).toString('base64');
  }

  it('signs only its own slot', async () => {
    const signer = new DevnetKeypairSigner(payer.secretKey);
    const signed = await signer.signTransaction(lonePayerTx());
    const tx = decodeTransaction(signed.signedBase64);
    expect(tx.signatures).toHaveLength(1);
    expect(tx.signatures[0].some((b) => b !== 0)).toBe(true);
  });

  it('refuses to sign a transaction it is not a required signer of', async () => {
    const signer = new DevnetKeypairSigner(attacker.secretKey);
    await expect(signer.signTransaction(lonePayerTx())).rejects.toThrow(/not a required signer/);
  });

  it('signs a 50-byte voucher message that verifies under the same public key', async () => {
    const { ed25519 } = await import('@noble/curves/ed25519');
    const signer = new DevnetKeypairSigner(seed('agent'));
    const message = encodeVoucherMessage({ channelId: CHANNEL, cumulativeAmount: 10_000n, expiresAt: BigInt(NOW + 600) });
    const signature = await signer.signMessage(message);
    expect(ed25519.verify(signature, message, new PublicKey(signer.publicKey).toBytes())).toBe(true);
  });
});
