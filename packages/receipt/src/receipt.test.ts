import { Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { describe, expect, it, vi } from 'vitest';
import {
  LocalEd25519Signer,
  SIGNATURE_DOMAIN,
  buildDecisionRecord,
  evaluateGate,
  hashMandate,
  hashOffer,
  sha256Hex,
  signDecision,
  signDomainHash,
  verifyDecisionMatchesScope,
} from '@atlas-rail/mandate';
import { NOW, signedTestMandate, signers, testContext, testOffer as mandateTestOffer } from '@atlas-rail/mandate/testing';
import { ChainClient, ChainTransactionSummary, DevnetKeypairSigner, fetchMandateAccount, findMandatePda, summarizeTransaction } from '@atlas-rail/solana';
import { WORLD_ORG, World, createWorld, testOffer } from './testing';
import { BoundReceipt, ReceiptBuildError, buildReceipt, verifyReceipt } from './receipt';
import { AnchorService, InMemoryReceiptStore, hashResponseBody } from './service';

vi.mock('@atlas-rail/solana', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@atlas-rail/solana')>();
  return { ...actual, fetchMandateAccount: vi.fn() };
});

const VOUCHER_CONTENT_TYPE = 'application/vnd.payment-channels.voucher';
const ED25519_PROGRAM = 'Ed25519SigVerify111111111111111111111111111';
const CHANNEL_PROGRAM = 'CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX';
const INSTRUCTIONS_SYSVAR = 'Sysvar1nstructions1111111111111111111111111';

/** The 50-byte payment-channels voucher: magic, channel, u64 LE cumulative, i64 LE expiry. */
function voucherBytes(channel: PublicKey, cumulative: bigint, expiresAt: bigint): Buffer {
  const out = Buffer.alloc(50);
  out[0] = 0x56;
  out[1] = 0x01;
  channel.toBuffer().copy(out, 2);
  out.writeBigUInt64LE(cumulative, 34);
  out.writeBigInt64LE(expiresAt, 42);
  return out;
}

function channelSettleSummary(
  agent: string,
  signature = 'V'.repeat(88),
  blockTime: number = NOW,
  channel: PublicKey = Keypair.generate().publicKey,
  message: Buffer = voucherBytes(channel, 10_000n, BigInt(NOW + 600)),
): ChainTransactionSummary {
  const pubkeyOffset = 16;
  const signatureOffset = 48;
  const messageOffset = 112;
  const data = Buffer.alloc(messageOffset + message.length);
  data[0] = 1;
  data.writeUInt16LE(signatureOffset, 2);
  data.writeUInt16LE(0xffff, 4);
  data.writeUInt16LE(pubkeyOffset, 6);
  data.writeUInt16LE(0xffff, 8);
  data.writeUInt16LE(messageOffset, 10);
  data.writeUInt16LE(message.length, 12);
  data.writeUInt16LE(0xffff, 14);
  Buffer.from(new PublicKey(agent).toBytes()).copy(data, pubkeyOffset);
  message.copy(data, messageOffset);
  const compiled = new TransactionMessage({
    payerKey: Keypair.generate().publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions: [
      new TransactionInstruction({ programId: new PublicKey(ED25519_PROGRAM), keys: [], data }),
      new TransactionInstruction({
        programId: new PublicKey(CHANNEL_PROGRAM),
        keys: [
          { pubkey: channel, isSigner: false, isWritable: true },
          { pubkey: new PublicKey(INSTRUCTIONS_SYSVAR), isSigner: false, isWritable: false },
        ],
        data: Buffer.from([2]),
      }),
    ],
  }).compileToV0Message();
  return summarizeTransaction(signature, new VersionedTransaction(compiled), { slot: 9, blockTime, err: null });
}

const settleOverlays = new WeakMap<World, Map<string, ChainTransactionSummary>>();

function publishSummary(world: World, summary: ChainTransactionSummary) {
  let overlays = settleOverlays.get(world);
  if (!overlays) {
    overlays = new Map();
    settleOverlays.set(world, overlays);
    const original = world.chain.getTransactionSummary.bind(world.chain);
    world.chain.getTransactionSummary = async (signature: string) => overlays!.get(signature) ?? original(signature);
  }
  overlays.set(summary.signature, summary);
}

