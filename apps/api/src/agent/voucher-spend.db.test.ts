import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SOLANA_DEVNET_CAIP2, hashMandate } from '@atlas-rail/mandate';
import { NOW, TEST_MINT, TEST_ORIGIN, signedTestMandate, signers } from '@atlas-rail/mandate/testing';
import { PrismaClient, PrismaVoucherSpendStore } from '@atlas-rail/database';
import { GatedSignerAdapter, RunningSignerService, startSignerService } from '@atlas-rail/x402';
import { askChannelVoucher } from './channel-voucher';

/*
 * The voucher caps against a real Postgres: a restart and a second API process share the same
 * spend rows and the same advisory lock. Uses the embedded-postgres root devDependency, no Docker.
 */

type EmbeddedPostgresClass = new (options: Record<string, unknown>) => {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  createDatabase(name: string): Promise<void>;
};

const repoRoot = join(__dirname, '../../../..');
const port = 55000 + Math.floor(Math.random() * 2000);
const url = `postgresql://atlas:atlas@127.0.0.1:${port}/atlas_rail_test`;
let pg: { stop(): Promise<void> } | null = null;
let dataDir = '';
let signer: RunningSignerService | null = null;
let signerNow = NOW;
const clients: PrismaClient[] = [];

function client(): PrismaClient {
  const db = new PrismaClient({ datasources: { db: { url } } });
  clients.push(db);
  return db;
}

beforeAll(async () => {
  // embedded-postgres is ESM only and ships no types this tsconfig can resolve: import it by name at run time.
  const specifier = 'embedded-postgres';
  const { default: EmbeddedPostgres } = (await import(specifier)) as { default: EmbeddedPostgresClass };
  dataDir = mkdtempSync(join(tmpdir(), 'atlas-pg-'));
  const server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'atlas', password: 'atlas', port, persistent: false, onLog: () => {} });
  await server.initialise();
  await server.start();
  await server.createDatabase('atlas_rail_test');
  pg = server;
  const migrate = spawnSync(
    process.execPath,
    [join(repoRoot, 'packages/database/node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', join(repoRoot, 'packages/database/prisma/schema.prisma')],
    { env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' },
  );
  if (migrate.status !== 0) throw new Error(`migrate deploy failed: ${migrate.stderr || migrate.stdout}`);

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
    clock: () => signerNow,
  });
  signer = await startSignerService({ signer: gated, host: '127.0.0.1', port: 0 });
}, 120_000);

afterAll(async () => {
  await Promise.all(clients.map((db) => db.$disconnect().catch(() => undefined)));
  await signer?.close();
  await pg?.stop();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

function apiProcess(db: PrismaClient, now = NOW) {
  return {
    signerUrl: signer!.url,
    instance: signers.instance,
    clock: () => now,
    spends: new PrismaVoucherSpendStore(db),
    readChannel: async () => ({ payer: signers.facilitator.publicKey, payee: signers.merchant.publicKey, mint: TEST_MINT, settled: 0n }),
    readMandate: async () => ({ agent: signers.agent.publicKey, mint: TEST_MINT, revoked: false, revokedAt: 0 }),
  };
}

function ask(mandate: Awaited<ReturnType<typeof signedTestMandate>>, channelId: string, cumulativeAmount: string, now = NOW) {
  return {
    mandate,
    channelId,
    cumulativeAmount,
    expiresAt: now + 300,
    recipient: signers.merchant.publicKey,
    resourceUrl: `${TEST_ORIGIN}/research/summary`,
    asset: TEST_MINT,
    network: SOLANA_DEVNET_CAIP2,
  };
}

describe('voucher spend memory in Postgres', () => {
  it('keeps the window budget and the channel watermark after the API restarts', async () => {
    const mandate = await signedTestMandate({ maxPerWindow: '1500000' });
    const before = client();
    expect((await askChannelVoucher(ask(mandate, signers.facilitator.publicKey, '800000'), apiProcess(before))).signed).toBe(true);
    await before.$disconnect();

    const after = client();
    const next = await askChannelVoucher(ask(mandate, signers.facilitator.publicKey, '1000000'), apiProcess(after));
    expect(next.signed && next.deltaAmount).toBe('200000');
    const over = await askChannelVoucher(ask(mandate, signers.owner.publicKey, '800000'), apiProcess(after));
    expect(over.signed).toBe(false);
    const rows = await new PrismaVoucherSpendStore(after).list(hashMandate(mandate));
    expect(rows.map((row) => row.delta)).toEqual(['800000', '200000']);
  }, 60_000);

  it('lets only one of two API processes sign when together they would pass the window', async () => {
    const mandate = await signedTestMandate({ maxPerWindow: '1000000' });
    const [a, b] = await Promise.all([
      askChannelVoucher(ask(mandate, signers.facilitator.publicKey, '700000'), apiProcess(client())),
      askChannelVoucher(ask(mandate, signers.owner.publicKey, '700000'), apiProcess(client())),
    ]);
    expect([a.signed, b.signed].filter(Boolean)).toHaveLength(1);
  }, 60_000);

  it('frees the window budget once the window has passed, and keeps the lifetime total', async () => {
    const mandate = await signedTestMandate({ maxPerPayment: '1000000', maxPerWindow: '1000000', maxTotal: '1500000' });
    const db = client();
    expect((await askChannelVoucher(ask(mandate, signers.facilitator.publicKey, '900000'), apiProcess(db))).signed).toBe(true);
    // Inside the window a second 500000 does not fit 1000000.
    expect((await askChannelVoucher(ask(mandate, signers.owner.publicKey, '500000'), apiProcess(db))).signed).toBe(false);
    // After the mandate window has passed it does, because the window counts by time.
    const later = NOW + Number(mandate.scope.limits.windowSeconds) + 1;
    signerNow = later;
    try {
      const fits = await askChannelVoucher(ask(mandate, signers.owner.publicKey, '500000', later), apiProcess(db, later));
      expect(fits.signed).toBe(true);
      // The lifetime total still counts both: 900000 + 500000 + 200000 is above 1500000.
      const capped = await askChannelVoucher(ask(mandate, signers.merchant.publicKey, '200000', later), apiProcess(db, later));
      expect(capped.signed).toBe(false);
    } finally {
      signerNow = NOW;
    }
  }, 60_000);
});
