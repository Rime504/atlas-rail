import { describe, expect, it, vi } from 'vitest';
import {
  buildDecisionRecord,
  fromBase58,
  createGateAuthorization,
  evaluateGate,
  hashMandate,
  sha256Hex,
  signDecision,
} from '@atlas-rail/mandate';
import { NOW, TEST_MINT, TEST_ORIGIN, signers, signedTestMandate, testApproval, testContext } from '@atlas-rail/mandate/testing';
import { AnchorService, InMemoryReceiptStore, hashResponseBody } from '@atlas-rail/receipt';
import { ChainClient, ChainTransactionSummary, DevnetKeypairSigner, checkChannelSettlement, fetchMandateAccount, findMandatePda } from '@atlas-rail/solana';
import {
  EscalationRequiredError,
  GateAuthorizationRequiredError,
  MandateDeniedError,
  UnsupportedPaymentError,
} from './errors';
import { GatedSignerAdapter } from './gated-signer';
import { VoucherAuthorizer, VoucherRequest, encodeVoucherMessage } from './voucher';

vi.mock('@atlas-rail/solana', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@atlas-rail/solana')>();
  return { ...actual, fetchMandateAccount: vi.fn() };
});

const ED25519_PROGRAM = 'Ed25519SigVerify111111111111111111111111111';
const CHANNEL_PROGRAM = 'CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX';
const INSTRUCTIONS_SYSVAR = 'Sysvar1nstructions1111111111111111111111111';
const CHANNEL = signers.facilitator.publicKey;

function seed(label: string): Uint8Array {
  const out = new Uint8Array(32);
  new TextEncoder().encode(label).forEach((b, i) => (out[i] = b));
  return out;
}

function devnetSigner(label: string): DevnetKeypairSigner {
  process.env.ATLAS_ALLOW_MOCK_SIGNER = 'true';
  return new DevnetKeypairSigner(seed(label));
}

function request(overrides: Partial<VoucherRequest> = {}): VoucherRequest {
  return {
    channelId: CHANNEL,
    cumulativeAmount: '10000',
    expiresAt: NOW + 600,
    recipient: signers.merchant.publicKey,
    resourceUrl: `${TEST_ORIGIN}/research/summary`,
    asset: TEST_MINT,
    network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    ...overrides,
  };
}

/** Unit seam for an allowed voucher: Ed25519 precompile plus payment-channels settle, no token movement. */
function channelSettleSummary(agent: string, signature = 'V'.repeat(88)): ChainTransactionSummary {
  const message = Buffer.from('voucher');
  const data = Buffer.alloc(112 + message.length);
  data[0] = 1;
  data.writeUInt16LE(48, 2);
  data.writeUInt16LE(0xffff, 4);
  data.writeUInt16LE(16, 6);
  data.writeUInt16LE(0xffff, 8);
  data.writeUInt16LE(112, 10);
  data.writeUInt16LE(message.length, 12);
  data.writeUInt16LE(0xffff, 14);
  Buffer.from(fromBase58(agent)).copy(data, 16);
  return {
    signature,
    slot: 9,
    blockTime: NOW,
    err: null,
    feePayer: agent,
    signers: [agent],
    tokenTransfers: [],
    memos: [],
    programIds: [ED25519_PROGRAM, CHANNEL_PROGRAM],
    instructions: [
      { programId: ED25519_PROGRAM, dataBase64: data.toString('base64'), accounts: [] },
      {
        programId: CHANNEL_PROGRAM,
        dataBase64: Buffer.from([2]).toString('base64'),
        accounts: [agent, INSTRUCTIONS_SYSVAR],
      },
    ],
  };
}

async function harness(options: { signerNow?: number; revoked?: { revokedAt: number; reason?: string | null } | null; spend?: { windowAutonomousBaseUnits: string; totalBaseUnits: string } } = {}) {
  const mandate = await signedTestMandate();
  const signer = new GatedSignerAdapter({
    inner: devnetSigner('agent'),
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
    revoked: options.revoked,
    authorizationTtlSeconds: 60,
  });
  return { mandate, signer, authorizer };
}