let voucherSeq = 0;

/** Same receipt shape as VoucherAuthorizer.recordAllowedReceipt: an ALLOW decision, voucher bytes, no SPL transfer. */
async function recordAllowed(
  world: World,
  amount = '10000',
  opts: { message?: Uint8Array; txSignature?: string } = {},
) {
  // A real voucher for a channel derived from the label, so the settle verifies the same bytes.
  const label = opts.message ?? new TextEncoder().encode(`voucher-${amount}-${++voucherSeq}`);
  const channel = new PublicKey(Buffer.from(sha256Hex(label), 'hex'));
  const message = voucherBytes(channel, BigInt(amount), BigInt(world.clock.now + 600));
  const messageHash = sha256Hex(message);
  const offer = testOffer({
    payTo: world.keys.merchant.publicKey,
    feePayer: world.keys.facilitator.publicKey,
    amount,
    memo: `channel:${channel.toBase58()}`,
  });
  const context = testContext({ now: world.clock.now, simulation: null, requireSimulation: false });
  const result = evaluateGate(world.mandate, offer, context);
  if (result.decision !== 'ALLOW') throw new Error(`A denied voucher cannot produce a payment receipt`);
  const existingId = `rcp_${messageHash.slice(0, 16)}`;
  const stored = await world.receipts.get(WORLD_ORG, existingId);
  if (stored) return { receipt: stored.receipt, txSignature: stored.receipt.settlement.txSignature, offer: stored.receipt.offer, messageHash };

  const decision = await signDecision(
    buildDecisionRecord({
      id: `dec_${messageHash.slice(0, 16)}`,
      organizationId: WORLD_ORG,
      mandate: world.mandate,
      offer,
      result,
      context,
      request: null,
    }),
    world.keys.instance,
  );
  const txSignature = opts.txSignature ?? `${messageHash}${messageHash.slice(0, 24)}`;
  const summary = channelSettleSummary(world.keys.agent.publicKey, txSignature, world.clock.now, channel, message);
  publishSummary(world, summary);
  const receipt = await buildReceipt(
    {
      id: existingId,
      mandate: world.mandate,
      decision,
      settlement: {
        txSignature,
        network: offer.network,
        payer: world.keys.agent.publicKey,
        settledAt: world.clock.now,
        slot: summary.slot,
      },
      response: { status: 200, bodySha256: hashResponseBody(Buffer.from(message)), contentType: VOUCHER_CONTENT_TYPE },
      issuedAt: world.clock.now,
    },
    world.keys.instance,
  );
  await world.receipts.insert({ organizationId: WORLD_ORG, receipt, createdAt: world.clock.now, batchId: null });
  return { receipt, txSignature, offer, messageHash };
}

const byId = (checks: { id: string; status: string }[], id: string) => checks.find((c) => c.id === id)?.status;

