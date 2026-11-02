import { createHash } from 'crypto';
import { Connection, Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { Web3ChainClient, checkChannelSettlement, checkRootAnchor, summarizeTransaction } from './chain';
import { findMandatePda, findRootPda } from './mandate-registry';

const MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const ED25519_PROGRAM = 'Ed25519SigVerify111111111111111111111111111';
const CHANNEL_PROGRAM = 'CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX';
const INSTRUCTIONS_SYSVAR = 'Sysvar1nstructions1111111111111111111111111';
const payer = Keypair.generate();
const blockhash = Keypair.generate().publicKey.toBase58();

function channelSettleTransaction(agent: PublicKey = payer.publicKey, extra: TransactionInstruction[] = []): VersionedTransaction {
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
  agent.toBuffer().copy(data, 16);
  signature.copy(data, 48);
  message.copy(data, 112);
  const compiled = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: [
      new TransactionInstruction({ programId: new PublicKey(ED25519_PROGRAM), keys: [], data }),
      new TransactionInstruction({
        programId: new PublicKey(CHANNEL_PROGRAM),
        keys: [
          { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
          { pubkey: new PublicKey(INSTRUCTIONS_SYSVAR), isSigner: false, isWritable: false },
        ],
        data: Buffer.from([2]),
      }),
      ...extra,
    ],
  }).compileToV0Message();
  return new VersionedTransaction(compiled);
}

function channelSettleSummary(agent: PublicKey = payer.publicKey, err: unknown | null = null, extra: TransactionInstruction[] = []) {
  return summarizeTransaction('sig', channelSettleTransaction(agent, extra), { slot: 42, blockTime: 1_800_000_000, err });
}

describe('summarizeTransaction', () => {
  it('extracts a payment-channels settle: voucher payer, no token movement', () => {
    const summary = channelSettleSummary();
    expect(summary.feePayer).toBe(payer.publicKey.toBase58());
    expect(summary.tokenTransfers).toEqual([]);
    expect(summary.programIds).toEqual([ED25519_PROGRAM, CHANNEL_PROGRAM]);
    expect(summary.slot).toBe(42);
    expect(checkChannelSettlement(summary).payer).toBe(payer.publicKey.toBase58());
  });
});

describe('checkChannelSettlement', () => {
  it('accepts an Ed25519 precompile plus settle and reports the voucher payer', () => {
    const result = checkChannelSettlement(channelSettleSummary());
    expect(result.ok).toBe(true);
    expect(result.payer).toBe(payer.publicKey.toBase58());
    expect(result.slot).toBe(42);
  });

  it('rejects a different voucher key, a token transfer, and a non-settle discriminator', () => {
    expect(checkChannelSettlement(channelSettleSummary(Keypair.generate().publicKey)).payer).not.toBe(payer.publicKey.toBase58());
    const withTransfer = channelSettleSummary(payer.publicKey, null, [
      new TransactionInstruction({ programId: new PublicKey(MEMO), keys: [], data: Buffer.from('extra') }),
    ]);
    expect(checkChannelSettlement(withTransfer).ok).toBe(false);
    const wrongDisc = channelSettleSummary();
    wrongDisc.instructions[1] = { ...wrongDisc.instructions[1], dataBase64: Buffer.from([7]).toString('base64') };
    expect(checkChannelSettlement(wrongDisc).ok).toBe(false);
  });

  it('rejects failed and missing transactions', () => {
    expect(checkChannelSettlement(channelSettleSummary(payer.publicKey, { InstructionError: [1, 'Custom'] })).ok).toBe(false);
    expect(checkChannelSettlement(null).reason).toContain('not found');
  });

  it('rejects a settle that also moves tokens', () => {
    const summary = channelSettleSummary();
    summary.tokenTransfers = [{ source: 's', destination: 'd', mint: 'm', amount: '10000', authority: payer.publicKey.toBase58() }];
    expect(checkChannelSettlement(summary)).toMatchObject({ ok: false, reason: expect.stringContaining('Ed25519') });
  });
});

