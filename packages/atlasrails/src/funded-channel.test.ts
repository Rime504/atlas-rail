import { describe, expect, it } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { encodeVoucherMessage } from '@atlas-rail/x402';
import {
  DEVNET_GENESIS,
  askAtlasRail,
  attachFundedChannel,
  createDemoMint,
  createVoucher,
  createVoucherKey,
  depositUpfront,
  distributeData,
  ed25519Instruction,
  readChannel,
} from '../payment.mjs';

const PROGRAM_ID = new PublicKey('CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX');
const CHANNEL = new PublicKey('GEMPoRi8Si9peeMnCg6jDp36mKjT1oQLeqwm3VaveFuz');
const MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const ESCROW = 'FvmVafVgaYPTFsJvjiZ3se6P7VDtSaXQEPaeh54q52GU';

function channelData(fields: { payer: PublicKey; payee: PublicKey; signer: PublicKey; deposit?: bigint; settled?: bigint }): Buffer {
  const data = Buffer.alloc(256);
  data[0] = 1;
  data.writeBigUInt64LE(fields.deposit ?? 10_000n, 12);
  data.writeBigUInt64LE(fields.settled ?? 0n, 20);
  data.writeBigUInt64LE(0n, 28);
  fields.payer.toBuffer().copy(data, 88);
  fields.payee.toBuffer().copy(data, 120);
  fields.signer.toBuffer().copy(data, 152);
  MINT.toBuffer().copy(data, 184);
  fields.payer.toBuffer().copy(data, 216);
  return data;
}

describe('funded channel payment helpers', () => {
  it('decodes the channel and builds the ed25519 and distribute instructions', () => {
    const payer = Keypair.generate().publicKey;
    const payee = Keypair.generate().publicKey;
    const signer = Keypair.generate().publicKey;
    const decoded = readChannel(channelData({ payer, payee, signer, settled: 1000n }));
    expect(decoded.deposit).toBe(10_000n);
    expect(decoded.settled).toBe(1000n);
    expect(decoded.payer).toBe(payer.toBase58());
    expect(decoded.payee).toBe(payee.toBase58());
    expect(decoded.authorizedSigner).toBe(signer.toBase58());
    expect(decoded.mint).toBe(MINT.toBase58());
    const message = encodeVoucherMessage({ channelId: CHANNEL.toBase58(), cumulativeAmount: 1000n, expiresAt: 1_800_000_000n });
    expect(message).toHaveLength(50);
    expect([...message.subarray(0, 2)]).toEqual([0x56, 0x01]);
    expect(Buffer.from(message).readBigUInt64LE(34)).toBe(1000n);
    const ix = ed25519Instruction(signer.toBytes(), new Uint8Array(64).fill(7), message);
    expect(ix.programId.toBase58()).toBe('Ed25519SigVerify111111111111111111111111111');
    expect(ix.keys).toHaveLength(0);
    expect(ix.data[0]).toBe(1);
    expect(Buffer.from(ix.data.subarray(16, 48)).equals(Buffer.from(signer.toBytes()))).toBe(true);
    expect(Buffer.from(ix.data.subarray(112, 162)).equals(Buffer.from(message))).toBe(true);
    expect([...distributeData()]).toEqual([7, 0, 0, 0, 0]);
    expect(getAssociatedTokenAddressSync(MINT, CHANNEL, true).toBase58()).toBe(ESCROW);
  });

  it('attaches the open channel and refuses a new mint, deposit, or signer', async () => {
    const payer = Keypair.generate();
    const payee = Keypair.generate().publicKey;
    const signer = Keypair.generate().publicKey;
    const data = channelData({ payer: payer.publicKey, payee, signer });
    const escrow = getAssociatedTokenAddressSync(MINT, CHANNEL, true);
    let sends = 0;
    const connection = {
      async getGenesisHash() {
        return DEVNET_GENESIS;
      },
      async getAccountInfo(key: PublicKey) {
        if (key.equals(CHANNEL)) return { owner: PROGRAM_ID, data };
        if (key.equals(escrow)) return { owner: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), data: Buffer.alloc(165) };
        return null;
      },
      async sendRawTransaction() {
        sends += 1;
        return 'sig';
      },
    };
    const session = { connection, payer, agent: { publicKey: signer.toBase58() } };
    const attached = await attachFundedChannel(session, {
      channel: CHANNEL.toBase58(),
      escrow: escrow.toBase58(),
      mint: MINT.toBase58(),
      payer: payer.publicKey.toBase58(),
      payee: payee.toBase58(),
      authorizedSigner: signer.toBase58(),
    });
    expect(attached.authorizedSigner).toBe(signer.toBase58());
    expect(sends).toBe(0);
    await expect(createVoucherKey(session)).rejects.toThrow('Existing channel keeps its authorized signer');
    await expect(createDemoMint(session)).rejects.toThrow('Existing channel already has a mint');
    await expect(depositUpfront(session)).rejects.toThrow('Existing channel is already funded');
    await expect(attachFundedChannel(session, {
      channel: CHANNEL.toBase58(),
      escrow: escrow.toBase58(),
      mint: MINT.toBase58(),
      payer: payer.publicKey.toBase58(),
      payee: payee.toBase58(),
      authorizedSigner: Keypair.generate().publicKey.toBase58(),
    })).rejects.toThrow('Voucher signer is not the channel signer');
  });

  it('rejects a denial that carries a signature and a cumulative amount that is not above the watermark', async () => {
    process.env.ATLAS_API_URL = 'http://127.0.0.1:9';
    const previous = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ signed: false, signatureBase64: 'aaaa' }) })) as typeof fetch;
    await expect(askAtlasRail({ channelId: CHANNEL.toBase58() })).rejects.toThrow('Denied voucher included a signature');
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ signed: false, message: 'MandateDeniedError' }) })) as typeof fetch;
    await expect(askAtlasRail({ channelId: CHANNEL.toBase58() })).resolves.toMatchObject({ signed: false });
    expect((await askAtlasRail({ channelId: CHANNEL.toBase58() })).signatureBase64).toBeUndefined();
    globalThis.fetch = previous;
    const payer = Keypair.generate();
    const payee = payer.publicKey;
    const signer = Keypair.generate().publicKey;
    const data = channelData({ payer: payer.publicKey, payee, signer, settled: 1000n });
    const session = {
      fundedChannel: true,
      connection: { async getAccountInfo() { return { data }; } },
      payer,
      recipient: { publicKey: payee },
      agent: { publicKey: signer.toBase58() },
      channel: CHANNEL,
      mint: MINT,
      settledAmount: 1000n,
      payment: { voucherExpiresAt: 1, resourceUrl: 'https://example.test', network: 'solana:devnet' },
    };
    await expect(createVoucher(session)).rejects.toThrow('Cumulative amount is not strictly above the settled watermark');
  });
});