describe('receipt issuance', () => {
  it('records a receipt for an allowed voucher decision and moves no tokens', async () => {
    const world = await createWorld();
    const { receipt, txSignature, messageHash } = await recordAllowed(world);
    expect(receipt.decision.record.decision).toBe('ALLOW');
    expect(receipt.id).toBe(`rcp_${messageHash.slice(0, 16)}`);
    expect(receipt.response.contentType).toBe(VOUCHER_CONTENT_TYPE);
    expect(receipt.response.bodySha256).toBe(messageHash);
    expect(receipt.settlement.txSignature).toBe(txSignature);
    expect(receipt.settlement.payer).toBe(world.keys.agent.publicKey);
    expect(receipt.hashes.offerHash).toBe(hashOffer(receipt.offer));
    expect(world.chain.tokenBalance(world.keys.merchant.publicKey, receipt.offer.asset)).toBe(0n);
  });

  it('is idempotent per voucher message and keeps the first settlement', async () => {
    const world = await createWorld();
    const message = new TextEncoder().encode('voucher-same');
    const { receipt, txSignature } = await recordAllowed(world, '10000', { message });
    const again = await recordAllowed(world, '10000', { message, txSignature: 'x'.repeat(88) });
    expect(again.receipt.id).toBe(receipt.id);
    expect(again.receipt.settlement.txSignature).toBe(txSignature);
    expect((await world.receipts.get(WORLD_ORG, receipt.id))!.receipt.settlement.txSignature).toBe(txSignature);
  });

  it('refuses receipts for DENY decisions and unknown decisions', async () => {
    const world = await createWorld();
    const offer = testOffer({ payTo: world.keys.attacker.publicKey, feePayer: world.keys.facilitator.publicKey, amount: '10000' });
    const context = testContext({ now: world.clock.now, simulation: null, requireSimulation: false });
    const result = evaluateGate(world.mandate, offer, context);
    expect(result.decision).toBe('DENY');
    const decision = await signDecision(
      buildDecisionRecord({ id: 'dec_deny', organizationId: WORLD_ORG, mandate: world.mandate, offer, result, context, request: null }),
      world.keys.instance,
    );
    await expect(
      buildReceipt(
        {
          id: 'rcp_deny',
          mandate: world.mandate,
          decision,
          settlement: { txSignature: 'a'.repeat(88), network: offer.network, payer: world.keys.agent.publicKey, settledAt: world.clock.now, slot: 1 },
          response: { status: 200, bodySha256: hashResponseBody('x'), contentType: VOUCHER_CONTENT_TYPE },
          issuedAt: world.clock.now,
        },
        world.keys.instance,
      ),
    ).rejects.toBeInstanceOf(ReceiptBuildError);
    const response = { status: 200, bodySha256: hashResponseBody('x'), contentType: null };
    await expect(world.receiptService.issue(WORLD_ORG, { decisionId: 'dec_nope', txSignature: 'a'.repeat(88), response })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('fails settlement when the transaction is not an Ed25519 precompile plus channel settle', async () => {
    const world = await createWorld();
    const { receipt } = await recordAllowed(world);
    const broken = channelSettleSummary(world.keys.agent.publicKey, receipt.settlement.txSignature, world.clock.now);
    broken.instructions = [];
    broken.programIds = [];
    broken.tokenTransfers = [];
    publishSummary(world, broken);
    const result = await verifyReceipt(receipt, { chain: world.chain, trustedInstanceKeys: [world.keys.instance.publicKey] });
    const settlement = result.checks.find((c) => c.id === 'SETTLEMENT_ONCHAIN');
    expect(settlement?.status).toBe('FAIL');
    expect(settlement?.message).toContain('settlement is not an Ed25519 precompile plus payment-channels settle');
  });
});

describe('voucher receipt ids', () => {
  it('uses rcp_ plus the first 16 hex chars of the allowed voucher hash', async () => {
    const world = await createWorld();
    const message = new TextEncoder().encode('voucher-named');
    const { receipt, messageHash } = await recordAllowed(world, '10000', { message });
    expect(receipt.id).toBe(`rcp_${messageHash.slice(0, 16)}`);
    expect(receipt.response.bodySha256).toBe(messageHash);
  });

  it('gives each allowed voucher its own id', async () => {
    const world = await createWorld();
    const first = await recordAllowed(world, '10000', { message: new TextEncoder().encode('voucher-a') });
    const second = await recordAllowed(world, '20000', { message: new TextEncoder().encode('voucher-b') });
    expect(first.receipt.id).toMatch(/^rcp_[0-9a-f]{16}$/);
    expect(second.receipt.id).toMatch(/^rcp_[0-9a-f]{16}$/);
    expect(second.receipt.id).not.toBe(first.receipt.id);
  });

  it('a second voucher leaves the first stored receipt in place', async () => {
    const world = await createWorld();
    const first = await recordAllowed(world, '10000', { message: new TextEncoder().encode('voucher-first') });
    const second = await recordAllowed(world, '20000', { message: new TextEncoder().encode('voucher-second') });
    expect((await world.receipts.get(WORLD_ORG, first.receipt.id))!.receipt.settlement.txSignature).toBe(first.txSignature);
    expect((await world.receipts.get(WORLD_ORG, second.receipt.id))!.receipt.id).toBe(second.receipt.id);
  });
});

describe('verifyReceipt', () => {
  it('passes every check for an anchored receipt, including the on-chain anchor and settlement', async () => {
    const world = await createWorld();
    await recordAllowed(world);
    const { receipt } = await recordAllowed(world, '20000');
    const run = await world.anchorService.run();
    expect(run?.anchored).toBe(2);
    const stored = await world.receipts.get(WORLD_ORG, receipt.id);
    const result = await verifyReceipt(stored!.receipt, { chain: world.chain, trustedInstanceKeys: [world.keys.instance.publicKey], requireAnchor: true });
    expect(result.checks.filter((c) => c.status === 'FAIL')).toEqual([]);
    expect(result.pass).toBe(true);
    for (const id of ['SCHEMA', 'RECEIPT_HASH', 'INSTANCE_SIGNATURE', 'MANDATE_CHAIN', 'DECISION_SIGNATURE', 'DECISION_MATCHES_SCOPE', 'DECISION_ALLOWED', 'ANCHOR_MERKLE', 'ANCHOR_ONCHAIN', 'SETTLEMENT_ONCHAIN']) {
      expect(byId(result.checks, id), id).toBe('PASS');
    }
    expect(world.chain.memos.some((m) => m.startsWith('atlasrail:anchor:v1:'))).toBe(false);
    expect(stored!.receipt.anchor?.mechanism).toBe('root');
  });

  it('works fully offline (no chain): on-chain checks are SKIPPED, everything else PASSes', async () => {
    const world = await createWorld();
    const { receipt } = await recordAllowed(world);
    await world.anchorService.run();
    const stored = await world.receipts.get(WORLD_ORG, receipt.id);
    const result = await verifyReceipt(stored!.receipt, { trustedInstanceKeys: [world.keys.instance.publicKey] });
    expect(result.pass).toBe(true);
    expect(byId(result.checks, 'ANCHOR_MERKLE')).toBe('PASS');
    expect(byId(result.checks, 'ANCHOR_ONCHAIN')).toBe('SKIP');
    expect(byId(result.checks, 'SETTLEMENT_ONCHAIN')).toBe('SKIP');
  });

  function chainFor(summary: ChainTransactionSummary): ChainClient {
    return {
      async getLatestBlockhash() {
        return { blockhash: 'blockhash', lastValidBlockHeight: 1 };
      },
      async getMintInfo() {
        return null;
      },
      async simulate() {
        throw new Error('not used');
      },
      async sendAndConfirm() {
        throw new Error('not used');
      },
      async getTransactionSummary(signature: string) {
        return signature === summary.signature ? summary : null;
      },
    };
  }

  it('accepts a voucher settle that is the Ed25519 precompile plus settle and moves no tokens', async () => {
    const mandate = await signedTestMandate();
    const channel = Keypair.generate().publicKey;
    const settledVoucher = voucherBytes(channel, 10_000n, BigInt(NOW + 600));
    const offer = mandateTestOffer({ memo: `channel:${channel.toBase58()}` });
    const context = testContext();
    const gate = evaluateGate(mandate, offer, context);
    expect(gate.decision).toBe('ALLOW');
    const decision = await signDecision(
      buildDecisionRecord({ id: 'dec_voucher', organizationId: WORLD_ORG, mandate, offer, result: gate, context, request: null }),
      signers.instance,
    );
    const summary = channelSettleSummary(mandate.agent.publicKey, 'V'.repeat(88), NOW, channel, settledVoucher);
    const receipt = await buildReceipt(
      {
        id: 'rcp_voucher',
        mandate,
        decision,
        settlement: {
          txSignature: summary.signature,
          network: offer.network,
          payer: mandate.agent.publicKey,
          settledAt: NOW,
          slot: summary.slot,
        },
        response: { status: 200, bodySha256: hashResponseBody(settledVoucher), contentType: 'application/vnd.payment-channels.voucher' },
        issuedAt: NOW,
      },
      signers.instance,
    );
    const result = await verifyReceipt(receipt, { chain: chainFor(summary), trustedInstanceKeys: [signers.instance.publicKey] });
    expect(byId(result.checks, 'SETTLEMENT_ONCHAIN')).toBe('PASS');

    const wrongKey = channelSettleSummary(Keypair.generate().publicKey.toBase58(), summary.signature, NOW, channel, settledVoucher);
    const mismatched = await verifyReceipt(receipt, { chain: chainFor(wrongKey), trustedInstanceKeys: [signers.instance.publicKey] });
    expect(byId(mismatched.checks, 'SETTLEMENT_ONCHAIN')).toBe('FAIL');

    // Same agent key, but a bigger voucher was settled than the one the receipt was issued for.
    const bigger = channelSettleSummary(mandate.agent.publicKey, summary.signature, NOW, channel, voucherBytes(channel, 90_000_000n, BigInt(NOW + 600)));
    const overpaid = await verifyReceipt(receipt, { chain: chainFor(bigger), trustedInstanceKeys: [signers.instance.publicKey] });
    expect(byId(overpaid.checks, 'SETTLEMENT_ONCHAIN')).toBe('FAIL');
    expect(overpaid.checks.find((c) => c.id === 'SETTLEMENT_ONCHAIN')?.message).toContain('not the voucher this receipt was issued for');
  });

  it('accepts the allowed voucher settle that recordAllowed published', async () => {
    const world = await createWorld();
    const { receipt } = await recordAllowed(world);
    const result = await verifyReceipt(receipt, { chain: world.chain, trustedInstanceKeys: [world.keys.instance.publicKey] });
    const settlement = result.checks.find((c) => c.id === 'SETTLEMENT_ONCHAIN');
    expect(settlement?.status).toBe('PASS');
    expect(settlement?.message).toContain('Payment-channels settle was authorized by the mandate');
    expect(world.chain.tokenBalance(world.keys.merchant.publicKey, receipt.offer.asset)).toBe(0n);
  });

  it('un-anchored receipts SKIP the anchor checks, or FAIL when an anchor is required', async () => {
    const world = await createWorld();
    const { receipt } = await recordAllowed(world);
    expect(byId((await verifyReceipt(receipt)).checks, 'ANCHOR_MERKLE')).toBe('SKIP');
    expect((await verifyReceipt(receipt, { requireAnchor: true })).pass).toBe(false);
  });

  it('detects tampering with each bound field', async () => {
    const world = await createWorld();
    await recordAllowed(world);
    const { receipt } = await recordAllowed(world, '20000'); // two leaves, so the Merkle proof is non-trivial
    await world.anchorService.run();
    const anchored = (await world.receipts.get(WORLD_ORG, receipt.id))!.receipt;
    const clone = () => JSON.parse(JSON.stringify(anchored)) as BoundReceipt;

    const cases: Array<[string, (r: BoundReceipt) => void, string]> = [
      ['amount edited', (r) => { r.offer.amount = '1'; }, 'RECEIPT_HASH'],
      ['tx signature swapped', (r) => { r.settlement.txSignature = 'z'.repeat(88); }, 'RECEIPT_HASH'],
      ['response body hash swapped', (r) => { r.response.bodySha256 = 'f'.repeat(64); }, 'RECEIPT_HASH'],
      ['timestamp moved', (r) => { r.issuedAt += 1; }, 'RECEIPT_HASH'],
      ['mandate scope widened', (r) => { r.mandate.scope.limits.maxTotal = '999999999999'; }, 'MANDATE_CHAIN'],
      ['decision flipped to ALLOW from something else', (r) => { r.decision.record.reason = 'edited'; }, 'DECISION_SIGNATURE'],
      ['merkle proof damaged', (r) => { r.anchor!.proof = []; }, 'ANCHOR_MERKLE'],
      ['batch hashes stripped', (r) => { delete r.anchor!.batchHeader; delete r.anchor!.batchFileHash; }, 'ANCHOR_MERKLE'],
      ['batch file hash swapped', (r) => { r.anchor!.batchFileHash = 'e'.repeat(64); }, 'ANCHOR_MERKLE'],
    ];
    for (const [name, mutate, expectedFail] of cases) {
      const copy = clone();
      mutate(copy);
      const result = await verifyReceipt(copy, { chain: world.chain });
      expect(result.pass, name).toBe(false);
      expect(byId(result.checks, expectedFail), `${name} -> ${expectedFail}`).toBe('FAIL');
    }
  });

  it('detects a forged receipt signed by some other key, and a wrong pinned key', async () => {
    const world = await createWorld();
    const { receipt } = await recordAllowed(world);
    const forged = { ...receipt, instance: { publicKey: world.keys.attacker.publicKey, signature: receipt.instance.signature } };
    expect(byId((await verifyReceipt(forged)).checks, 'INSTANCE_SIGNATURE')).toBe('FAIL');
    const pinned = await verifyReceipt(receipt, { trustedInstanceKeys: [world.keys.attacker.publicKey] });
    expect(byId(pinned.checks, 'INSTANCE_SIGNATURE')).toBe('FAIL');
  });

  it('rejects a valid signature from a key that is not pinned', async () => {
    const world = await createWorld();
    const { receipt } = await recordAllowed(world);
    const signature = await signDomainHash(world.keys.attacker, SIGNATURE_DOMAIN.receipt, receipt.receiptHash);
    const resigned = { ...receipt, instance: { publicKey: world.keys.attacker.publicKey, signature } };
    const missing = await verifyReceipt(resigned);
    expect(missing.pass).toBe(false);
    expect(byId(missing.checks, 'INSTANCE_SIGNATURE')).toBe('FAIL');
    const untrusted = await verifyReceipt(resigned, { untrusted: true });
    expect(byId(untrusted.checks, 'INSTANCE_SIGNATURE')).toBe('PASS');
    expect(untrusted.checks.find((c) => c.id === 'INSTANCE_SIGNATURE')?.message).toContain('Untrusted verification');
    const pinned = await verifyReceipt(resigned, { trustedInstanceKeys: [world.keys.instance.publicKey] });
    expect(pinned.pass).toBe(false);
    expect(byId(pinned.checks, 'INSTANCE_SIGNATURE')).toBe('FAIL');
    expect(byId((await verifyReceipt(receipt, { trustedInstanceKeys: [world.keys.instance.publicKey] })).checks, 'INSTANCE_SIGNATURE')).toBe('PASS');
    const rotated = await verifyReceipt(resigned, { trustedInstanceKeys: [world.keys.instance.publicKey, world.keys.attacker.publicKey] });
    expect(byId(rotated.checks, 'INSTANCE_SIGNATURE')).toBe('PASS');
    expect(byId((await verifyReceipt(receipt, { trustedInstanceKeys: [world.keys.attacker.publicKey] })).checks, 'INSTANCE_SIGNATURE')).toBe('FAIL');
  });

  it('fails the anchor check if the memo on-chain does not match (wrong signer or wrong root)', async () => {
    const world = await createWorld();
    const { receipt } = await recordAllowed(world);
    await world.anchorService.run();
    const anchored = (await world.receipts.get(WORLD_ORG, receipt.id))!.receipt;
    const wrongRoot = JSON.parse(JSON.stringify(anchored)) as BoundReceipt;
    wrongRoot.anchor!.txSignature = anchored.settlement.txSignature; // a real tx, but not the anchor transaction
    const result = await verifyReceipt(wrongRoot, { chain: world.chain });
    expect(byId(result.checks, 'ANCHOR_ONCHAIN')).toBe('FAIL');
  });

  it('fails settlement verification when the on-chain transfer was made by a different key', async () => {
    const world = await createWorld();
    const { receipt } = await recordAllowed(world);
    const lie = JSON.parse(JSON.stringify(receipt)) as BoundReceipt;
    lie.mandate.agent.publicKey = world.keys.attacker.publicKey;
    const result = await verifyReceipt(lie, { chain: world.chain });
    expect(result.pass).toBe(false);
  });

  it('rejects junk input without throwing', async () => {
    for (const junk of [null, undefined, 3, 'x', {}, { type: 'atlasrail.bound-receipt' }]) {
      const result = await verifyReceipt(junk);
      expect(result.pass).toBe(false);
      expect(result.checks[0].id).toBe('SCHEMA');
    }
  });

  it('the recorded decision reproduces from the mandate scope', async () => {
    const world = await createWorld();
    const { receipt } = await recordAllowed(world);
    expect(verifyDecisionMatchesScope(receipt.mandate, receipt.decision).ok).toBe(true);
    expect(receipt.offer).toEqual(
      testOffer({ payTo: world.keys.merchant.publicKey, feePayer: world.keys.facilitator.publicKey, amount: '10000', memo: receipt.offer.memo }),
    );
    expect(receipt.offer.memo).toMatch(/^channel:/);
  });
});

describe('key order independence (Postgres JSONB does not preserve key order)', () => {
  const reverseKeys = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(reverseKeys);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).reverse().map(([k, v]) => [k, reverseKeys(v)]));
    }
    return value;
  };

  it('a receipt whose every object has been re-keyed in reverse order still verifies, including the scope replay', async () => {
    const world = await createWorld();
    await recordAllowed(world);
    const { receipt } = await recordAllowed(world, '20000');
    await world.anchorService.run();
    const stored = (await world.receipts.get(WORLD_ORG, receipt.id))!.receipt;
    const reordered = reverseKeys(JSON.parse(JSON.stringify(stored)));
    const result = await verifyReceipt(reordered, { chain: world.chain, requireAnchor: true, trustedInstanceKeys: [world.keys.instance.publicKey] });
    expect(result.checks.filter((c) => c.status === 'FAIL')).toEqual([]);
    expect(result.pass).toBe(true);
  });
});