describe('Web3ChainClient settle preflight', () => {
  function fakeConnection(statuses: Array<'processed' | 'confirmed' | 'finalized'>) {
    const calls: string[] = [];
    let index = 0;
    const connection = {
      rpcEndpoint: 'https://api.devnet.solana.com',
      async simulateTransaction() {
        calls.push('simulate');
        return { value: { err: null, logs: [], unitsConsumed: 12 } };
      },
      async sendRawTransaction() {
        calls.push('send');
        return 'sig';
      },
      async getLatestBlockhash() {
        return { blockhash, lastValidBlockHeight: 9 };
      },
      async getSignatureStatuses() {
        calls.push('status');
        const confirmationStatus = statuses[Math.min(index, statuses.length - 1)];
        index += 1;
        return { value: [{ err: null, confirmationStatus }] };
      },
    };
    return { calls, connection: connection as unknown as Connection };
  }

  const raw = () => Buffer.from(channelSettleTransaction().serialize()).toString('base64');

  it('simulates a settle on devnet and does not broadcast it', async () => {
    const fake = fakeConnection(['confirmed']);
    const result = await new Web3ChainClient(fake.connection).simulate(raw());
    expect(result.success).toBe(true);
    expect(fake.calls).toEqual(['simulate']);
  });

  it('confirms only after the status is confirmed or finalized', async () => {
    const processed = fakeConnection(['processed', 'confirmed']);
    await expect(new Web3ChainClient(processed.connection).sendAndConfirm(raw())).resolves.toBe('sig');
    expect(processed.calls.filter((call) => call === 'status')).toHaveLength(2);
    expect(processed.calls).toContain('send');

    const finalized = fakeConnection(['finalized']);
    await expect(new Web3ChainClient(finalized.connection).sendAndConfirm(raw())).resolves.toBe('sig');
    expect(finalized.calls.filter((call) => call === 'status')).toHaveLength(1);
  });

  it('refuses a mainnet endpoint', () => {
    expect(() => Web3ChainClient.fromUrl('https://api.mainnet-beta.solana.com')).toThrow('CRITICAL SAFETY FATAL');
  });
});

