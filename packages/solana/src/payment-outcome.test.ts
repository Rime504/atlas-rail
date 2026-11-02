import { describe, expect, it } from 'vitest';
import { Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { PaymentHistory, findPaymentOutcome } from './payment-outcome';
import { transactionMessageHash } from './x402-payment';

const CHANNEL = new PublicKey('CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX');
const ED25519 = new PublicKey('Ed25519SigVerify111111111111111111111111111');
const INSTRUCTIONS_SYSVAR = new PublicKey('Sysvar1nstructions1111111111111111111111111');

const key = () => Keypair.generate().publicKey.toBase58();
const payer = key();

/** Ed25519 precompile plus payment-channels settle, the same two instructions the devnet script submits. */
function settleTransaction(): VersionedTransaction {
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
  Keypair.generate().publicKey.toBuffer().copy(data, 16);
  signature.copy(data, 48);
  message.copy(data, 112);
  const compiled = new TransactionMessage({
    payerKey: new PublicKey(payer),
    recentBlockhash: key(),
    instructions: [
      new TransactionInstruction({ programId: ED25519, keys: [], data }),
      new TransactionInstruction({
        programId: CHANNEL,
        keys: [
          { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
          { pubkey: INSTRUCTIONS_SYSVAR, isSigner: false, isWritable: false },
        ],
        data: Buffer.from([2]),
      }),
    ],
  }).compileToV0Message();
  return new VersionedTransaction(compiled);
}

const tx = settleTransaction();
const transactionBase64 = Buffer.from(tx.serialize()).toString('base64');
const hash = transactionMessageHash(tx);
const NOW = 1_800_000_000;
const input = { transactionBase64, expectedMessageHash: hash, payer, notBefore: NOW };

/** A scripted history: `rows` are the payer's signatures, newest first; `messages` maps signature → message. */
function history(p: {
  rows?: Array<{ signature: string; blockTime: number | null }> | (() => Array<{ signature: string; blockTime: number | null }>);
  messages?: Record<string, { messageHash: string; err: unknown | null }>;
  blockhashValid?: boolean;
}): PaymentHistory & { reads: number } {
  const h = {
    reads: 0,
    async signaturesForAddress() {
      h.reads += 1;
      return typeof p.rows === 'function' ? p.rows() : (p.rows ?? []);
    },
    async getTransactionMessage(signature: string) {
      return p.messages?.[signature] ?? null;
    },
    async isBlockhashValid() {
      return p.blockhashValid ?? false;
    },
  };
  return h;
}

describe('findPaymentOutcome', () => {
  it('LANDED when the exact message is in the payer history', async () => {
    const h = history({ rows: [{ signature: 'other', blockTime: NOW + 2 }, { signature: 'ours', blockTime: NOW + 1 }], messages: { other: { messageHash: 'x', err: null }, ours: { messageHash: hash, err: null } } });
    await expect(findPaymentOutcome(h, input)).resolves.toEqual({ status: 'LANDED', txSignature: 'ours' });
  });

  it('FAILED when it landed with an error (no tokens moved)', async () => {
    const h = history({ rows: [{ signature: 'ours', blockTime: NOW }], messages: { ours: { messageHash: hash, err: { InstructionError: [2, 'Custom'] } } } });
    await expect(findPaymentOutcome(h, input)).resolves.toEqual({ status: 'FAILED', txSignature: 'ours' });
  });

  it('PENDING while the blockhash is still valid', async () => {
    await expect(findPaymentOutcome(history({ blockhashValid: true }), input)).resolves.toEqual({ status: 'PENDING' });
  });

  it('EXPIRED only after the blockhash is invalid and a second scan still finds nothing', async () => {
    const h = history({ blockhashValid: false });
    await expect(findPaymentOutcome(h, input)).resolves.toEqual({ status: 'EXPIRED' });
    expect(h.reads).toBe(2);
  });

  it('LANDED if it appears between the first scan and the blockhash check', async () => {
    let call = 0;
    const h = history({ rows: () => (++call === 1 ? [] : [{ signature: 'late', blockTime: NOW + 5 }]), messages: { late: { messageHash: hash, err: null } } });
    await expect(findPaymentOutcome(h, input)).resolves.toEqual({ status: 'LANDED', txSignature: 'late' });
  });

  it('PENDING, never EXPIRED, when the history is too long to scan back to the authorisation', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ signature: `s${i}`, blockTime: NOW + 1000 - i }));
    await expect(findPaymentOutcome(history({ rows }), input)).resolves.toEqual({ status: 'PENDING' });
  });

  it('PENDING, never EXPIRED, when a listed transaction cannot be fetched (it might be ours)', async () => {
    const h = history({ rows: [{ signature: 'unreadable', blockTime: NOW + 1 }], blockhashValid: false });
    await expect(findPaymentOutcome(h, input)).resolves.toEqual({ status: 'PENDING' });
  });

  it('stops scanning at history older than the authorisation', async () => {
    const rows = [{ signature: 'old', blockTime: NOW - 10_000 }, ...Array.from({ length: 99 }, (_, i) => ({ signature: `s${i}`, blockTime: null }))];
    await expect(findPaymentOutcome(history({ rows }), input)).resolves.toEqual({ status: 'EXPIRED' });
  });

  it('MISMATCH for a different or undecodable transaction', async () => {
    await expect(findPaymentOutcome(history({}), { ...input, expectedMessageHash: 'f'.repeat(64) })).resolves.toEqual({ status: 'MISMATCH' });
    await expect(findPaymentOutcome(history({}), { ...input, transactionBase64: 'AAAA' })).resolves.toEqual({ status: 'MISMATCH' });
  });

  it('propagates chain errors so the gate keeps the hold (PENDING)', async () => {
    const h = history({});
    h.signaturesForAddress = async () => {
      throw new Error('429 Too Many Requests');
    };
    await expect(findPaymentOutcome(h, input)).rejects.toThrow('429');
  });
});
