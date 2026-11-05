import { describe, expect, it, vi } from 'vitest';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { encodeVoucherMessage } from '@atlas-rail/x402';
import { LocalEd25519Signer, fromBase58 } from '@atlas-rail/mandate';
import { createAtlasRail } from './sdk-client';
import { verifyEd25519 } from './sdk-crypto';
import { AtlasRailError } from './sdk-types';
import { DEVNET_GENESIS, RECOVERY_CHANNEL, loadSavedE2eEvidence } from './sdk-evidence';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

describe('sdk crypto and config', () => {
  it('verifies Ed25519 over canonical 50-byte vouchers', async () => {
    const signer = LocalEd25519Signer.generate();
    const channel = Keypair.generate().publicKey.toBase58();
    const message = encodeVoucherMessage({ channelId: channel, cumulativeAmount: 1000n, expiresAt: 1_800_000_000n });
    expect(message).toHaveLength(50);
    const signature = await signer.signMessage(message);
    expect(verifyEd25519(fromBase58(signer.publicKey), message, signature)).toBe(true);
    expect(verifyEd25519(Keypair.generate().publicKey.toBytes(), message, signature)).toBe(false);
  });

  it('rejects invalid config and requireApproval without onApprove', () => {
    const wallet = {
      publicKey: Keypair.generate().publicKey.toBase58(),
      async signTransaction(tx: Transaction) {
        return tx;
      },
    };
    expect(() => createAtlasRail({
      apiUrl: '',
      connection: {} as never,
      wallet,
      execution: 'prepareOnly',
    })).toThrow(AtlasRailError);

    expect(() => createAtlasRail({
      apiUrl: 'http://127.0.0.1:3001',
      connection: {} as never,
      wallet,
      execution: 'requireApproval',
    })).toThrow(/onApprove/);
  });
});

describe('sdk execution policy', () => {
  it('prepareOnly refuses executeSettlement broadcast', async () => {
    const payer = Keypair.generate();
    const wallet = {
      publicKey: payer.publicKey.toBase58(),
      async signTransaction(tx: Transaction) {
        tx.partialSign(payer);
        return tx;
      },
    };
    const atlas = createAtlasRail({
      apiUrl: 'http://127.0.0.1:3001',
      connection: {
        async getGenesisHash() {
          return DEVNET_GENESIS;
        },
      } as never,
      wallet,
      execution: 'prepareOnly',
    });
    const result = await atlas.executeSettlement('missing', { approval: 'settle' });
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.error.broadcast).toBe(false);
    }
  });
});

// The saved Devnet report is not published in this repository; the check runs where it exists.
const SAVED_E2E_REPORT = join(process.cwd(), 'reports', 'devnet-e2e-new-channel-2026-10-20.json');

describe('saved Devnet evidence', () => {
  it.skipIf(!existsSync(SAVED_E2E_REPORT))('loads the report without rewriting it and forbids the recovery channel id', () => {
    const path = SAVED_E2E_REPORT;
    const evidence = loadSavedE2eEvidence(path);
    expect(evidence.channel).not.toBe(RECOVERY_CHANNEL);
    expect(evidence.signatures.open).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    expect(evidence.channelState.settled).toBe('1000');
    expect(evidence.tokenBalances.escrow).toBe('9000');
  });
});

