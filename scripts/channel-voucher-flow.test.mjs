/**
 * Offline lock for the voucher scripts. The flow is not exported, and this must not open a channel.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scripts = dirname(fileURLToPath(import.meta.url));
const paymentSrc = readFileSync(join(scripts, '..', 'packages', 'atlasrails', 'payment.mjs'), 'utf8');
const fundSrc = readFileSync(join(scripts, '..', 'packages', 'atlasrails', 'channel-fund.mjs'), 'utf8');
const devnetSrc = `${fundSrc}\n${paymentSrc}`;
const anchorSrc = readFileSync(join(scripts, 'channel-voucher-anchor.mjs'), 'utf8');

function order(source, markers) {
  let at = -1;
  for (const marker of markers) {
    const next = source.indexOf(marker, at + 1);
    assert.notEqual(next, -1, marker);
    assert.ok(next > at, marker);
    at = next;
  }
}

test('devnet script opens, denies an unsigned random recipient, signs one cumulative voucher, settles, distributes, and withdraws the leftover', () => {
  order(devnetSrc, [
    'const openIx',
    'recipient: payment.deniedRecipient',
    'denial = { signed: false',
    'cumulativeAmount: settledAmount.toString()',
    'data: Buffer.from([2])',
    'ed25519Instruction(new PublicKey(agent.publicKey).toBytes(), allowed.signature, allowed.message)',
    'const distributeIx',
    'data: Buffer.from([8])',
  ]);
  assert.equal(devnetSrc.includes('createTransferInstruction'), false);
  assert.equal(devnetSrc.includes('createTransferCheckedInstruction'), false);
});

test('anchor script denies a random recipient, then create_mandate and anchor_root', () => {
  order(anchorSrc, [
    'recipient: Keypair.generate().publicKey.toBase58()',
    'denial = { signed: false',
    'buildCreateMandateTransaction',
    'programId: PROGRAM_ID',
  ]);
  assert.equal(anchorSrc.includes("mode: 'memo'"), false);
  assert.equal(anchorSrc.includes('buildAnchorTransaction'), false);
  assert.equal(anchorSrc.includes('const openIx'), false);
  assert.equal(anchorSrc.includes('createTransferCheckedInstruction'), false);
});

test('the settled voucher is requested from the Atlas Rail API', () => {
  const voucher = devnetSrc.slice(devnetSrc.indexOf('export async function createVoucher'));
  const anchorMain = anchorSrc.slice(anchorSrc.indexOf('async function main'));
  assert.ok(devnetSrc.includes('/v1/channel-voucher'));
  assert.equal(devnetSrc.includes('/v1/sign-voucher'), false);
  assert.ok(voucher.includes('askAtlasRail('));
  assert.equal(devnetSrc.includes('requestVoucher'), false);
  assert.equal(devnetSrc.includes('signVoucherWithAuthorization'), false);
  assert.equal(devnetSrc.includes('voucher-seed.json'), false);
  assert.equal(anchorSrc.includes('requestVoucher'), false);
  assert.equal(anchorSrc.includes('/v1/sign-voucher'), false);
  assert.ok(anchorMain.includes('askAtlasRail('));
});

test('treasury owner is the 32 bytes the deployed program loads', async () => {
  const { treasuryOwnerFromElf } = await import('./channel-voucher-devnet.mjs');
  const offset = Number(fundSrc.match(/TREASURY_OWNER_OFFSET = (\d+)/)[1]);
  const owner = Buffer.alloc(32, 7);
  const elf = Buffer.alloc(offset + 32);
  elf[0] = 0x7f;
  elf[1] = 0x45;
  elf[2] = 0x4c;
  elf[3] = 0x46;
  owner.copy(elf, offset);
  const load = Buffer.alloc(8);
  load[0] = 0x18;
  load[1] = 0x02;
  load.writeUInt32LE(offset, 4);
  load.copy(elf, 64);

  assert.ok(Buffer.from(treasuryOwnerFromElf(elf).toBytes()).equals(owner));
  assert.throws(() => treasuryOwnerFromElf(Buffer.from([0, 1, 2, 3])), /not an ELF/);
  const unloaded = Buffer.from(elf);
  unloaded.fill(0, 64, 72);
  assert.throws(() => treasuryOwnerFromElf(unloaded), /does not load the treasury owner/);
});
