import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { WORLD_ORG, createWorld } from '@atlas-rail/receipt/testing';
import { hashResponseBody } from '@atlas-rail/receipt';
import { runVerify, runVerifyMandate } from './verify';

async function anchoredReceiptFile() {
  const world = await createWorld();
  const { outcome, transactionBase64 } = await world.requestGate({ amount: '10000' });
  const txSignature = await world.settle(transactionBase64);
  const receipt = await world.receiptService.issue(WORLD_ORG, {
    decisionId: outcome.decision.record.id,
    txSignature,
    response: { status: 200, bodySha256: hashResponseBody('ok'), contentType: 'text/plain' },
  });
  await world.anchorService.run();
  const stored = (await world.receipts.get(WORLD_ORG, receipt.id))!.receipt;
  const dir = mkdtempSync(join(tmpdir(), 'atlas-cli-'));
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

  it('exits 1 when a pinned instance key does not match', async () => {
    const { file } = await anchoredReceiptFile();
    const lines: string[] = [];
    const code = await runVerify({ ...base, file, trustedKeys: ['11111111111111111111111111111111'] }, (l) => lines.push(l));
    expect(code).toBe(1);
    expect(lines.join('\n')).toMatch(/FAIL\s+Signed by the Atlas Rail instance key/);
  });

  it('emits machine-readable JSON with --json', async () => {
    const { file } = await anchoredReceiptFile();
    const lines: string[] = [];
    await runVerify({ ...base, file, json: true }, (l) => lines.push(l));
    const parsed = JSON.parse(lines.join('\n'));
    expect(parsed.pass).toBe(true);
    expect(parsed.checks.length).toBeGreaterThan(5);
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
