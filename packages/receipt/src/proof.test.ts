import { Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { buildDecisionRecord, evaluateGate, formatReceiptMemo, sha256Hex, signDecision } from '@atlas-rail/mandate';
import { testContext, testOffer } from '@atlas-rail/mandate/testing';
import { ChainTransactionSummary, summarizeTransaction } from '@atlas-rail/solana';
import { WORLD_ORG, World, createWorld } from './testing';
import { hashResponseBody } from './service';
import { buildReceipt } from './receipt';
import { NO_PROOF_MESSAGE, provePayment, proveBlockedAttempt } from './proof';

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
  signature: string,
  blockTime: number,
  memo: string | null,
  channel: PublicKey = Keypair.generate().publicKey,
  message: Buffer = voucherBytes(channel, 10_000n, BigInt(blockTime + 600)),
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
  const summary = summarizeTransaction(signature, new VersionedTransaction(compiled), { slot: 9, blockTime, err: null });
  summary.memos = memo ? [memo] : [];
  return summary;
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

async function selfProvingPayment(world: World, label: string, memo: string | null | undefined = undefined) {
  const channel = new PublicKey(Buffer.from(sha256Hex(new TextEncoder().encode(`voucher-${label}-${++voucherSeq}`)), 'hex'));
  const message = voucherBytes(channel, 10_000n, BigInt(world.clock.now + 600));
  const messageHash = sha256Hex(message);
  const offer = testOffer({
    payTo: world.keys.merchant.publicKey,
    feePayer: world.keys.facilitator.publicKey,
    amount: '10000',
    memo: `channel:${channel.toBase58()}`,
  });
  const context = testContext({ now: world.clock.now, simulation: null, requireSimulation: false });
  const result = evaluateGate(world.mandate, offer, context);
  if (result.decision !== 'ALLOW') throw new Error('A denied voucher cannot produce a payment receipt');
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
  const id = `rcp_${messageHash.slice(0, 32)}`;
  const txSignature = `${messageHash}${messageHash.slice(0, 24)}`;
  const receiptMemo = memo === undefined ? formatReceiptMemo(id) : memo;
  publishSummary(world, channelSettleSummary(world.keys.agent.publicKey, txSignature, world.clock.now, receiptMemo, channel, message));
  const receipt = await buildReceipt(
    {
      id,
      mandate: world.mandate,
      decision,
      settlement: {
        txSignature,
        network: offer.network,
        payer: world.keys.agent.publicKey,
        settledAt: world.clock.now,
        slot: 9,
      },
      response: { status: 200, bodySha256: hashResponseBody(Buffer.from(message)), contentType: VOUCHER_CONTENT_TYPE },
      issuedAt: world.clock.now,
    },
    world.keys.instance,
  );
  await world.receipts.insert({ organizationId: WORLD_ORG, receipt, createdAt: world.clock.now, batchId: null });
  await world.anchorService.run();
  const stored = (await world.receipts.get(WORLD_ORG, receipt.id))!.receipt;
  return { txSignature, receipt: stored };
}

const loaderFor = (world: World) => async (id: string) => (await world.receipts.get(WORLD_ORG, id))?.receipt ?? null;

describe('provePayment: from a transaction signature alone', () => {
  it('PROVEN for a self-proving, anchored payment, with the facts a stranger needs', async () => {
    const world = await createWorld();
    const { txSignature, receipt } = await selfProvingPayment(world, 'a');
    const proof = await provePayment(txSignature, { chain: world.chain, loadReceipt: loaderFor(world), trustedInstanceKeys: [world.keys.instance.publicKey] });
    expect(proof.verdict).toBe('PROVEN');
    if (proof.verdict !== 'PROVEN') return;
    expect(proof.receiptId).toBe(receipt.id);
    expect(proof.facts.signers.map((s) => s.role)).toEqual(['OWNER', 'APPROVER', 'AGENT']);
    expect(proof.facts.payment).toMatchObject({ amount: receipt.offer.amount, payTo: receipt.offer.payTo, payer: null });
    expect(receipt.settlement.payer).toBe(world.keys.agent.publicKey);
    expect(proof.facts.anchor?.txSignature).toBeTruthy();
    expect(proof.verification.checks.every((c) => c.status === 'PASS')).toBe(true);
  });

  it('NO_PROOF for a payment whose memo names no Atlas Rail receipt', async () => {
    const world = await createWorld();
    const { txSignature } = await selfProvingPayment(world, 'b', null);
    const proof = await provePayment(txSignature, { chain: world.chain, loadReceipt: loaderFor(world) });
    expect(proof.verdict).toBe('NO_PROOF');
    expect(proof.reason).toContain(NO_PROOF_MESSAGE);
  });

  it('NO_PROOF when the memo names a receipt nobody published', async () => {
    const world = await createWorld();
    const { txSignature } = await selfProvingPayment(world, 'c');
    const proof = await provePayment(txSignature, { chain: world.chain, loadReceipt: async () => null });
    expect(proof.verdict).toBe('NO_PROOF');
    expect(proof.reason).toContain('no receipt with that id has been published');
  });

  it('NO_PROOF when the memo points at a real receipt belonging to a different payment', async () => {
    const world = await createWorld();
    const real = await selfProvingPayment(world, 'd');
    // A second settle whose memo copies the first receipt's id: it borrows a pointer, not a proof.
    const copycat = 'C'.repeat(88);
    publishSummary(world, channelSettleSummary(world.keys.agent.publicKey, copycat, world.clock.now, formatReceiptMemo(real.receipt.id)));
    const proof = await provePayment(copycat, { chain: world.chain, loadReceipt: loaderFor(world) });
    expect(proof.verdict).toBe('NO_PROOF');
    expect(proof.reason).toContain('different transaction');
  });

  it('NOT_FOUND for a signature that is not on the cluster', async () => {
    const world = await createWorld();
    const proof = await provePayment('1'.repeat(88), { chain: world.chain, loadReceipt: loaderFor(world) });
    expect(proof.verdict).toBe('NOT_FOUND');
  });

  it('INVALID when the published receipt has been tampered with', async () => {
    const world = await createWorld();
    const { txSignature, receipt } = await selfProvingPayment(world, 'e');
    const tampered = { ...receipt, offer: { ...receipt.offer, amount: '1' } };
    const proof = await provePayment(txSignature, { chain: world.chain, loadReceipt: async () => tampered });
    expect(proof.verdict).toBe('INVALID');
  });

  it('INVALID when the mandate was already revoked on-chain before the payment landed; PROVEN if revoked only afterwards', async () => {
    const world = await createWorld();
    const { txSignature } = await selfProvingPayment(world, 'f');
    const now = world.clock.now;
    const before = await provePayment(txSignature, { chain: world.chain, loadReceipt: loaderFor(world), loadMandateState: async () => ({ revoked: true, revokedAt: now - 60 }) });
    expect(before.verdict).toBe('INVALID');
    const after = await provePayment(txSignature, { chain: world.chain, loadReceipt: loaderFor(world), loadMandateState: async () => ({ revoked: true, revokedAt: now + 60 }), trustedInstanceKeys: [world.keys.instance.publicKey] });
    expect(after.verdict).toBe('PROVEN');
  });

  it('INVALID when a pinned instance key does not match', async () => {
    const world = await createWorld();
    const { txSignature } = await selfProvingPayment(world, '9');
    const proof = await provePayment(txSignature, { chain: world.chain, loadReceipt: loaderFor(world), trustedInstanceKeys: [world.keys.attacker.publicKey] });
    expect(proof.verdict).toBe('INVALID');
  });
});

describe('proveBlockedAttempt: a denial has no transaction, so the signed decision is the proof', () => {
  it('BLOCKED for a genuine signed DENY under a valid mandate', async () => {
    const world = await createWorld();
    const { outcome } = await world.requestGate({ payTo: world.keys.attacker.publicKey, amount: '10000' });
    const proof = proveBlockedAttempt({ mandate: world.mandate, decision: outcome.decision });
    expect(proof.verdict).toBe('BLOCKED');
    expect(proof.facts?.failedRules).toContain('PAYTO_ALLOWED');
  });

  it('INVALID for an ALLOW decision, a tampered decision, or garbage', async () => {
    const world = await createWorld();
    const allowed = await world.requestGate({ amount: '10000' });
    expect(proveBlockedAttempt({ mandate: world.mandate, decision: allowed.outcome.decision }).verdict).toBe('INVALID');

    const denied = await world.requestGate({ payTo: world.keys.attacker.publicKey, amount: '10000' });
    const tampered = { ...denied.outcome.decision, record: { ...denied.outcome.decision.record, failedRules: [] } };
    expect(proveBlockedAttempt({ mandate: world.mandate, decision: tampered }).verdict).toBe('INVALID');

    expect(proveBlockedAttempt({ nope: true }).verdict).toBe('INVALID');
  });
});