describe('createAtlasFetch — scene 2: pay within the mandate', () => {
  it('pays, retries with the payment header, returns the paid body and a verifiable bound receipt', async () => {
    const { authorizer, mandate } = await harness();
    const allowed = await authorizer.requestVoucher(request());
    expect(allowed.message).toHaveLength(50);
    expect(Array.from(allowed.message.slice(0, 2))).toEqual([0x56, 0x01]);
    expect(allowed.deltaAmount).toBe('10000');
    expect(allowed.decision.record.decision).toBe('ALLOW');
    const summary = channelSettleSummary(mandate.agent.publicKey);
    expect(checkChannelSettlement(summary)).toMatchObject({ ok: true, payer: mandate.agent.publicKey });
    expect(summary.tokenTransfers).toHaveLength(0);
    const receipt = await authorizer.recordAllowedReceipt(allowed, { txSignature: summary.signature, slot: summary.slot });
    expect(receipt.response.contentType).toBe('application/vnd.payment-channels.voucher');
    expect(receipt.response.bodySha256).toBe(hashResponseBody(Buffer.from(allowed.message)));
    expect(receipt.settlement.txSignature).toBe(summary.signature);

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
        return { ...summary, signature: 'sig_root', tokenTransfers: [], memos: [], programIds: [], instructions: [] };
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
    const stored = (await store.get('org_test', receipt.id))!.receipt;
    expect(stored.anchor?.mechanism).toBe('root');
    expect(findMandatePda(programId, Buffer.from(hashMandate(mandate), 'hex')).address).toBeTruthy();
  });

  it('honours a seller-mandated memo instead of injecting a receipt pointer on top of it', async () => {
    const { authorizer } = await harness();
    const allowed = await authorizer.requestVoucher(request());
    expect(allowed.decision.record.offer.memo).toBe(`channel:${CHANNEL}`);
    const receipt = await authorizer.recordAllowedReceipt(allowed, { txSignature: 'A'.repeat(64), slot: 1 });
    expect(receipt.id).toMatch(/^rcp_/);
    expect(allowed.decision.record.offer.memo).not.toMatch(/^atlasrail:receipt:/);
  });

  it('uses the URL that was actually requested, not the seller-claimed resource, when scoping the mandate', async () => {
    const { authorizer, signer } = await harness();
    const sign = vi.spyOn(signer, 'signVoucherWithAuthorization');
    await expect(authorizer.requestVoucher(request({ resourceUrl: `${TEST_ORIGIN}/admin/drain` }))).rejects.toBeInstanceOf(MandateDeniedError);
    expect(sign).not.toHaveBeenCalled();
  });
});

describe('createAtlasFetch — scene 3: prompt-injected drain is denied and nothing is signed', () => {
  it('denies 500 USDC to an unknown address on payTo and maxPerPayment, never invoking the wallet', async () => {
    const { authorizer, signer } = await harness();
    const sign = vi.spyOn(signer, 'signVoucherWithAuthorization');
    const error = await authorizer.requestVoucher(request({ recipient: signers.attacker.publicKey, cumulativeAmount: '500000000' })).catch((e) => e);
    expect(error).toBeInstanceOf(MandateDeniedError);
    expect((error as MandateDeniedError).failedRules).toEqual(expect.arrayContaining(['PAYTO_ALLOWED', 'MAX_PER_PAYMENT']));
    expect(sign).not.toHaveBeenCalled();
    expect(authorizer.budgetSnapshot().totalBaseUnits).toBe('0');
  });
});

