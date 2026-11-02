import { afterEach, describe, expect, it, vi } from 'vitest';
import { SOLANA_DEVNET_CAIP2, hashMandate, toBase58, verifyEd25519 } from '@atlas-rail/mandate';
import { NOW, TEST_MINT, TEST_ORIGIN, signedTestMandate, signers } from '@atlas-rail/mandate/testing';
import { AnchorService, InMemoryReceiptStore, proveBlockedAttempt } from '@atlas-rail/receipt';
import {
  ChainClient,
  DevnetKeypairSigner,
  fetchMandateAccount,
  findMandatePda,
} from '@atlas-rail/solana';
import { GateAuthorizationRequiredError, MandateDeniedError, UnsupportedPaymentError } from './errors';
import { GatedSignerAdapter } from './gated-signer';
import { HttpSignerClient, startSignerService } from './signer-service';
import { VoucherAuthorizer, VoucherBudgetLedger, VoucherRequest, encodeVoucherMessage, percentile, takeVoucherTimings } from './voucher';

vi.mock('@atlas-rail/solana', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@atlas-rail/solana')>();
  return { ...actual, fetchMandateAccount: vi.fn() };
});

function seed(label: string): Uint8Array {
  const out = new Uint8Array(32);
  new TextEncoder().encode(label).forEach((b, i) => (out[i] = b));
  return out;
}

function devnetSigner(label: string): DevnetKeypairSigner {
  process.env.ATLAS_ALLOW_MOCK_SIGNER = 'true';
  return new DevnetKeypairSigner(seed(label));
}

const CHANNEL = signers.facilitator.publicKey;

function request(overrides: Partial<VoucherRequest> = {}): VoucherRequest {
  return {
    channelId: CHANNEL,
    cumulativeAmount: '10000',
    expiresAt: NOW + 600,
    recipient: signers.merchant.publicKey,
    resourceUrl: `${TEST_ORIGIN}/research/summary`,
    asset: TEST_MINT,
    network: SOLANA_DEVNET_CAIP2,
    ...overrides,
  };
}

const LIFETIME_CAP = 100_000_000n;
const CHANNEL_B = signers.owner.publicKey;

function spendWithRemaining(remaining: bigint) {
  return { windowAutonomousBaseUnits: '0', totalBaseUnits: (LIFETIME_CAP - remaining).toString() };
}

async function harness(options: {
  signerNow?: number;
  spend?: { windowAutonomousBaseUnits: string; totalBaseUnits: string };
  budget?: VoucherBudgetLedger;
  mandate?: Awaited<ReturnType<typeof signedTestMandate>>;
  settledWatermark?: (channelId: string) => Promise<bigint>;
} = {}) {
  const mandate = options.mandate ?? (await signedTestMandate({ threshold: '1000000' }));
  const agent = devnetSigner('agent');
  expect(agent.publicKey).toBe(signers.agent.publicKey);
  const signer = new GatedSignerAdapter({
    inner: agent,
    trustedInstanceKeys: [signers.instance.publicKey],
    clock: () => options.signerNow ?? NOW,
  });
  const authorizer = new VoucherAuthorizer({
    mandate,
    instance: signers.instance,
    signer,
    organizationId: 'org_test',
    clock: () => NOW,
    spend: options.spend,
    budget: options.budget,
    authorizationTtlSeconds: 60,
    settledWatermark: options.settledWatermark,
  });
  return { mandate, agent, signer, authorizer };
}

