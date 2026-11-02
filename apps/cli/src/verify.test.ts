import { createRequire } from 'module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';
import { buildDecisionRecord, evaluateGate, signDecision } from '@atlas-rail/mandate';
import { testContext, testOffer } from '@atlas-rail/mandate/testing';
import { WORLD_ORG, createWorld } from '@atlas-rail/receipt/testing';
import { AnchorService, buildDecisionReceipt, buildReceipt, hashResponseBody } from '@atlas-rail/receipt';
import { fetchMandateAccount, summarizeTransaction, type ChainClient } from '@atlas-rail/solana';
import { runVerify, runVerifyMandate } from './verify';

vi.mock('@atlas-rail/solana', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@atlas-rail/solana')>();
  return { ...actual, fetchMandateAccount: vi.fn() };
});

const requireFromSolana = createRequire(join(__dirname, '../../../packages/solana/package.json'));
const { VersionedTransaction } = requireFromSolana('@solana/web3.js') as typeof import('@solana/web3.js');

const TEMP = tmpdir();
const PROGRAM_ID = 'CnGoTE5Bxc8MFGaeK5LDv5uAZ7pNiktMunYy8JZcLY4k';
const RPC_URL = 'https://api.devnet.solana.com';
const VOUCHER = 'application/vnd.payment-channels.voucher';

function anchorChain(blockTime: number): ChainClient {
  const sent = new Map<string, string>();
  let n = 0;
  return {
    async getLatestBlockhash() {
      return { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1 };
    },
    async getMintInfo() {
      return null;
    },
    async simulate() {
      throw new Error('not used');
    },
    async sendAndConfirm(signedBase64: string) {
      const signature = `sig_${++n}`;
      sent.set(signature, signedBase64);
      return signature;
    },
    async getTransactionSummary(signature: string) {
      const raw = sent.get(signature);
      if (!raw) return null;
      return summarizeTransaction(signature, VersionedTransaction.deserialize(Buffer.from(raw, 'base64')), {
        slot: n,
        blockTime,
        err: null,
      });
    },
  };
}

/** Voucher receipt, then anchor_root the way the channel path does. */
async function anchoredReceiptFile() {
  const world = await createWorld();
  const offer = testOffer({
    payTo: world.keys.merchant.publicKey,
    feePayer: world.keys.facilitator.publicKey,
    memo: `channel:${world.keys.facilitator.publicKey}`,
  });
  const context = testContext({ now: world.clock.now, simulation: null, requireSimulation: false });
  const gate = evaluateGate(world.mandate, offer, context);
  expect(gate.decision).toBe('ALLOW');
  const decision = await signDecision(
    buildDecisionRecord({
      id: 'dec_voucher',
      organizationId: WORLD_ORG,
      mandate: world.mandate,
      offer,
      result: gate,
      context,
      request: null,
    }),
    world.keys.instance,
  );
  const receipt = await buildReceipt(
    {
      id: 'rcp_voucher',
      mandate: world.mandate,
      decision,
      settlement: {
        txSignature: 'V'.repeat(88),
        network: offer.network,
        payer: world.mandate.agent.publicKey,
        settledAt: world.clock.now,
        slot: 9,
      },
      response: { status: 200, bodySha256: hashResponseBody('voucher'), contentType: VOUCHER },
      issuedAt: world.clock.now,
    },
    world.keys.instance,
  );
  await world.receipts.insert({ organizationId: WORLD_ORG, receipt, createdAt: world.clock.now, batchId: null });
  vi.mocked(fetchMandateAccount).mockResolvedValue({
    mandateHash: '0'.repeat(64),
    owner: world.keys.owner.publicKey,
    approver: world.keys.approver.publicKey,
    agent: world.keys.agent.publicKey,
    gateAuthority: world.keys.instance.publicKey,
    mint: offer.asset,
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
    nextRootSeq: 1n,
    bump: 255,
  });
  const anchored = await new AnchorService({
    receipts: world.receipts,
    chain: anchorChain(world.clock.now),
    signer: world.keys.instance,
    clock: () => world.clock.now,
    newId: (prefix) => `${prefix}_channel`,
    rpcUrl: RPC_URL,
    programId: PROGRAM_ID,
  }).run();
  expect(anchored?.anchored).toBe(1);
  const stored = (await world.receipts.get(WORLD_ORG, receipt.id))!.receipt;
  expect(stored.response.contentType).toBe(VOUCHER);
  expect(stored.anchor?.mechanism).toBe('root');
  mkdirSync(TEMP, { recursive: true });
  const dir = mkdtempSync(join(TEMP, 'atlas-cli-'));
  const file = join(dir, 'receipt.json');
  writeFileSync(file, JSON.stringify(stored, null, 2));
  return { file, dir, stored, world };
}

const base = { rpc: null, offline: true, trustedKeys: [], checkSettlement: false, requireAnchor: false, json: false, color: false };