describe('checkRootAnchor', () => {
  const PROGRAM_ID = '11111111111111111111111111111112'; // any valid base58 pubkey works for a unit test
  const mandateHash = new Uint8Array(32).fill(7);
  const { address: mandatePda } = findMandatePda(PROGRAM_ID, mandateHash);
  const merkleRootHex = 'a'.repeat(64);

  function anchorRootTx(signer: Keypair, overrides: { seq?: bigint; merkleRootHex?: string; leafCount?: number; mandatePda?: string } = {}, err: unknown | null = null) {
    const seq = overrides.seq ?? 0n;
    const root = overrides.merkleRootHex ?? merkleRootHex;
    const leafCount = overrides.leafCount ?? 3;
    const targetMandatePda = overrides.mandatePda ?? mandatePda;
    const { address: rootPda } = findRootPda(PROGRAM_ID, targetMandatePda, seq);

    const discriminator = createHash('sha256').update('global:anchor_root').digest().subarray(0, 8);
    const body = Buffer.alloc(8 + 32 + 4);
    body.writeBigUInt64LE(seq, 0);
    Buffer.from(root, 'hex').copy(body, 8);
    body.writeUInt32LE(leafCount, 40);
    const data = Buffer.concat([discriminator, body]);

    const ix = new TransactionInstruction({
      programId: new PublicKey(PROGRAM_ID),
      keys: [
        { pubkey: new PublicKey(targetMandatePda), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(rootPda), isSigner: false, isWritable: true },
        { pubkey: signer.publicKey, isSigner: true, isWritable: true },
        { pubkey: PublicKey.default, isSigner: false, isWritable: false },
      ],
      data,
    });
    const message = new TransactionMessage({ payerKey: signer.publicKey, recentBlockhash: blockhash, instructions: [ix] }).compileToV0Message();
    return summarizeTransaction('anchor-root', new VersionedTransaction(message), { slot: 9, blockTime: 1_800_000_200, err });
  }

  const expected = (overrides: Partial<{ seq: bigint; merkleRoot: string; leafCount: number; signer: string }> = {}, signer: Keypair) => ({
    programId: PROGRAM_ID,
    mandatePda,
    signer: signer.publicKey.toBase58(),
    seq: 0n,
    merkleRoot: merkleRootHex,
    leafCount: 3,
    ...overrides,
  });

  it('accepts anchor_root_v2 with the batch header and file hash, and rejects a mismatched hash', () => {
    const instance = Keypair.generate();
    const v1 = anchorRootTx(instance);
    const ix = v1.instructions.find((i) => i.programId === PROGRAM_ID)!;
    const header = Buffer.alloc(32, 3);
    const file = Buffer.alloc(32, 4);
    const body = Buffer.from(ix.dataBase64, 'base64').subarray(8);
    const v2Disc = createHash('sha256').update('global:anchor_root_v2').digest().subarray(0, 8);
    ix.dataBase64 = Buffer.concat([v2Disc, body, header, file]).toString('base64');
    const ok = checkRootAnchor(v1, { ...expected({}, instance), batchHeader: header.toString('hex'), batchFileHash: file.toString('hex') });
    expect(ok.ok).toBe(true);
    const bad = checkRootAnchor(v1, { ...expected({}, instance), batchHeader: header.toString('hex'), batchFileHash: '05'.repeat(32) });
    expect(bad.ok).toBe(false);
  });

  it('rejects a memo on an otherwise valid anchor_root', () => {
    const instance = Keypair.generate();
    const tx = anchorRootTx(instance);
    tx.memos.push('atlasrail:anchor:v1:nope');
    tx.programIds.push('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
    expect(checkRootAnchor(tx, expected({}, instance)).ok).toBe(false);
  });

  it('accepts a successful anchor_root transaction with matching seq, root and leaf count', () => {
    const instance = Keypair.generate();
    const result = checkRootAnchor(anchorRootTx(instance), expected({}, instance));
    expect(result.ok).toBe(true);
    expect(result.slot).toBe(9);
  });

  it('accepts a non-zero seq', () => {
    const instance = Keypair.generate();
    const result = checkRootAnchor(anchorRootTx(instance, { seq: 5n }), expected({ seq: 5n }, instance));
    expect(result.ok).toBe(true);
  });

  it('rejects a mismatched seq, merkle root, or leaf count', () => {
    const instance = Keypair.generate();
    const tx = anchorRootTx(instance);
    expect(checkRootAnchor(tx, expected({ seq: 1n }, instance)).ok).toBe(false);
    expect(checkRootAnchor(tx, expected({ merkleRoot: 'b'.repeat(64) }, instance)).ok).toBe(false);
    expect(checkRootAnchor(tx, expected({ leafCount: 4 }, instance)).ok).toBe(false);
  });

  it('rejects the wrong signer, wrong mandate PDA, a failed transaction, and a missing transaction', () => {
    const instance = Keypair.generate();
    const tx = anchorRootTx(instance);
    expect(checkRootAnchor(tx, expected({}, Keypair.generate())).ok).toBe(false);
    const otherMandate = findMandatePda(PROGRAM_ID, new Uint8Array(32).fill(9)).address;
    expect(checkRootAnchor(tx, { ...expected({}, instance), mandatePda: otherMandate }).ok).toBe(false);
    expect(checkRootAnchor(anchorRootTx(instance, {}, { err: 1 }), expected({}, instance)).ok).toBe(false);
    expect(checkRootAnchor(null, expected({}, instance)).ok).toBe(false);
  });

  it('rejects a transaction that does not invoke the mandate registry at all', () => {
    const instance = Keypair.generate();
    const summary = channelSettleSummary();
    expect(checkRootAnchor(summary, expected({}, instance)).ok).toBe(false);
  });
});
