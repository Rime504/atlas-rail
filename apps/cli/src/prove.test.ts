import { createRequire } from 'module';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';
import { buildDecisionRecord, evaluateGate, formatReceiptMemo, fromBase58, signDecision } from '@atlas-rail/mandate';
import { testContext, testOffer } from '@atlas-rail/mandate/testing';
import { WORLD_ORG, createWorld, type World } from '@atlas-rail/receipt/testing';
import { AnchorService, buildReceipt, hashResponseBody } from '@atlas-rail/receipt';
import {
  fetchMandateAccount,
  summarizeTransaction,
  type ChainClient,
  type ChainTransactionSummary,
} from '@atlas-rail/solana';
import { runProveTx } from './prove';

vi.mock('@atlas-rail/solana', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@atlas-rail/solana')>();
  return { ...actual, fetchMandateAccount: vi.fn() };
});

const requireFromSolana = createRequire(join(__dirname, '../../../packages/solana/package.json'));
const { VersionedTransaction } = requireFromSolana('@solana/web3.js') as typeof import('@solana/web3.js');

const PROGRAM_ID = 'CnGoTE5Bxc8MFGaeK5LDv5uAZ7pNiktMunYy8JZcLY4k';
const RPC_URL = 'https://api.devnet.solana.com';
const VOUCHER = 'application/vnd.payment-channels.voucher';
const ED25519_PROGRAM = 'Ed25519SigVerify111111111111111111111111111';
const CHANNEL_PROGRAM = 'CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX';

/** The 50-byte payment-channels voucher: magic, channel, u64 LE cumulative, i64 LE expiry. */
function voucherBytes(channel: string): Buffer {
  const out = Buffer.alloc(50);
  out[0] = 0x56;
  out[1] = 0x01;
  Buffer.from(fromBase58(channel)).copy(out, 2);
  out.writeBigUInt64LE(10_000n, 34);
  out.writeBigInt64LE(2_000_000_000n, 42);
  return out;
}

function channelSettleSummary(agent: string, signature: string, memo: string | null, channel: string): ChainTransactionSummary {
  const message = voucherBytes(channel);
  const pubkeyOffset = 16;
  const data = Buffer.alloc(112 + message.length);
  data[0] = 1;
  data.writeUInt16LE(48, 2);
  data.writeUInt16LE(0xffff, 4);
  data.writeUInt16LE(pubkeyOffset, 6);
  data.writeUInt16LE(0xffff, 8);
  data.writeUInt16LE(112, 10);
  data.writeUInt16LE(message.length, 12);
  data.writeUInt16LE(0xffff, 14);
  Buffer.from(fromBase58(agent)).copy(data, pubkeyOffset);
  message.copy(data, 112);
  return {
    signature,
    slot: 9,
    blockTime: null,
    err: null,
    feePayer: agent,
    signers: [agent],
    tokenTransfers: [],
    memos: memo ? [memo] : [],
    programIds: [ED25519_PROGRAM, CHANNEL_PROGRAM],
    instructions: [
      { programId: ED25519_PROGRAM, accounts: [], dataBase64: data.toString('base64') },
      { programId: CHANNEL_PROGRAM, accounts: [channel, 'Sysvar1nstructions1111111111111111111111111'], dataBase64: Buffer.from([2]).toString('base64') },
    ],
  };
}

function chainWith(settlement: ChainTransactionSummary, blockTime: number): ChainClient {
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
      if (signature === settlement.signature) return { ...settlement, blockTime };
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

async function anchoredVoucher(world: World, withMemo: boolean) {
  const receiptId = `rcp_${'4'.repeat(32)}`;
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
  const settlement = channelSettleSummary(world.mandate.agent.publicKey, 'V'.repeat(88), withMemo ? formatReceiptMemo(receiptId) : null, world.keys.facilitator.publicKey);
  const receipt = await buildReceipt(
    {
      id: receiptId,
      mandate: world.mandate,
      decision,
      settlement: {
        txSignature: settlement.signature,
        network: offer.network,
        payer: world.mandate.agent.publicKey,
        settledAt: world.clock.now,
        slot: settlement.slot,
      },
      response: { status: 200, bodySha256: hashResponseBody(voucherBytes(world.keys.facilitator.publicKey)), contentType: VOUCHER },
      issuedAt: world.clock.now,
    },
    world.keys.instance,
  );
  await world.receipts.insert({ organizationId: WORLD_ORG, receipt, createdAt: world.clock.now, batchId: null });
  const chain = chainWith(settlement, world.clock.now);
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
    chain,
    signer: world.keys.instance,
    clock: () => world.clock.now,
    newId: (prefix) => `${prefix}_channel`,
    rpcUrl: RPC_URL,
    programId: PROGRAM_ID,
  }).run();
  expect(anchored?.anchored).toBe(1);
  const stored = (await world.receipts.get(WORLD_ORG, receipt.id))!.receipt;
  expect(stored.anchor?.mechanism).toBe('root');
  return { chain, txSignature: settlement.signature, stored };
}

function deps(world: World, chain: ChainClient) {
  return {
    chain,
    loadReceipt: async (id: string) => (await world.receipts.get(WORLD_ORG, id))?.receipt ?? null,
    loadMandateState: async () => null,
  };
}

const base = { rpc: null, store: null, trustedKeys: [], json: false, color: false };

describe('atlas verify --tx', () => {
  it('prints PROVEN with who signed, the limits and the decision, and exits 0', async () => {
    const world = await createWorld();
    const { chain, txSignature } = await anchoredVoucher(world, true);
    const lines: string[] = [];
    const code = await runProveTx(
      { ...base, txSignature, trustedKeys: [world.keys.instance.publicKey] },
      deps(world, chain),
      (l) => lines.push(l),
    );
    const text = lines.join('\n');
    expect(code).toBe(0);
    expect(text).toContain('PROVEN');
    expect(text).toMatch(/Mandate signed by: owner .*approver .*agent /);
    expect(text).toContain('Decision: ALLOW');
    expect(text).toContain('Anchored (root seq 1)');
  });

  it('prints NO PROOF for a payment without an Atlas Rail memo, and exits 1', async () => {
    const world = await createWorld();
    const { chain, txSignature } = await anchoredVoucher(world, false);
    const lines: string[] = [];
    const code = await runProveTx({ ...base, txSignature }, deps(world, chain), (l) => lines.push(l));
    expect(code).toBe(1);
    expect(lines.join('\n')).toContain('This payment carries no Atlas Rail proof of permission.');
  });
});