describe('anchoring', () => {
  it('returns null when nothing is pending and anchors only new receipts on later runs', async () => {
    const world = await createWorld();
    expect(await world.anchorService.run()).toBeNull();
    await recordAllowed(world);
    const first = await world.anchorService.run();
    expect(first?.anchored).toBe(1);
    expect(await world.anchorService.run()).toBeNull();
    await recordAllowed(world, '20000');
    const second = await world.anchorService.run();
    expect(second?.anchored).toBe(1);
    expect(second?.batch.merkleRoot).not.toBe(first?.batch.merkleRoot);
  });

  it('a failed anchor leaves receipts pending for retry and records a FAILED batch', async () => {
    const world = await createWorld();
    await recordAllowed(world);
    const original = world.chain.sendAndConfirm.bind(world.chain);
    world.chain.sendAndConfirm = async () => {
      throw new Error('rpc unavailable');
    };
    await expect(world.anchorService.run()).rejects.toThrow('rpc unavailable');
    expect((await world.receipts.listBatches(5))[0].status).toBe('FAILED');
    expect((await world.receipts.listUnanchored(10)).length).toBe(1);
    world.chain.sendAndConfirm = original;
    expect((await world.anchorService.run())?.anchored).toBe(1);
  });
});

describe('anchoring (root mode)', () => {
  const PROGRAM_ID = 'CnGoTE5Bxc8MFGaeK5LDv5uAZ7pNiktMunYy8JZcLY4k';
  const RPC_URL = 'https://api.devnet.solana.com';

  // Same seed-from-label scheme as @atlas-rail/mandate/testing's seededSigner, so this signer's
  // public key matches `signers.instance.publicKey` — the on-chain gate_authority is always the
  // same key as the off-chain instance key that signs decisions and receipts.
  function onchainInstanceSigner(): DevnetKeypairSigner {
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

  function stubChain(): { chain: ChainClient; sent: Map<string, VersionedTransaction> } {
    const sent = new Map<string, VersionedTransaction>();
    let n = 0;
    const chain: ChainClient = {
      async getLatestBlockhash() {
        return { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1 };
      },
      async getMintInfo() {
        return null;
      },
      async simulate() {
        throw new Error('not used in this test');
      },
      async sendAndConfirm(signedBase64: string) {
        const tx = VersionedTransaction.deserialize(Buffer.from(signedBase64, 'base64'));
        const signature = `sig_${++n}`;
        sent.set(signature, tx);
        return signature;
      },
      async getTransactionSummary(signature: string): Promise<ChainTransactionSummary | null> {
        const tx = sent.get(signature);
        if (!tx) return null;
        return summarizeTransaction(signature, tx, { slot: n, blockTime: NOW, err: null });
      },
    };
    return { chain, sent };
  }

  async function allowReceipt(): Promise<{ mandate: Awaited<ReturnType<typeof signedTestMandate>>; receipt: BoundReceipt }> {
    const mandate = await signedTestMandate();
    const instance = signers.instance;
    const offer = mandateTestOffer();
    const context = testContext();
    const result = evaluateGate(mandate, offer, context);
    expect(result.decision).toBe('ALLOW');
    const decisionRecord = buildDecisionRecord({ id: 'dec_test', organizationId: WORLD_ORG, mandate, offer, result, context, request: null });
    const signed = await signDecision(decisionRecord, instance);
    const receipt = await buildReceipt(
      {
        id: 'rcp_test',
        mandate,
        decision: signed,
        settlement: { txSignature: 'A'.repeat(64), network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', payer: mandate.agent.publicKey, settledAt: NOW, slot: 1 },
        response: { status: 200, bodySha256: hashResponseBody(Buffer.from('voucher')), contentType: 'application/vnd.payment-channels.voucher' },
        issuedAt: NOW,
      },
      instance,
    );
    return { mandate, receipt };
  }

  function mockOnchainMandate(overrides: { nextRootSeq?: bigint } = {}) {
    vi.mocked(fetchMandateAccount).mockResolvedValue({
      mandateHash: '0'.repeat(64),
      owner: signers.owner.publicKey,
      approver: signers.approver.publicKey,
      agent: signers.agent.publicKey,
      gateAuthority: signers.instance.publicKey,
      mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
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
      nextRootSeq: overrides.nextRootSeq ?? 0n,
      bump: 255,
    });
  }

  it("anchors a mandate's pending receipts via anchor_root, using the on-chain next_root_seq", async () => {
    const { mandate, receipt } = await allowReceipt();
    const receipts = new InMemoryReceiptStore();
    await receipts.insert({ organizationId: WORLD_ORG, receipt, createdAt: NOW, batchId: null });
    mockOnchainMandate({ nextRootSeq: 3n });

    const { chain } = stubChain();
    const onchainSigner = onchainInstanceSigner();
    expect(onchainSigner.publicKey).toBe(signers.instance.publicKey); // same key, two wrapper types
    const service = new AnchorService({
      receipts,
      chain,
      signer: onchainSigner,
      clock: () => NOW,
      newId: (p) => `${p}_1`,
      rpcUrl: RPC_URL,
      programId: PROGRAM_ID,
    });

    const result = await service.run();
    expect(result?.anchored).toBe(1);
    expect(result?.batch.status).toBe('ANCHORED');
    const expectedPda = findMandatePda(PROGRAM_ID, Buffer.from(hashMandate(mandate), 'hex')).address;
    expect(vi.mocked(fetchMandateAccount)).toHaveBeenCalledWith(RPC_URL, expectedPda);

    const stored = (await receipts.get(WORLD_ORG, receipt.id))!.receipt;
    expect(stored.anchor?.mechanism).toBe('root');
    expect(stored.anchor?.seq).toBe(3);

    const verification = await verifyReceipt(stored, {
      chain,
      trustedInstanceKeys: [signers.instance.publicKey],
      programId: PROGRAM_ID,
      checkSettlementOnChain: false, // this test's settlement signature is a fixture, not a real stub-chain transaction
    });
    expect(verification.checks.find((c) => c.id === 'ANCHOR_ONCHAIN')?.status).toBe('PASS');
    expect(verification.checks.find((c) => c.id === 'ANCHOR_MERKLE')?.status).toBe('PASS');
    expect(verification.checks.filter((c) => c.status === 'FAIL')).toEqual([]);
  });

  it('skips a mandate that is not registered on-chain, leaving its receipt pending', async () => {
    const { receipt } = await allowReceipt();
    const receipts = new InMemoryReceiptStore();
    await receipts.insert({ organizationId: WORLD_ORG, receipt, createdAt: NOW, batchId: null });
    vi.mocked(fetchMandateAccount).mockResolvedValue(null);

    const { chain } = stubChain();
    const service = new AnchorService({
      receipts,
      chain,
      signer: onchainInstanceSigner(),
      clock: () => NOW,
      newId: (p) => `${p}_1`,
      rpcUrl: RPC_URL,
      programId: PROGRAM_ID,
    });
    expect(await service.run()).toBeNull();
    expect((await receipts.listUnanchored(10)).length).toBe(1);
  });
});
