import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ownerApprovalMessage, toBase58 } from '@atlas-rail/mandate';
import { NOW, TEST_MINT, TEST_ORIGIN, signedTestMandate, signers } from '@atlas-rail/mandate/testing';
import { PrismaClient, PrismaDecisionReceiptStore, PrismaOwnerApprovalStore, PrismaPayOperationStore, PrismaVoucherSpendStore } from '@atlas-rail/database';
import { AnchorService, verifyDecisionReceipt } from '@atlas-rail/receipt';
import { ChainClient, ChainTransactionSummary, DevnetKeypairSigner, summarizeTransaction } from '@atlas-rail/solana';
import { OwnerApprovals } from './owner-approvals';
import { DEVNET_CAIP2, PayAuthority, type PayAnswer } from './pay-authority';

/*
 * The pay.sh authority on a real Postgres: decisions survive a restart, every gate decision (allow
 * and deny) is anchored by the same AnchorService the worker runs and verifies, and an owner
 * approval signed in another process lets that one operation through once.
 */

// The API has no direct @solana/web3.js dependency; use the copy @atlas-rail/solana is built on.
const { VersionedTransaction } = createRequire(require.resolve('@atlas-rail/solana'))('@solana/web3.js') as typeof import('@atlas-rail/solana/node_modules/@solana/web3.js');

type EmbeddedPostgresClass = new (options: Record<string, unknown>) => {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  createDatabase(name: string): Promise<void>;
};

const repoRoot = join(__dirname, '../../../..');
const port = 57000 + Math.floor(Math.random() * 2000);
const url = `postgresql://atlas:atlas@127.0.0.1:${port}/atlas_rail_test`;
let pg: { stop(): Promise<void> } | null = null;
let dataDir = '';
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
}, 120_000);