describe('payment-channel voucher authorizer', () => {
  afterEach(() => {
    takeVoucherTimings();
  });

  it('signs an in-budget voucher over the canonical 50 bytes', async () => {
    const { authorizer, agent } = await harness();
    const allowed = await authorizer.requestVoucher(request());
    expect(allowed.message).toHaveLength(50);
    expect(allowed.message[0]).toBe(0x56);
    expect(allowed.message[1]).toBe(0x01);
    expect(allowed.deltaAmount).toBe('10000');
    expect(verifyEd25519(agent.publicKey, allowed.message, toBase58(allowed.signature))).toBe(true);
    expect(authorizer.denials).toHaveLength(0);
    expect(allowed.receipt).toBeNull();
  });

  it('refuses an unapproved recipient and an over-budget amount with no signature', async () => {
    const { authorizer, mandate, signer } = await harness();
    const sign = vi.spyOn(signer, 'signVoucherWithAuthorization');
    await expect(authorizer.requestVoucher(request({ recipient: signers.attacker.publicKey }))).rejects.toBeInstanceOf(MandateDeniedError);
    const capped = await harness({ spend: { windowAutonomousBaseUnits: '0', totalBaseUnits: '100000000' } });
    await expect(capped.authorizer.requestVoucher(request())).rejects.toBeInstanceOf(MandateDeniedError);
    expect(sign).not.toHaveBeenCalled();
    expect(capped.authorizer.denials).toHaveLength(1);
    const proof = proveBlockedAttempt(capped.authorizer.denials[0], [signers.instance.publicKey]);
    expect(proof.verdict).toBe('BLOCKED');
    expect(proof.facts?.failedRules).toContain('MAX_TOTAL');
    expect(mandate.agent.publicKey).toBe(signers.agent.publicKey);
  });

  it('rejects an understated caller watermark when the chain reader is present', async () => {
    const { authorizer, signer } = await harness({ settledWatermark: async () => 5_000n });
    const sign = vi.spyOn(signer, 'signVoucherWithAuthorization');
    await expect(authorizer.requestVoucher(request({ settledAmount: '0', cumulativeAmount: '10000' }))).rejects.toBeInstanceOf(UnsupportedPaymentError);
    expect(sign).not.toHaveBeenCalled();
    const allowed = await authorizer.requestVoucher(request({ settledAmount: '9000', cumulativeAmount: '10000' }));
    expect(allowed.deltaAmount).toBe('5000');
    await expect(authorizer.requestVoucher(request({ settledAmount: '0', cumulativeAmount: '20000' }))).rejects.toBeInstanceOf(UnsupportedPaymentError);
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it('checks a new cumulative amount against the channel watermark and the budget still left', async () => {
    const { authorizer } = await harness({ spend: { windowAutonomousBaseUnits: '0', totalBaseUnits: '99990000' } });
    const allowed = await authorizer.requestVoucher(request({ settledAmount: '5000', cumulativeAmount: '10000' }));
    expect(allowed.deltaAmount).toBe('5000');
    await expect(authorizer.requestVoucher(request({ cumulativeAmount: '20000' }))).rejects.toBeInstanceOf(MandateDeniedError);
    expect(authorizer.denials).toHaveLength(1);
  });

  it('refuses expired, non-monotonic, stale, and repeated vouchers before signing', async () => {
    const { authorizer, signer, mandate } = await harness();
    const sign = vi.spyOn(signer, 'signVoucherWithAuthorization');
    await expect(authorizer.requestVoucher(request({ expiresAt: NOW }))).rejects.toBeInstanceOf(UnsupportedPaymentError);
    await expect(authorizer.requestVoucher(request({ expiresAt: 0 }))).rejects.toBeInstanceOf(UnsupportedPaymentError);
    await expect(authorizer.requestVoucher(request({ cumulativeAmount: '0' }))).rejects.toBeInstanceOf(UnsupportedPaymentError);
    await expect(authorizer.requestVoucher(request({ channelId: 'not-a-key' }))).rejects.toBeInstanceOf(UnsupportedPaymentError);
    expect(sign).not.toHaveBeenCalled();

    const first = await authorizer.requestVoucher(request());
    await expect(authorizer.requestVoucher(request({ cumulativeAmount: '10000' }))).rejects.toBeInstanceOf(UnsupportedPaymentError);
    await expect(authorizer.requestVoucher(request({ cumulativeAmount: '20000', settledAmount: '0' }))).rejects.toBeInstanceOf(UnsupportedPaymentError);
    const tampered = Uint8Array.from(first.message);
    tampered[34] ^= 0xff;
    await expect(signer.signVoucherWithAuthorization(tampered, first.authorization, first.decision, mandate)).rejects.toBeInstanceOf(
      GateAuthorizationRequiredError,
    );
    await expect(signer.signMessage(first.message)).rejects.toBeInstanceOf(GateAuthorizationRequiredError);
    await expect(signer.signVoucherWithAuthorization(first.message, null, null, null)).rejects.toBeInstanceOf(GateAuthorizationRequiredError);
  });

  it('refuses to sign when the authorisation is already stale at the signer', async () => {
    const { authorizer } = await harness({ signerNow: NOW + 120 });
    await expect(authorizer.requestVoucher(request())).rejects.toBeInstanceOf(GateAuthorizationRequiredError);
  });

  it('does not issue a payment receipt for a denial, and anchors an allowed receipt with anchor_root', async () => {
    const denied = await harness({ spend: { windowAutonomousBaseUnits: '0', totalBaseUnits: '100000000' } });
    await expect(denied.authorizer.requestVoucher(request())).rejects.toBeInstanceOf(MandateDeniedError);
    expect(denied.authorizer.denials[0].decision.record.decision).toBe('DENY');

    const { authorizer, mandate } = await harness();
    const allowed = await authorizer.requestVoucher(request());
    const receipt = await authorizer.recordAllowedReceipt(allowed, { txSignature: 'A'.repeat(64), slot: 1 });
    expect(receipt.decision.record.decision).toBe('ALLOW');
    expect(receipt.response.bodySha256).toBe(allowed.messageHash);

    vi.mocked(fetchMandateAccount).mockResolvedValue({
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
      nextRootSeq: 1n,
      bump: 255,
    });
    const chain: ChainClient = {
      async getLatestBlockhash() {
        return { blockhash: signers.owner.publicKey, lastValidBlockHeight: 1 };
      },
      async getMintInfo() {
        return null;
      },
      async simulate() {
        throw new Error('not used');
      },
      async sendAndConfirm(signedBase64: string) {
        if (!signedBase64) throw new Error('empty transaction');
        return 'sig_root';
      },
      async getTransactionSummary() {
        return {
          signature: 'sig_root',
          slot: 2,
          blockTime: NOW,
          err: null,
          feePayer: signers.instance.publicKey,
          signers: [signers.instance.publicKey],
          tokenTransfers: [],
          memos: [],
          programIds: [],
          instructions: [],
        };
      },
    };
    const store = new InMemoryReceiptStore();
    await store.insert({ organizationId: 'org_test', receipt, createdAt: NOW, batchId: null });
    const programId = 'CnGoTE5Bxc8MFGaeK5LDv5uAZ7pNiktMunYy8JZcLY4k';
    const anchored = await new AnchorService({
      receipts: store,
      chain,
      signer: devnetSigner('instance'),
      clock: () => NOW,
      newId: (p) => `${p}_1`,
      rpcUrl: 'https://api.devnet.solana.com',
      programId,
    }).run();
    expect(anchored?.anchored).toBe(1);
    expect(anchored?.batch.txSignature).toBe('sig_root');
    const stored = (await store.get('org_test', receipt.id))!.receipt;
    expect(stored.anchor?.mechanism).toBe('root');
    expect(findMandatePda(programId, Buffer.from(hashMandate(mandate), 'hex')).address).toBeTruthy();
  });

  it('signs at most one of two simultaneous 4000 spends when 6000 remains', async () => {
    const { authorizer } = await harness({ spend: spendWithRemaining(6000n) });
    const opening = LIFETIME_CAP - 6000n;
    const settled = await Promise.allSettled([
      authorizer.requestVoucher(request({ cumulativeAmount: '4000', expiresAt: NOW + 600 })),
      authorizer.requestVoucher(request({ cumulativeAmount: '4000', expiresAt: NOW + 601 })),
    ]);
    const signed = settled.filter((result) => result.status === 'fulfilled');
    const denied = settled.filter((result) => result.status === 'rejected');
    expect(signed).toHaveLength(1);
    expect(denied).toHaveLength(1);
    expect((denied[0] as PromiseRejectedResult).reason).toBeInstanceOf(UnsupportedPaymentError);
    expect(BigInt(authorizer.budgetSnapshot().totalBaseUnits) - opening).toBe(4000n);
    expect(authorizer.budgetSnapshot().inFlight).toBe(0);
  });

  it('denies the second channel when two 4000 spends share 6000 of mandate budget', async () => {
    const { authorizer } = await harness({ spend: spendWithRemaining(6000n) });
    const opening = LIFETIME_CAP - 6000n;
    const settled = await Promise.allSettled([
      authorizer.requestVoucher(request({ cumulativeAmount: '4000' })),
      authorizer.requestVoucher(request({ channelId: CHANNEL_B, cumulativeAmount: '4000' })),
    ]);
    const signed = settled.filter((result) => result.status === 'fulfilled');
    const denied = settled.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(signed).toHaveLength(1);
    expect(denied.reason).toBeInstanceOf(MandateDeniedError);
    expect((denied.reason as MandateDeniedError).failedRules).toContain('MAX_TOTAL');
    expect(BigInt(authorizer.budgetSnapshot().totalBaseUnits) - opening).toBe(4000n);
    expect(authorizer.budgetSnapshot().inFlight).toBe(0);
  });

  it('lets two channels take 4000 each when 8000 remains and counts it once', async () => {
    const { authorizer } = await harness({ spend: spendWithRemaining(8000n) });
    const opening = LIFETIME_CAP - 8000n;
    const [first, second] = await Promise.all([
      authorizer.requestVoucher(request({ cumulativeAmount: '4000' })),
      authorizer.requestVoucher(request({ channelId: CHANNEL_B, cumulativeAmount: '4000' })),
    ]);
    expect(first.deltaAmount).toBe('4000');
    expect(second.deltaAmount).toBe('4000');
    expect(BigInt(authorizer.budgetSnapshot().totalBaseUnits) - opening).toBe(8000n);
  });

  it('signs two channels at the same time', async () => {
    const { authorizer, signer } = await harness();
    let inSign = 0;
    let maxInSign = 0;
    let markSecond!: () => void;
    const secondEntered = new Promise<void>((resolve) => {
      markSecond = resolve;
    });
    const original = signer.signVoucherWithAuthorization.bind(signer);
    vi.spyOn(signer, 'signVoucherWithAuthorization').mockImplementation(async (...args) => {
      inSign += 1;
      maxInSign = Math.max(maxInSign, inSign);
      if (maxInSign >= 2) markSecond();
      else await secondEntered;
      try {
        return await original(...args);
      } finally {
        inSign -= 1;
      }
    });
    const both = Promise.all([
      authorizer.requestVoucher(request({ cumulativeAmount: '4000' })),
      authorizer.requestVoucher(request({ channelId: CHANNEL_B, cumulativeAmount: '4000' })),
    ]);
    await Promise.race([
      secondEntered,
      new Promise((_, reject) => setTimeout(() => reject(new Error('second channel did not reach signing')), 500)),
    ]);
    expect(maxInSign).toBe(2);
    await both;
  });

  it('rolls back a reservation when signing fails and keeps it after a signature', async () => {
    const { authorizer, signer } = await harness();
    const original = signer.signVoucherWithAuthorization.bind(signer);
    vi.spyOn(signer, 'signVoucherWithAuthorization').mockRejectedValueOnce(new Error('sign failed'));
    await expect(authorizer.requestVoucher(request())).rejects.toThrow('sign failed');
    expect(authorizer.budgetSnapshot().totalBaseUnits).toBe('0');
    expect(authorizer.budgetSnapshot().inFlight).toBe(0);
    vi.spyOn(signer, 'signVoucherWithAuthorization').mockImplementation(original);
    const allowed = await authorizer.requestVoucher(request());
    expect(allowed.signature.length).toBeGreaterThan(0);
    expect(authorizer.budgetSnapshot().totalBaseUnits).toBe('10000');

    const stale = await harness({ signerNow: NOW + 120 });
    await expect(stale.authorizer.requestVoucher(request())).rejects.toBeInstanceOf(GateAuthorizationRequiredError);
    expect(stale.authorizer.budgetSnapshot().totalBaseUnits).toBe('0');

    const { authorizer: denied } = await harness();
    await expect(denied.requestVoucher(request({ recipient: signers.attacker.publicKey }))).rejects.toBeInstanceOf(MandateDeniedError);
    expect(denied.budgetSnapshot().totalBaseUnits).toBe('0');
    await denied.requestVoucher(request());
    expect(denied.budgetSnapshot().totalBaseUnits).toBe('10000');
  });

  it('does not free budget when receipt recording fails, and a repeat does not charge twice', async () => {
    const { authorizer, signer } = await harness();
    const sign = vi.spyOn(signer, 'signVoucherWithAuthorization');
    const allowed = await authorizer.requestVoucher(request());
    const receipt = await import('@atlas-rail/receipt');
    vi.spyOn(receipt, 'buildReceipt').mockRejectedValueOnce(new Error('receipt failed'));
    await expect(authorizer.recordAllowedReceipt(allowed, { txSignature: 'A'.repeat(64), slot: 1 })).rejects.toThrow('receipt failed');
    expect(authorizer.budgetSnapshot().totalBaseUnits).toBe('10000');
    await expect(authorizer.requestVoucher(request())).rejects.toBeInstanceOf(UnsupportedPaymentError);
    expect(sign).toHaveBeenCalledTimes(1);

    const again = await harness();
    const duplicate = again.authorizer.requestVoucher(request());
    const settled = await Promise.allSettled([duplicate, again.authorizer.requestVoucher(request())]);
    expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter((result) => result.status === 'rejected')[0]).toMatchObject({ status: 'rejected' });
    expect(again.authorizer.budgetSnapshot().totalBaseUnits).toBe('10000');
    expect(again.authorizer.budgetSnapshot().inFlight).toBe(0);
  });

  it('shares one ledger across two authorizers so they cannot both spend the last 6000', async () => {
    const budget = new VoucherBudgetLedger(spendWithRemaining(6000n));
    const first = await harness({ budget });
    const second = await harness({ budget, mandate: first.mandate });
    const opening = LIFETIME_CAP - 6000n;
    const settled = await Promise.allSettled([
      first.authorizer.requestVoucher(request({ cumulativeAmount: '4000' })),
      second.authorizer.requestVoucher(request({ channelId: CHANNEL_B, cumulativeAmount: '4000' })),
    ]);
    expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const denied = settled.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(denied.reason).toBeInstanceOf(MandateDeniedError);
    expect(BigInt(budget.snapshot().totalBaseUnits) - opening).toBe(4000n);
    expect(budget.snapshot().inFlight).toBe(0);
  });

  it('measures gate and signing time apart from any channel open', async () => {
    const { authorizer } = await harness();
    for (let i = 1; i <= 60; i++) {
      await authorizer.requestVoucher(request({ cumulativeAmount: String(i * 10000) }));
    }
    const samples = takeVoucherTimings();
    expect(samples).toHaveLength(60);
    const gate = samples.map((s) => s.gateMs);
    const sign = samples.map((s) => s.signMs);
    const total = samples.map((s) => s.totalMs);
    expect(percentile(gate, 50)).toBeGreaterThanOrEqual(0);
    expect(percentile(total, 95)).toBeGreaterThanOrEqual(percentile(total, 50));
    expect(percentile(sign, 95)).toBeGreaterThanOrEqual(0);
  });

  it('exposes voucher signing only on the voucher route', async () => {
    const { authorizer, signer, mandate } = await harness();
    const service = await startSignerService({ signer, host: '127.0.0.1', port: 0 });
    try {
      const client = await HttpSignerClient.connect({ url: service.url });
      const allowed = await authorizer.requestVoucher(request());
      const remote = await client.signVoucher(allowed.message, allowed.authorization, allowed.decision, mandate);
      expect(verifyEd25519(client.publicKey, allowed.message, toBase58(Buffer.from(remote.signatureBase64, 'base64')))).toBe(true);
      const refused = await fetch(`${service.url}/v1/sign-voucher`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messageBase64: Buffer.from(allowed.message).toString('base64') }),
      });
      expect(refused.status).toBe(403);
    } finally {
      await service.close();
    }
  });
});

describe('voucher expiry limit', () => {
  it('refuses a voucher that lives longer than one hour, or past the mandate, and charges nothing', async () => {
    const { authorizer } = await harness();
    await expect(authorizer.requestVoucher(request({ expiresAt: NOW + 3601 }))).rejects.toThrow('longest voucher life');
    const short = await harness({ mandate: await signedTestMandate({ threshold: '1000000', expiresAt: NOW + 300 }) });
    await expect(short.authorizer.requestVoucher(request({ expiresAt: NOW + 301 }))).rejects.toThrow('after the mandate expires');
    expect(authorizer.budgetSnapshot().totalBaseUnits).toBe('0');
    const allowed = await authorizer.requestVoucher(request({ expiresAt: NOW + 3600 }));
    expect(allowed.status).toBe('ALLOW');
  });
});