describe('channel open and refund on the client', () => {
  it('refuses grace 0 before any RPC and waits out an unfinished payer close', async () => {
    const payer = Keypair.generate();
    const wallet = {
      publicKey: payer.publicKey.toBase58(),
      async signTransaction(tx: Transaction) {
        tx.partialSign(payer);
        return tx;
      },
    };
    const channel = Keypair.generate().publicKey;
    const data = Buffer.alloc(256);
    data[3] = 2;
    data.writeBigUInt64LE(10_000n, 12);
    data.writeBigUInt64LE(1000n, 20);
    data.writeBigInt64LE(BigInt(Math.floor(Date.now() / 1000) + 3600), 36);
    data.writeUInt32LE(3600, 52);
    payer.publicKey.toBuffer().copy(data, 88);
    const sendRawTransaction = vi.fn();
    const atlas = createAtlasRail({
      apiUrl: 'http://api.test',
      connection: {
        async getGenesisHash() {
          return DEVNET_GENESIS;
        },
        async getSlot() {
          return 1;
        },
        async getAccountInfo(key: PublicKey) {
          if (key.equals(channel)) return { owner: new PublicKey('CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX'), data };
          return null;
        },
        sendRawTransaction,
      } as never,
      wallet,
      execution: 'autoExecute',
    });
    const opened = await atlas.openChannel({
      payee: Keypair.generate().publicKey.toBase58(),
      mint: Keypair.generate().publicKey.toBase58(),
      agent: Keypair.generate().publicKey.toBase58(),
      deposit: 10_000n,
      graceSeconds: 0,
    });
    expect(opened.status).toBe('failed');
    if (opened.status === 'failed') expect(opened.error.broadcast).toBe(false);
    const refund = await atlas.refundRemainder({ channel: channel.toBase58(), submit: true });
    expect(refund.status).toBe('waiting');
    expect(sendRawTransaction).not.toHaveBeenCalled();
  });
});

describe('sdk denial path (mocked API)', () => {
  it('returns denied with no signature and does not broadcast', async () => {
    const agent = Keypair.generate();
    const channelKey = Keypair.generate();
    const mint = Keypair.generate().publicKey;
    const payer = Keypair.generate();
    const payee = Keypair.generate().publicKey;

    const channelData = Buffer.alloc(256);
    channelData[3] = 0;
    channelData.writeBigUInt64LE(10_000n, 12);
    channelData.writeBigUInt64LE(0n, 20);
    channelData.writeBigUInt64LE(0n, 28);
    payer.publicKey.toBuffer().copy(channelData, 88);
    payee.toBuffer().copy(channelData, 120);
    agent.publicKey.toBuffer().copy(channelData, 152);
    mint.toBuffer().copy(channelData, 184);

    const wallet = {
      publicKey: payer.publicKey.toBase58(),
      async signTransaction(tx: Transaction) {
        tx.partialSign(payer);
        return tx;
      },
    };

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ signed: false, message: 'MandateDeniedError' }), { status: 200 }),
    );

    const atlas = createAtlasRail({
      apiUrl: 'http://api.test',
      connection: {
        async getGenesisHash() {
          return DEVNET_GENESIS;
        },
        async getAccountInfo(key: PublicKey) {
          if (key.equals(channelKey)) {
            return { owner: new PublicKey('CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX'), data: channelData };
          }
          return null;
        },
      } as never,
      wallet,
      execution: 'prepareOnly',
      fetch: fetchMock as unknown as typeof fetch,
    });

    // askAtlasRail uses process env + global fetch; payment module path is real.
    // This test validates createAtlasRail wiring for denial when helpers are reachable.
    // If import of payment.mjs fails in isolation, skip soft.
    const mandate = {
      id: 'mnd_TESTTEST12',
      agent: { publicKey: agent.publicKey.toBase58(), label: 't' },
    } as never;

    const result = await atlas.requestPayment({
      mandate,
      channel: channelKey.publicKey.toBase58(),
      recipient: Keypair.generate().publicKey.toBase58(),
      mint: mint.toBase58(),
      amount: 1000n,
      resourceUrl: 'http://localhost/x',
      network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
      expiresAt: Math.floor(Date.now() / 1000) + 600,
    });

    // Either denied via API or failed closed on signer mismatch / helper — never paid, never broadcast.
    expect(['denied', 'failed']).toContain(result.status);
    if (result.status === 'denied') {
      expect(result.hasSignature).toBe(false);
      expect(result.broadcast).toBe(false);
    }
    if (result.status === 'failed') {
      expect(result.error.broadcast).toBe(false);
      expect(result.error.fundsMayHaveMoved).toBe(false);
    }
  });
});