afterAll(async () => {
  await Promise.all(clients.map((db) => db.$disconnect()));
  await pg?.stop();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

function instanceTxSigner(): DevnetKeypairSigner {
  const seed = new Uint8Array(32);
  new TextEncoder().encode('instance').forEach((b, i) => (seed[i] = b));
  const previous = process.env.ATLAS_ALLOW_MOCK_SIGNER;
  process.env.ATLAS_ALLOW_MOCK_SIGNER = 'true';
  try {
    return new DevnetKeypairSigner(seed);
  } finally {
    if (previous === undefined) delete process.env.ATLAS_ALLOW_MOCK_SIGNER;
    else process.env.ATLAS_ALLOW_MOCK_SIGNER = previous;
  }
}

function stubChain(): ChainClient {
  const sent = new Map<string, InstanceType<typeof VersionedTransaction>>();
  let n = 0;
  return {
    async getLatestBlockhash() {
      return { blockhash: signers.merchant.publicKey, lastValidBlockHeight: 1 };
    },
    async getMintInfo() {
      return null;
    },
    async simulate() {
      throw new Error('not used in this test');
    },
    async sendAndConfirm(signedBase64: string) {
      const signature = `sig_${++n}`;
      sent.set(signature, VersionedTransaction.deserialize(Buffer.from(signedBase64, 'base64')));
      return signature;
    },
    async getTransactionSummary(signature: string): Promise<ChainTransactionSummary | null> {
      const tx = sent.get(signature);
      return tx ? summarizeTransaction(signature, tx, { slot: n, blockTime: NOW, err: null }) : null;
    },
  };
}

function spend(overrides: Record<string, unknown> = {}) {
  const recipient = (overrides.recipient as string) ?? signers.merchant.publicKey;
  return {
    operation_id: 'op-1',
    attempt_id: 'attempt-1',
    caller_id: 'research-agent',
    request: { method: 'GET', url: `${TEST_ORIGIN}/research/summary`, headers: [['accept', 'application/json']], body: null },
    amount_atomic: '10000',
    asset: TEST_MINT,
    network: DEVNET_CAIP2,
    execution_network: 'devnet',
    recipient,
    accepted: { scheme: 'exact', network: DEVNET_CAIP2, amount: '10000', asset: TEST_MINT, payTo: recipient, maxTimeoutSeconds: 60, extra: { decimals: 6 } },
    ...overrides,
  };
}

describe('pay.sh authority on Postgres', () => {
  it('keeps decisions across a restart and anchors every gate decision, allow and deny', async () => {
    const mandate = await signedTestMandate();
    let n = 0;
    const authorityOn = (db: PrismaClient) =>
      new PayAuthority({
        callers: async (id) => (id === 'research-agent' ? { mandate } : null),
        instance: signers.instance,
        spends: new PrismaVoucherSpendStore(db),
        operations: new PrismaPayOperationStore(db),
        saveReceipt: (receipt) => new PrismaDecisionReceiptStore(db).insert(receipt),
        approvals: null,
        readMandate: async () => ({ revoked: false, revokedAt: 0 }),
        clock: () => NOW,
        newId: (p) => `${p}_${++n}`,
        onError: (error) => errors.push(error),
      });
    const errors: unknown[] = [];

    const allowed = (await authorityOn(client()).authorize(spend())) as PayAnswer;
    expect(errors).toEqual([]);
    expect(allowed.decision).toBe('allow');
    const denied = (await authorityOn(client()).authorize(spend({ operation_id: 'op-2', recipient: signers.owner.publicKey }))) as PayAnswer;
    expect(denied.decision).toBe('deny');

    // A fresh process (new client, new authority) still knows op-1 was allowed once.
    const again = (await authorityOn(client()).authorize(spend({ attempt_id: 'attempt-2' }))) as PayAnswer;
    expect(again).toMatchObject({ decision: 'deny', reason: 'This operation was already allowed once. A new attempt is never allowed again.' });

    const store = new PrismaDecisionReceiptStore(client());
    const chain = stubChain();
    const signer = instanceTxSigner();
    expect(signer.publicKey).toBe(signers.instance.publicKey);
    const anchor = new AnchorService({
      receipts: store.asAnchorStore(),
      chain,
      signer,
      clock: () => NOW,
      newId: (p) => `${p}_${++n}`,
      loadMandate: async () => ({
        mandateHash: '0'.repeat(64),
        owner: signers.owner.publicKey,
        approver: signers.approver.publicKey,
        agent: signers.agent.publicKey,
        gateAuthority: signers.instance.publicKey,
        mint: TEST_MINT,
        maxPerPayment: 0n,
        maxPerWindow: 0n,
        windowSeconds: 0n,
        maxTotal: 0n,
        escalationThreshold: 0n,
        notBefore: 0n,
        expiresAt: 0n,
        createdAt: 0n,
        revoked: false,
        revokedAt: 0n,
        revokedBy: '',
        nextRootSeq: 0n,
        bump: 255,
      }),
    });
    // Every gate decision has a receipt, allow and deny. The refused retry never reached the rules:
    // it is a signed answer (checked in pay-authority.test.ts) with no receipt.
    expect(again.receipt_id).toBeNull();
    expect((await anchor.run())?.anchored).toBe(2);
    expect(await anchor.run()).toBeNull();

    for (const answer of [allowed, denied]) {
      const receipt = (await store.get(answer.receipt_id!))!;
      expect(receipt.anchor?.mechanism).toBe('root');
      const verified = await verifyDecisionReceipt(receipt, { chain, trustedInstanceKeys: [signers.instance.publicKey], requireAnchor: true });
      expect(verified.checks.filter((c) => c.status === 'FAIL')).toEqual([]);
      expect(verified.pass).toBe(true);
    }
  }, 120_000);

  it('over the limit: the owner approves from another process, and the retry is allowed once', async () => {
    const mandate = await signedTestMandate();
    let n = 100;
    const errors: unknown[] = [];
    const telegram = { token: 't', ownerChatId: '777' };
    const fakeTelegram = async (input: unknown) => new Response(JSON.stringify({ ok: true, result: String(input).endsWith('sendMessage') ? { message_id: 1 } : true }));
    const approvalsOn = (db: PrismaClient) =>
      new OwnerApprovals({ store: new PrismaOwnerApprovalStore(db), telegram, clock: () => NOW, newId: (p) => `${p}_${++n}`, fetch: fakeTelegram as typeof fetch });
    const authorityOn = (db: PrismaClient) =>
      new PayAuthority({
        callers: async (id) => (id === 'research-agent' ? { mandate } : null),
        instance: signers.instance,
        spends: new PrismaVoucherSpendStore(db),
        operations: new PrismaPayOperationStore(db),
        saveReceipt: (receipt) => new PrismaDecisionReceiptStore(db).insert(receipt),
        approvals: approvalsOn(db),
        readMandate: async () => ({ revoked: false, revokedAt: 0 }),
        clock: () => NOW,
        newId: (p) => `${p}_${++n}`,
        onError: (error) => errors.push(error),
      });
    const big = (attempt: string) => spend({ operation_id: 'op-owner', attempt_id: attempt, amount_atomic: '2000000', accepted: { scheme: 'exact', network: DEVNET_CAIP2, amount: '2000000', asset: TEST_MINT, payTo: signers.merchant.publicKey, maxTimeoutSeconds: 60, extra: { decimals: 6 } } });

    const waiting = (await authorityOn(client()).authorize(big('attempt-1'))) as PayAnswer;
    expect(errors).toEqual([]);
    expect(waiting).toMatchObject({ decision: 'reject_before_execution', reason: 'Needs owner approval.' });
    // The owner's wallet signs in its own process. Telegram only told them the request exists.
    const other = approvalsOn(client());
    const found = (await other.toSign(waiting.approval_id!))!;
    const signature = toBase58(await signers.owner.signMessage(ownerApprovalMessage(found.terms)));
    expect(await other.submitSignature(waiting.approval_id!, { scheme: 'ed25519', signer: signers.owner.publicKey, signature })).toMatchObject({ ok: true });
    expect(await authorityOn(client()).authorize(big('attempt-2'))).toMatchObject({ decision: 'allow', reason: "Allowed once with the owner's approval." });
    expect(await authorityOn(client()).authorize(big('attempt-3'))).toMatchObject({ decision: 'deny', reason: 'This operation was already allowed once. A new attempt is never allowed again.' });
    expect(errors).toEqual([]);
  }, 120_000);
});
