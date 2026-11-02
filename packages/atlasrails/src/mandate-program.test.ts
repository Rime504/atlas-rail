import { describe, expect, it, vi } from 'vitest';
import { Keypair, Transaction, VersionedTransaction } from '@solana/web3.js';
import { createAtlasRail } from './sdk-client';
import { prepareAnchorRootInstruction, prepareCreateMandateInstruction, prepareRevokeMandateInstruction, runCreateMandate } from './mandate-program';
import { DEVNET_GENESIS } from './sdk-evidence';

const CREATE = Buffer.from([230, 170, 158, 68, 33, 169, 16, 158]);
const REVOKE = Buffer.from([252, 97, 140, 119, 67, 43, 177, 108]);
const ANCHOR = Buffer.from([46, 118, 158, 39, 84, 152, 27, 134]);
const BLOCKHASH = '11111111111111111111111111111111';

function ixData(base64: string): Buffer {
  const tx = VersionedTransaction.deserialize(Buffer.from(base64, 'base64'));
  return Buffer.from(tx.message.compiledInstructions[0].data);
}

describe('create_mandate with the agent key in the signer service', () => {
  it('signs as owner and approver here, and asks the signer for the agent signature', async () => {
    const owner = Keypair.generate();
    const approver = Keypair.generate();
    const agentKey = Keypair.generate();
    const seen: string[] = [];
    const agent = {
      publicKey: agentKey.publicKey.toBase58(),
      async signCreateMandate(transactionBase64: string) {
        const tx = VersionedTransaction.deserialize(Buffer.from(transactionBase64, 'base64'));
        seen.push(...tx.signatures.map((signature) => (signature.every((byte) => byte === 0) ? 'empty' : 'signed')));
        tx.sign([agentKey]);
        return Buffer.from(tx.serialize()).toString('base64');
      },
    };
    const connection = { getLatestBlockhash: async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 1 }) };
    const result = await runCreateMandate(connection as never, {
      owner,
      approver,
      agent,
      mandateHash: new Uint8Array(32).fill(5),
      gateAuthority: Keypair.generate().publicKey.toBase58(),
      mint: Keypair.generate().publicKey.toBase58(),
      maxPerPayment: 1000n,
      maxPerWindow: 5000n,
      windowSeconds: 86_400n,
      maxTotal: 10_000n,
      escalationThreshold: 1000n,
      notBefore: 0n,
      expiresAt: 2_000_000_000n,
    });
    expect(seen).toEqual(['signed', 'signed', 'empty']);
    if (result.status !== 'prepared') throw new Error('expected prepared');
    const signed = VersionedTransaction.deserialize(Buffer.from(result.transactionBase64, 'base64'));
    expect(signed.signatures.every((signature) => signature.some((byte) => byte !== 0))).toBe(true);
  });
});

describe('Atlas Mandate instructions', () => {
  const owner = Keypair.generate().publicKey.toBase58();
  const approver = Keypair.generate().publicKey.toBase58();
  const agent = Keypair.generate().publicKey.toBase58();
  const hash = new Uint8Array(32).fill(4);

  it('encodes create_mandate, revoke_mandate, and anchor_root', () => {
    const created = prepareCreateMandateInstruction({
      owner,
      approver,
      agent,
      recentBlockhash: BLOCKHASH,
      mandateHash: hash,
      gateAuthority: Keypair.generate().publicKey.toBase58(),
      mint: Keypair.generate().publicKey.toBase58(),
      maxPerPayment: 1000n,
      maxPerWindow: 5000n,
      windowSeconds: 86_400n,
      maxTotal: 10_000n,
      escalationThreshold: 1000n,
      notBefore: 0n,
      expiresAt: 2_000_000_000n,
    });
    expect(ixData(created.transactionBase64).subarray(0, 8)).toEqual(CREATE);
    expect(created.broadcast).toBe(false);

    const revoked = prepareRevokeMandateInstruction({
      mandatePda: created.mandatePda,
      authority: owner,
      recentBlockhash: BLOCKHASH,
    });
    expect(ixData(revoked.transactionBase64)).toEqual(REVOKE);

    const anchored = prepareAnchorRootInstruction({
      mandatePda: created.mandatePda,
      gateAuthority: owner,
      seq: 0n,
      merkleRoot: new Uint8Array(32).fill(9),
      leafCount: 2,
      batchHeader: new Uint8Array(32).fill(3),
      batchFileHash: new Uint8Array(32).fill(4),
      recentBlockhash: BLOCKHASH,
    });
    const data = ixData(anchored.transactionBase64);
    expect(data.subarray(0, 8)).toEqual(ANCHOR);
    expect(data.subarray(52, 84)).toEqual(Buffer.alloc(32, 3));
    expect(data.subarray(84, 116)).toEqual(Buffer.alloc(32, 4));

    const message = VersionedTransaction.deserialize(Buffer.from(anchored.transactionBase64, 'base64')).message;
    expect(message.compiledInstructions).toHaveLength(1);
    expect(message.staticAccountKeys.some((key) => key.toBase58() === 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')).toBe(false);
    const utf8 = Buffer.from(anchored.transactionBase64, 'base64').toString('utf8');
    expect(utf8).not.toContain('user@example.com');
    expect(utf8).not.toContain('atlasrail:receipt:');
  });

  it('createMandate prepares a signed transaction and does not broadcast unless submit is set', async () => {
    const ownerKp = Keypair.generate();
    const sendRawTransaction = vi.fn();
    const atlas = createAtlasRail({
      apiUrl: 'http://127.0.0.1:3001',
      connection: {
        async getGenesisHash() {
          return DEVNET_GENESIS;
        },
        async getLatestBlockhash() {
          return { blockhash: BLOCKHASH, lastValidBlockHeight: 1 };
        },
        sendRawTransaction,
      } as never,
      wallet: {
        publicKey: ownerKp.publicKey.toBase58(),
        async signTransaction(tx: Transaction) {
          return tx;
        },
      },
      execution: 'prepareOnly',
    });

    const prepared = await atlas.createMandate({
      owner: ownerKp,
      approver: Keypair.generate(),
      agent: Keypair.generate(),
      mandateHash: hash,
      gateAuthority: Keypair.generate().publicKey.toBase58(),
      mint: Keypair.generate().publicKey.toBase58(),
      maxPerPayment: 1n,
      maxPerWindow: 1n,
      windowSeconds: 60n,
      maxTotal: 1n,
      escalationThreshold: 0n,
      notBefore: 0n,
      expiresAt: 2_000_000_000n,
    });
    expect(prepared.status).toBe('prepared');
    expect(prepared.broadcast).toBe(false);
    expect(sendRawTransaction).not.toHaveBeenCalled();
    if (prepared.status === 'prepared') {
      expect(ixData(prepared.transactionBase64).subarray(0, 8)).toEqual(CREATE);
    }
  });
});