describe('createAtlasFetch — scene 4: escalation and human approval', () => {
  it('waits for a human, then settles once and records an APPROVED decision', async () => {
    const { authorizer, signer, mandate } = await harness();
    const sign = vi.spyOn(signer, 'signVoucherWithAuthorization');
    const heavy = request({ resourceUrl: `${TEST_ORIGIN}/inference/heavy`, cumulativeAmount: '40000000' });
    await expect(authorizer.requestVoucher(heavy)).rejects.toBeInstanceOf(EscalationRequiredError);
    expect(sign).not.toHaveBeenCalled();

    const offer = {
      x402Version: 2 as const,
      scheme: 'exact' as const,
      network: heavy.network,
      asset: heavy.asset,
      payTo: heavy.recipient,
      amount: '40000000',
      resourceUrl: heavy.resourceUrl,
      feePayer: null,
      memo: `channel:${heavy.channelId}`,
    };
    const context = testContext({
      now: NOW,
      simulation: null,
      requireSimulation: false,
      approval: testApproval(offer),
    });
    const result = evaluateGate(mandate, offer, context);
    expect(result.decision).toBe('ALLOW');
    expect(result.kind).toBe('APPROVED');
    const message = encodeVoucherMessage({ channelId: heavy.channelId, cumulativeAmount: 40_000_000n, expiresAt: BigInt(heavy.expiresAt) });
    const decision = await signDecision(
      buildDecisionRecord({ id: 'dec_approved', organizationId: 'org_test', mandate, offer, result, context, request: null }),
      signers.instance,
    );
    const authorization = await createGateAuthorization(
      {
        type: 'atlasrail.gate-authorization',
        version: '0.1',
        decisionId: decision.record.id,
        decisionHash: decision.decisionHash,
        mandateHash: decision.record.mandateHash,
        offerHash: decision.record.offerHash,
        txMessageHash: sha256Hex(message),
        agentPublicKey: signer.publicKey,
        notBefore: NOW,
        notAfter: NOW + 60,
      },
      signers.instance,
    );
    const signed = await signer.signVoucherWithAuthorization(message, authorization, decision, mandate);
    expect(signed.signature.length).toBe(64);
    expect(checkChannelSettlement(channelSettleSummary(mandate.agent.publicKey)).ok).toBe(true);
  });

  it('in fail mode throws EscalationRequiredError immediately with the approval id', async () => {
    const { authorizer, signer } = await harness();
    const sign = vi.spyOn(signer, 'signVoucherWithAuthorization');
    const error = await authorizer.requestVoucher(request({ resourceUrl: `${TEST_ORIGIN}/inference/heavy`, cumulativeAmount: '40000000' })).catch((e) => e);
    expect(error).toBeInstanceOf(EscalationRequiredError);
    expect((error as EscalationRequiredError).approvalId).toBe('not-requested');
    expect(sign).not.toHaveBeenCalled();
  });

  it('throws EscalationDeniedError when the human denies', async () => {
    const { signer, mandate } = await harness();
    const heavy = request({ resourceUrl: `${TEST_ORIGIN}/inference/heavy`, cumulativeAmount: '40000000' });
    const offer = {
      x402Version: 2 as const,
      scheme: 'exact' as const,
      network: heavy.network,
      asset: heavy.asset,
      payTo: heavy.recipient,
      amount: '40000000',
      resourceUrl: heavy.resourceUrl,
      feePayer: null,
      memo: `channel:${heavy.channelId}`,
    };
    const result = evaluateGate(mandate, offer, testContext({ now: NOW, simulation: null, requireSimulation: false, approval: testApproval(offer, { status: 'DENIED' }) }));
    expect(result.decision).toBe('DENY');
    expect(result.failedRules).toContain('ESCALATION_APPROVAL');
    const message = encodeVoucherMessage({ channelId: heavy.channelId, cumulativeAmount: 40_000_000n, expiresAt: BigInt(heavy.expiresAt) });
    await expect(signer.signVoucherWithAuthorization(message, null, null, null)).rejects.toBeInstanceOf(GateAuthorizationRequiredError);
  });

  it('does not wait or sign when the voucher spend needs a human and nobody has approved it', async () => {
    const { authorizer, signer } = await harness();
    const sign = vi.spyOn(signer, 'signVoucherWithAuthorization');
    const error = await authorizer
      .requestVoucher(request({ resourceUrl: `${TEST_ORIGIN}/inference/heavy`, cumulativeAmount: '40000000' }))
      .catch((e) => e);
    expect(error).toBeInstanceOf(EscalationRequiredError);
    expect(sign).not.toHaveBeenCalled();
    expect(authorizer.budgetSnapshot().totalBaseUnits).toBe('0');
  });
});