describe('atlas verify', () => {
  it('prints PASS for every offline check and exits 0', async () => {
    const { file, world } = await anchoredReceiptFile();
    const lines: string[] = [];
    const code = await runVerify({ ...base, file, trustedKeys: [world.keys.instance.publicKey], requireAnchor: true }, (l) => lines.push(l));
    const output = lines.join('\n');
    expect(code).toBe(0);
    expect(output).toContain('RESULT: PASS');
    expect(output).toMatch(/PASS\s+Receipt binds mandate/);
    expect(output).toMatch(/PASS\s+Mandate delegation chain/);
    expect(output).toMatch(/PASS\s+Merkle inclusion/);
    expect(output).toMatch(/SKIP\s+Merkle root anchored on Solana devnet/);
    expect(output).not.toMatch(/FAIL\s/);
  });

  it('exits 1 with a FAIL line when the receipt has been tampered with', async () => {
    const { file, stored, dir } = await anchoredReceiptFile();
    const tampered = JSON.parse(JSON.stringify(stored));
    tampered.offer.amount = '1';
    const tamperedFile = join(dir, 'tampered.json');
    writeFileSync(tamperedFile, JSON.stringify(tampered));
    const lines: string[] = [];
    const code = await runVerify({ ...base, file: tamperedFile }, (l) => lines.push(l));
    expect(code).toBe(1);
    expect(lines.join('\n')).toContain('RESULT: FAIL');
    expect(lines.join('\n')).toMatch(/FAIL\s+Receipt binds/);
    void file;
  });

  it('exits 1 when no trusted instance key is configured', async () => {
    const { file } = await anchoredReceiptFile();
    const lines: string[] = [];
    const code = await runVerify({ ...base, file }, (l) => lines.push(l));
    expect(code).toBe(1);
    expect(lines.join('\n')).toContain('Trusted instance keys must be configured');
  });

  it('exits 1 when a pinned instance key does not match', async () => {
    const { file } = await anchoredReceiptFile();
    const lines: string[] = [];
    const code = await runVerify({ ...base, file, trustedKeys: ['11111111111111111111111111111111'] }, (l) => lines.push(l));
    expect(code).toBe(1);
    expect(lines.join('\n')).toMatch(/FAIL\s+Signed by the Atlas Rail instance key/);
  });

  it('emits machine-readable JSON with --json', async () => {
    const { file, world } = await anchoredReceiptFile();
    const lines: string[] = [];
    await runVerify({ ...base, file, trustedKeys: [world.keys.instance.publicKey], json: true }, (l) => lines.push(l));
    const parsed = JSON.parse(lines.join('\n'));
    expect(parsed.pass).toBe(true);
    expect(parsed.checks.length).toBeGreaterThan(5);
  });

  it('verifies a pay.sh decision receipt, and fails it when tampered or when no key is pinned', async () => {
    const world = await createWorld();
    const offer = testOffer({ payTo: world.keys.merchant.publicKey, feePayer: world.keys.facilitator.publicKey });
    const context = testContext({ now: world.clock.now, simulation: null, requireSimulation: false });
    const gate = evaluateGate(world.mandate, offer, context);
    const decision = await signDecision(
      buildDecisionRecord({ id: 'dec_pay', organizationId: WORLD_ORG, mandate: world.mandate, offer, result: gate, context, request: null }),
      world.keys.instance,
    );
    const receipt = await buildDecisionReceipt(
      {
        id: 'drc_pay',
        mandate: world.mandate,
        decision,
        answer: { decision: 'allow', reason: 'Allowed by the mandate.', operation_id: 'op-1', attempt_id: 'a-1', caller_id: 'research-agent', request_sha256: '0'.repeat(64), offer_hash: '0'.repeat(64) },
        issuedAt: world.clock.now,
      },
      world.keys.instance,
    );
    const dir = mkdtempSync(join(TEMP, 'atlas-cli-'));
    const file = join(dir, 'decision.json');
    writeFileSync(file, JSON.stringify(receipt));
    const lines: string[] = [];
    expect(await runVerify({ ...base, file, trustedKeys: [world.keys.instance.publicKey] }, (l) => lines.push(l))).toBe(0);
    expect(lines.join('\n')).toMatch(/PASS\s+An allow is backed by a gate ALLOW/);
    expect(await runVerify({ ...base, file }, () => {})).toBe(1);
    const tampered = join(dir, 'tampered.json');
    writeFileSync(tampered, JSON.stringify({ ...receipt, answer: { ...receipt.answer, reason: 'changed' } }));
    expect(await runVerify({ ...base, file: tampered, trustedKeys: [world.keys.instance.publicKey] }, () => {})).toBe(1);
  });

  it('exits 2 for unreadable files, invalid JSON and mainnet RPC endpoints', async () => {
    const { file, dir } = await anchoredReceiptFile();
    expect(await runVerify({ ...base, file: join(dir, 'missing.json') }, () => {})).toBe(2);
    const junk = join(dir, 'junk.json');
    writeFileSync(junk, 'not json');
    expect(await runVerify({ ...base, file: junk }, () => {})).toBe(2);
    const lines: string[] = [];
    expect(await runVerify({ ...base, file, offline: false, rpc: 'https://api.mainnet-beta.solana.com' }, (l) => lines.push(l))).toBe(2);
    expect(lines.join('\n')).toMatch(/Mainnet/i);
  });
});

describe('atlas mandate', () => {
  it('verifies a mandate document and rejects a tampered one', async () => {
    const { stored, dir } = await anchoredReceiptFile();
    const good = join(dir, 'mandate.json');
    writeFileSync(good, JSON.stringify(stored.mandate));
    const lines: string[] = [];
    expect(runVerifyMandate(good, false, (l) => lines.push(l))).toBe(0);
    const bad = JSON.parse(JSON.stringify(stored.mandate));
    bad.scope.limits.maxTotal = '999999999999';
    const badFile = join(dir, 'bad.json');
    writeFileSync(badFile, JSON.stringify(bad));
    expect(runVerifyMandate(badFile, false, () => {})).toBe(1);
  });
});
