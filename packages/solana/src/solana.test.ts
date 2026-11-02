import { describe, it, expect } from 'vitest';
import { Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { assertNotMainnet } from './guards';
import { DevnetTransactionSimulator } from './simulator';
import { MockDevnetSignerAdapter, ExternalCustodySignerAdapter } from './signer';

const CHANNEL = new PublicKey('CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX');
const ED25519 = new PublicKey('Ed25519SigVerify111111111111111111111111111');
const INSTRUCTIONS_SYSVAR = new PublicKey('Sysvar1nstructions1111111111111111111111111');

/** Legacy settle transaction, matching scripts/channel-voucher-devnet.mjs. Unsigned. */
function settleTransactionBase64(feePayer: PublicKey = new PublicKey('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU')): string {
  const voucher = Keypair.generate().publicKey;
  const message = Buffer.from('voucher');
  const signature = Buffer.alloc(64, 7);
  const data = Buffer.alloc(112 + message.length);
  data[0] = 1;
  data.writeUInt16LE(48, 2);
  data.writeUInt16LE(0xffff, 4);
  data.writeUInt16LE(16, 6);
  data.writeUInt16LE(0xffff, 8);
  data.writeUInt16LE(112, 10);
  data.writeUInt16LE(message.length, 12);
  data.writeUInt16LE(0xffff, 14);
  voucher.toBuffer().copy(data, 16);
  signature.copy(data, 48);
  message.copy(data, 112);
  const tx = new Transaction();
  tx.feePayer = feePayer;
  tx.recentBlockhash = '4uQevwaSCPxFLBspwVTSYjQQZsMotP5j84vPf15pVM35';
  tx.add(new TransactionInstruction({ programId: ED25519, keys: [], data }));
  tx.add(
    new TransactionInstruction({
      programId: CHANNEL,
      keys: [
        { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
        { pubkey: INSTRUCTIONS_SYSVAR, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([2]),
    }),
  );
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
}

describe('Solana Adapter Package', () => {
  it('rejects mainnet URLs and configurations strictly', () => {
    expect(() => assertNotMainnet('https://api.mainnet-beta.solana.com')).toThrow('CRITICAL SAFETY FATAL');
  });

  it('builds an unsigned channel settle transaction', () => {
    const raw = settleTransactionBase64();
    const tx = Transaction.from(Buffer.from(raw, 'base64'));
    expect(tx.instructions.map((ix) => ix.programId.toBase58())).toEqual([ED25519.toBase58(), CHANNEL.toBase58()]);
    expect(tx.instructions[1].data[0]).toBe(2);
  });

  it('simulates a settle locally and does not broadcast it', () => {
    const sim = DevnetTransactionSimulator.analyzeTransactionBase64(settleTransactionBase64(), {
      err: null,
      unitsConsumed: 5000,
    });

    expect(sim.success).toBe(true);
    expect(sim.programIds).toEqual([ED25519.toBase58(), CHANNEL.toBase58()]);
    expect(sim.unknownProgramIds).toEqual([ED25519.toBase58(), CHANNEL.toBase58()]);
  });

  it('signs a settle with the mock signer adapter when allowed', async () => {
    process.env.ATLAS_ALLOW_MOCK_SIGNER = 'true';
    const signer = new MockDevnetSignerAdapter();
    const res = await signer.signTransaction(settleTransactionBase64(signer.publicKey));
    expect(res.signature).toContain('devnet_mock_sig_');
    expect(res.signedBase64).toBeDefined();
  });

  it('throws helpful error for unconfigured external custody signer', async () => {
    const signer = new ExternalCustodySignerAdapter();
    await expect(signer.signTransaction('dGVzdA==')).rejects.toThrow('ExternalCustodySignerAdapter is not configured');
  });
});