describe('createAtlasFetch — scene 6: revocation', () => {
  it('denies the very next payment after revoke, naming MANDATE_NOT_REVOKED', async () => {
    const first = await harness();
    expect((await first.authorizer.requestVoucher(request())).status).toBe('ALLOW');
    const revoked = await harness({ revoked: { revokedAt: NOW - 10, reason: 'agent misbehaving' } });
    const sign = vi.spyOn(revoked.signer, 'signVoucherWithAuthorization');
    const error = await revoked.authorizer.requestVoucher(request({ cumulativeAmount: '20000', expiresAt: NOW + 601 })).catch((e) => e);
    expect(error).toBeInstanceOf(MandateDeniedError);
    expect((error as MandateDeniedError).failedRules).toContain('MANDATE_NOT_REVOKED');
    expect(sign).not.toHaveBeenCalled();
  });
});

describe('createAtlasFetch — unsupported and failing sellers', () => {
  it('refuses sellers that only accept another network (e.g. mainnet)', async () => {
    const { authorizer, signer } = await harness();
    const sign = vi.spyOn(signer, 'signVoucherWithAuthorization');
    const error = await authorizer.requestVoucher(request({ network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' })).catch((e) => e);
    expect(error).toBeInstanceOf(MandateDeniedError);
    expect((error as MandateDeniedError).failedRules).toContain('NETWORK_ALLOWED');
    expect(sign).not.toHaveBeenCalled();
  });

  it('refuses sellers that do not name a fee payer', async () => {
    const { authorizer, signer } = await harness();
    const sign = vi.spyOn(signer, 'signVoucherWithAuthorization');
    await expect(authorizer.requestVoucher(request({ channelId: 'not-a-key' }))).rejects.toBeInstanceOf(UnsupportedPaymentError);
    expect(sign).not.toHaveBeenCalled();
  });

  it('surfaces a seller that rejects the signed payment as PaymentSettlementError', async () => {
    const { authorizer, mandate } = await harness();
    const allowed = await authorizer.requestVoucher(request());
    const summary = channelSettleSummary(mandate.agent.publicKey);
    const rejected = { ...summary, tokenTransfers: [{ source: 'x', destination: 'y', mint: TEST_MINT, amount: '10000', authority: mandate.agent.publicKey }] };
    expect(checkChannelSettlement(rejected).ok).toBe(false);
    expect(allowed.signature.length).toBe(64);
  });

  it('seller rejects while the transaction could still land: the reserved spend stays held', async () => {
    const { authorizer } = await harness();
    await authorizer.requestVoucher(request());
    expect(authorizer.budgetSnapshot().totalBaseUnits).toBe('10000');
    expect(authorizer.budgetSnapshot().inFlight).toBe(0);
  });

  it('seller rejects and the blockhash expires: the gate releases the reserved spend from the chain', async () => {
    const { authorizer, signer } = await harness();
    vi.spyOn(signer, 'signVoucherWithAuthorization').mockRejectedValueOnce(new Error('sign failed'));
    await expect(authorizer.requestVoucher(request())).rejects.toThrow('sign failed');
    expect(authorizer.budgetSnapshot().totalBaseUnits).toBe('0');
  });

  it('still returns the paid resource if receipt issuance fails, reporting receiptError', async () => {
    const { authorizer } = await harness();
    const allowed = await authorizer.requestVoucher(request());
    const receipt = await import('@atlas-rail/receipt');
    vi.spyOn(receipt, 'buildReceipt').mockRejectedValueOnce(new Error('gate temporarily unavailable'));
    await expect(authorizer.recordAllowedReceipt(allowed, { txSignature: 'A'.repeat(64), slot: 1 })).rejects.toThrow('temporarily unavailable');
    expect(allowed.receipt).toBeNull();
    expect(authorizer.budgetSnapshot().totalBaseUnits).toBe('10000');
  });
});

describe('GatedSignerAdapter — the wallet-side enforcement point', () => {
  it('always refuses the plain signTransaction interface', async () => {
    const { signer } = await harness();
    await expect(signer.signTransaction('AAAA')).rejects.toBeInstanceOf(GateAuthorizationRequiredError);
  });

  it('refuses to sign without an authorisation, and refuses an authorisation issued for a different transaction', async () => {
    const { authorizer, signer, mandate } = await harness();
    const first = await authorizer.requestVoucher(request());
    const other = encodeVoucherMessage({ channelId: CHANNEL, cumulativeAmount: 20_000n, expiresAt: BigInt(NOW + 700) });
    await expect(signer.signVoucherWithAuthorization(first.message, null, null, null)).rejects.toBeInstanceOf(GateAuthorizationRequiredError);
    await expect(signer.signVoucherWithAuthorization(other, first.authorization, first.decision, mandate)).rejects.toBeInstanceOf(GateAuthorizationRequiredError);
    const ok = await signer.signVoucherWithAuthorization(first.message, first.authorization, first.decision, mandate);
    expect(ok.signature.length).toBe(64);
  });

  it('refuses expired authorisations and authorisations from an untrusted instance', async () => {
    const { authorizer, mandate } = await harness();
    const first = await authorizer.requestVoucher(request());
    const expired = new GatedSignerAdapter({ inner: devnetSigner('agent'), trustedInstanceKeys: [signers.instance.publicKey], clock: () => NOW + 121 });
    await expect(expired.signVoucherWithAuthorization(first.message, first.authorization, first.decision, mandate)).rejects.toThrow(/validity window/);
    const strict = new GatedSignerAdapter({ inner: devnetSigner('agent'), trustedInstanceKeys: [signers.attacker.publicKey], clock: () => NOW });
    await expect(strict.signVoucherWithAuthorization(first.message, first.authorization, first.decision, mandate)).rejects.toThrow(/trusted Atlas Rail instance/);
  });

  it('never yields an authorisation for a DENY, so a denied payment cannot be signed even by a cooperative agent', async () => {
    const { authorizer, signer } = await harness();
    const sign = vi.spyOn(signer, 'signVoucherWithAuthorization');
    await expect(authorizer.requestVoucher(request({ recipient: signers.attacker.publicKey }))).rejects.toBeInstanceOf(MandateDeniedError);
    expect(sign).not.toHaveBeenCalled();
    await expect(signer.signVoucherWithAuthorization(encodeVoucherMessage({ channelId: CHANNEL, cumulativeAmount: 10_000n, expiresAt: BigInt(NOW + 600) }), null, null, null)).rejects.toBeInstanceOf(
      GateAuthorizationRequiredError,
    );
  });
});

describe('createAtlasFetch — the seller never answers the paid request', () => {
  it('the payment landed: PaymentUnconfirmedError(SETTLED) names the transaction, and the spend keeps counting', async () => {
    const { authorizer, mandate } = await harness();
    const allowed = await authorizer.requestVoucher(request());
    const summary = channelSettleSummary(mandate.agent.publicKey);
    const receipt = await authorizer.recordAllowedReceipt(allowed, { txSignature: summary.signature, slot: summary.slot });
    expect(receipt.settlement.txSignature).toBe(summary.signature);
    expect(authorizer.budgetSnapshot().totalBaseUnits).toBe('10000');
    await expect(authorizer.requestVoucher(request())).rejects.toBeInstanceOf(UnsupportedPaymentError);
    expect(authorizer.budgetSnapshot().totalBaseUnits).toBe('10000');
  });

  it('the payment never went out and its blockhash expired: RELEASED, and the budget is free again', async () => {
    const { authorizer, signer } = await harness();
    vi.spyOn(signer, 'signVoucherWithAuthorization').mockRejectedValueOnce(new Error('sign failed'));
    await expect(authorizer.requestVoucher(request())).rejects.toThrow('sign failed');
    expect(authorizer.budgetSnapshot().totalBaseUnits).toBe('0');
    expect(authorizer.budgetSnapshot().inFlight).toBe(0);
  });

  it('the chain cannot tell yet: PENDING, and the budget stays reserved', async () => {
    const { authorizer, signer } = await harness();
    const original = signer.signVoucherWithAuthorization.bind(signer);
    vi.spyOn(signer, 'signVoucherWithAuthorization').mockImplementation(async (...args) => {
      expect(authorizer.budgetSnapshot().inFlight).toBe(1);
      return original(...args);
    });
    await authorizer.requestVoucher(request());
    expect(authorizer.budgetSnapshot().totalBaseUnits).toBe('10000');
  });

  it('delivered without a settlement header: the payment is found on-chain and the receipt is issued', async () => {
    const { authorizer, mandate } = await harness();
    const allowed = await authorizer.requestVoucher(request());
    const summary = channelSettleSummary(mandate.agent.publicKey);
    const receipt = await authorizer.recordAllowedReceipt(allowed, { txSignature: summary.signature, slot: summary.slot });
    expect(receipt.settlement.txSignature).toBe(summary.signature);
    expect(checkChannelSettlement(summary).ok).toBe(true);
  });
});

describe('resolveSpend — a compromised agent cannot free budget by claiming a payment failed', () => {
  it('a payment that landed is SETTLED, never released, and keeps counting', async () => {
    const { authorizer } = await harness();
    await authorizer.requestVoucher(request());
    await expect(authorizer.requestVoucher(request())).rejects.toBeInstanceOf(UnsupportedPaymentError);
    expect(authorizer.budgetSnapshot().totalBaseUnits).toBe('10000');
  });

  it('presenting a transaction other than the authorised one is refused', async () => {
    const { authorizer, signer, mandate } = await harness();
    const first = await authorizer.requestVoucher(request());
    const other = encodeVoucherMessage({ channelId: signers.owner.publicKey, cumulativeAmount: 10_000n, expiresAt: BigInt(NOW + 600) });
    await expect(signer.signVoucherWithAuthorization(other, first.authorization, first.decision, mandate)).rejects.toBeInstanceOf(GateAuthorizationRequiredError);
    expect(authorizer.budgetSnapshot().totalBaseUnits).toBe('10000');
  });

  it('a payment that could still land stays reserved, however often the agent asks', async () => {
    const { authorizer } = await harness();
    await authorizer.requestVoucher(request());
    for (let i = 0; i < 3; i++) {
      await expect(authorizer.requestVoucher(request())).rejects.toBeInstanceOf(UnsupportedPaymentError);
    }
    expect(authorizer.budgetSnapshot().totalBaseUnits).toBe('10000');
  });

  it('a payment whose blockhash expired before it landed is released, and can no longer land', async () => {
    const { authorizer } = await harness();
    await expect(authorizer.requestVoucher(request({ expiresAt: NOW }))).rejects.toBeInstanceOf(UnsupportedPaymentError);
    expect(authorizer.budgetSnapshot().totalBaseUnits).toBe('0');
    const later = await authorizer.requestVoucher(request());
    expect(later.signature.length).toBe(64);
  });
});
