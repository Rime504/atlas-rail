import { afterEach, describe, expect, it } from 'vitest';
import { hashOffer, sha256Hex } from '@atlas-rail/mandate';
import { verifyReceipt } from '@atlas-rail/receipt';
import { WORLD_ORG, World, createWorld } from '@atlas-rail/receipt/testing';
import { AtlasClientEvent, AtlasFetch, createAtlasFetch } from './fetch';
import {
  EscalationDeniedError,
  EscalationRequiredError,
  EscalationTimeoutError,
  GateAuthorizationRequiredError,
  MandateDeniedError,
  PaymentSettlementError,
  UnsupportedPaymentError,
} from './errors';
import { GatedSignerAdapter } from './gated-signer';
import { FakeSeller, FakeSellerRoute, LocalGateClient, reservePort, startFakeSeller } from './testkit';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

interface Rig {
  world: World;
  seller: FakeSeller;
  origin: string;
  events: AtlasClientEvent[];
  atlasFetch: AtlasFetch;
  signer: GatedSignerAdapter;
  gate: LocalGateClient;
  signCalls: string[];
}

async function rig(options: {
  routes?: (origin: string, world: World) => Record<string, FakeSellerRoute>;
  seller?: { omitFeePayer?: boolean; network?: string; rejectPayments?: boolean };
  escalation?: { mode: 'wait' | 'fail'; timeoutMs?: number; pollIntervalMs?: number };
} = {}): Promise<Rig> {
  const port = await reservePort();
  const origin = `http://127.0.0.1:${port}`;
  const world = await createWorld({
    mandate: { allowedResources: [`${origin}/research/*`], escalationResources: [`${origin}/inference/*`] },
  });
  const seller = await startFakeSeller({
    chain: world.chain,
    facilitator: world.keys.facilitator,
    payTo: world.keys.merchant.publicKey,
    mint: world.mandate.scope.limits.mint,
    port,
    routes: options.routes?.(origin, world) ?? {
      '/research/summary': { amount: '10000', body: { summary: 'devnet is fast' } },
      '/inference/heavy': { amount: '40000000', body: { result: 'heavy inference done' } },
      '/free': { amount: '0', body: {} },
    },
    ...options.seller,
  });
  closers.push(seller.close);

  const signCalls: string[] = [];
  const inner = world.keys.agent;
  const original = inner.signTransaction.bind(inner);
  inner.signTransaction = async (tx: string) => {
    signCalls.push(tx);
    return original(tx);
  };
  const signer = new GatedSignerAdapter({
    inner,
    trustedInstanceKeys: [world.keys.instance.publicKey],
    clock: () => world.clock.now,
  });
  const gate = new LocalGateClient({ organizationId: WORLD_ORG, gate: world.gate, store: world.store, receiptService: world.receiptService });
  const events: AtlasClientEvent[] = [];
  const atlasFetch = createAtlasFetch({
    mandateId: world.mandate.id,
    signer,
    gate,
    chain: world.chain,
    clock: () => world.clock.now,
    // A real (tiny) sleep: a no-op would spin the polling loop on microtasks and starve the timers the test relies on.
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 2))),
    receiptRetryDelayMs: 0,
    escalation: options.escalation ?? { mode: 'wait', timeoutMs: 5_000, pollIntervalMs: 5 },
    onEvent: (e) => events.push(e),
  });
  return { world, seller, origin, events, atlasFetch, signer, gate, signCalls };
}

describe('createAtlasFetch — pass-through', () => {
  it('returns non-402 responses untouched without contacting the gate', async () => {
    const r = await rig({ routes: () => ({ '/free': { amount: '0', body: {} } }) });
    const other = await startFakeSeller({ chain: r.world.chain, facilitator: r.world.keys.facilitator, payTo: r.world.keys.merchant.publicKey, mint: r.world.mandate.scope.limits.mint, routes: {} });
    closers.push(other.close);
    const res = await r.atlasFetch(`${other.url}/nothing`);
    expect(res.status).toBe(404);
    expect(res.atlas).toBeUndefined();
    expect(r.events).toEqual([]);
  });
});

describe('createAtlasFetch — scene 2: pay within the mandate', () => {
  it('pays, retries with the payment header, returns the paid body and a verifiable bound receipt', async () => {
    const r = await rig();
    const res = await r.atlasFetch(`${r.origin}/research/summary`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ summary: 'devnet is fast' });

    expect(res.atlas?.decision.record.decision).toBe('ALLOW');
    expect(res.atlas?.escalated).toBe(false);
    expect(r.seller.settled).toHaveLength(1);
    expect(r.world.chain.tokenBalance(r.world.keys.merchant.publicKey, r.world.mandate.scope.limits.mint)).toBe(10000n);

    const receipt = res.atlas!.receipt!;
    expect(receipt.settlement.txSignature).toBe(r.seller.settled[0]);
    expect(receipt.response.bodySha256).toBe(sha256Hex(JSON.stringify({ summary: 'devnet is fast' })));
    expect(receipt.hashes.offerHash).toBe(hashOffer(receipt.offer));
    expect(r.events.map((e) => e.type)).toEqual(['payment_required', 'gate_decision', 'payment_signed', 'settled', 'receipt_issued']);

    await r.world.anchorService.run();
    const stored = await r.world.receipts.get(WORLD_ORG, receipt.id);
    const verification = await verifyReceipt(stored!.receipt, { chain: r.world.chain, requireAnchor: true });
    expect(verification.pass).toBe(true);
  });

  it('uses the URL that was actually requested, not the seller-claimed resource, when scoping the mandate', async () => {
    const r = await rig({
      routes: (origin) => ({
        // A malicious seller serving /admin/drain claims its resource is a harmless research URL.
        '/admin/drain': { amount: '10000', body: {}, claimedResource: `${origin}/research/summary` },
      }),
    });
    await expect(r.atlasFetch(`${r.origin}/admin/drain`)).rejects.toMatchObject({ code: 'MANDATE_DENIED' });
    expect(r.signCalls).toHaveLength(0);
  });
});

describe('createAtlasFetch — scene 3: prompt-injected drain is denied and nothing is signed', () => {
  it('denies 500 USDC to an unknown address on payTo and maxPerPayment, never invoking the wallet', async () => {
    const r = await rig({
      routes: (_origin, world) => ({
        '/research/urgent': { amount: '500000000', payTo: world.keys.attacker.publicKey, body: { pwned: true } },
      }),
    });
    const before = r.world.chain.tokenBalance(r.world.keys.agent.publicKey, r.world.mandate.scope.limits.mint);
    const error = await r.atlasFetch(`${r.origin}/research/urgent`).catch((e) => e);
    expect(error).toBeInstanceOf(MandateDeniedError);
    expect((error as MandateDeniedError).failedRules).toEqual(expect.arrayContaining(['PAYTO_ALLOWED', 'MAX_PER_PAYMENT']));
    expect(r.signCalls).toHaveLength(0);
    expect(r.seller.settled).toHaveLength(0);
    expect(r.world.chain.tokenBalance(r.world.keys.agent.publicKey, r.world.mandate.scope.limits.mint)).toBe(before);
    expect(r.world.chain.tokenBalance(r.world.keys.attacker.publicKey, r.world.mandate.scope.limits.mint)).toBe(0n);
  });
});

describe('createAtlasFetch — scene 4: escalation and human approval', () => {
  it('waits for a human, then settles once and records an APPROVED decision', async () => {
    const r = await rig();
    const pending = r.atlasFetch(`${r.origin}/inference/heavy`);
    // Wait until the client is parked on the approval, then a human (an APPROVER) approves it.
    for (let i = 0; i < 200 && !r.events.some((e) => e.type === 'awaiting_approval'); i++) await new Promise((res) => setTimeout(res, 5));
    const awaiting = r.events.find((e) => e.type === 'awaiting_approval') as { approvalId: string };
    expect(awaiting).toBeDefined();
    expect(r.signCalls).toHaveLength(0); // nothing signed while waiting
    await r.world.lifecycle.decideApproval(WORLD_ORG, awaiting.approvalId, { approve: true, approver: { userId: 'usr_approver', role: 'APPROVER' }, comment: 'ok' });

    const res = await pending;
    expect(res.status).toBe(200);
    expect(res.atlas?.escalated).toBe(true);
    expect(res.atlas?.decision.record.kind).toBe('APPROVED');
    expect(res.atlas?.receipt?.decision.record.kind).toBe('APPROVED');
    expect(r.seller.settled).toHaveLength(1);
    expect(r.world.chain.tokenBalance(r.world.keys.merchant.publicKey, r.world.mandate.scope.limits.mint)).toBe(40_000_000n);
    expect(r.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['payment_required', 'gate_decision', 'awaiting_approval', 'approval_granted', 'payment_signed', 'settled', 'receipt_issued']),
    );
  });

  it('in fail mode throws EscalationRequiredError immediately with the approval id', async () => {
    const r = await rig({ escalation: { mode: 'fail' } });
    const error = await r.atlasFetch(`${r.origin}/inference/heavy`).catch((e) => e);
    expect(error).toBeInstanceOf(EscalationRequiredError);
    expect((error as EscalationRequiredError).approvalId).toMatch(/^apr_/);
    expect(r.signCalls).toHaveLength(0);
  });

  it('throws EscalationDeniedError when the human denies', async () => {
    const r = await rig();
    const pending = r.atlasFetch(`${r.origin}/inference/heavy`).catch((e) => e);
    for (let i = 0; i < 200 && !r.events.some((e) => e.type === 'awaiting_approval'); i++) await new Promise((res) => setTimeout(res, 5));
    const id = (r.events.find((e) => e.type === 'awaiting_approval') as { approvalId: string }).approvalId;
    await r.world.lifecycle.decideApproval(WORLD_ORG, id, { approve: false, approver: { userId: 'usr_approver', role: 'APPROVER' }, comment: 'no' });
    expect(await pending).toBeInstanceOf(EscalationDeniedError);
    expect(r.signCalls).toHaveLength(0);
  });

  it('throws EscalationTimeoutError if nobody decides in time', async () => {
    const r = await rig({ escalation: { mode: 'wait', timeoutMs: 30, pollIntervalMs: 5 } });
    const error = await r.atlasFetch(`${r.origin}/inference/heavy`).catch((e) => e);
    expect(error).toBeInstanceOf(EscalationTimeoutError);
    expect(r.signCalls).toHaveLength(0);
  });
});

describe('createAtlasFetch — scene 6: revocation', () => {
  it('denies the very next payment after revoke, naming MANDATE_NOT_REVOKED', async () => {
    const r = await rig();
    expect((await r.atlasFetch(`${r.origin}/research/summary`)).status).toBe(200);
    await r.world.lifecycle.revoke(WORLD_ORG, r.world.mandate.id, { userId: 'usr_owner', reason: 'agent misbehaving' });
    const error = await r.atlasFetch(`${r.origin}/research/summary`).catch((e) => e);
    expect(error).toBeInstanceOf(MandateDeniedError);
    expect((error as MandateDeniedError).failedRules).toContain('MANDATE_NOT_REVOKED');
    expect(r.seller.settled).toHaveLength(1);
  });
});

describe('createAtlasFetch — unsupported and failing sellers', () => {
  it('refuses sellers that only accept another network (e.g. mainnet)', async () => {
    const r = await rig({ seller: { network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' } });
    await expect(r.atlasFetch(`${r.origin}/research/summary`)).rejects.toBeInstanceOf(UnsupportedPaymentError);
    expect(r.signCalls).toHaveLength(0);
  });

  it('refuses sellers that do not name a fee payer', async () => {
    const r = await rig({ seller: { omitFeePayer: true } });
    await expect(r.atlasFetch(`${r.origin}/research/summary`)).rejects.toBeInstanceOf(UnsupportedPaymentError);
  });

  it('surfaces a seller that rejects the signed payment as PaymentSettlementError', async () => {
    const r = await rig({ seller: { rejectPayments: true } });
    await expect(r.atlasFetch(`${r.origin}/research/summary`)).rejects.toBeInstanceOf(PaymentSettlementError);
  });

  it('still returns the paid resource if receipt issuance fails, reporting receiptError', async () => {
    const r = await rig();
    r.gate.issueReceipt = async () => {
      throw new Error('gate temporarily unavailable');
    };
    const res = await r.atlasFetch(`${r.origin}/research/summary`);
    expect(res.status).toBe(200);
    expect(res.atlas?.receipt).toBeNull();
    expect(res.atlas?.receiptError).toContain('temporarily unavailable');
    expect(res.atlas?.txSignature).toBe(r.seller.settled[0]);
  });
});

describe('GatedSignerAdapter — the wallet-side enforcement point', () => {
  it('always refuses the plain signTransaction interface', async () => {
    const r = await rig();
    await expect(r.signer.signTransaction('AAAA')).rejects.toBeInstanceOf(GateAuthorizationRequiredError);
  });

  it('refuses to sign without an authorisation, and refuses an authorisation issued for a different transaction', async () => {
    const r = await rig();
    const research = `${r.origin}/research/summary`;
    const first = await r.world.requestGate({ amount: '10000', resourceUrl: research });
    const second = await r.world.requestGate({ amount: '10000', resourceUrl: research });
    await expect(r.signer.signWithAuthorization(first.transactionBase64, null)).rejects.toBeInstanceOf(GateAuthorizationRequiredError);
    // Confused deputy: the gate approved transaction A, the agent is talked into signing transaction B.
    await expect(r.signer.signWithAuthorization(second.transactionBase64, first.outcome.authorization)).rejects.toThrow(/does not cover this transaction/);
    expect(r.signCalls).toHaveLength(0);
    // The matching pair is signed.
    const ok = await r.signer.signWithAuthorization(first.transactionBase64, first.outcome.authorization);
    expect(ok.signedBase64).toBeTruthy();
    expect(r.signCalls).toHaveLength(1);
  });

  it('refuses expired authorisations and authorisations from an untrusted instance', async () => {
    const r = await rig();
    const req = await r.world.requestGate({ amount: '10000', resourceUrl: `${r.origin}/research/summary` });
    r.world.clock.advance(121); // authorisation TTL is 120s
    await expect(r.signer.signWithAuthorization(req.transactionBase64, req.outcome.authorization)).rejects.toThrow(/validity window/);

    const strict = new GatedSignerAdapter({ inner: r.world.keys.agent, trustedInstanceKeys: [r.world.keys.attacker.publicKey], clock: () => r.world.clock.now });
    const fresh = await r.world.requestGate({ amount: '10000', resourceUrl: `${r.origin}/research/summary` });
    await expect(strict.signWithAuthorization(fresh.transactionBase64, fresh.outcome.authorization)).rejects.toThrow(/trusted Atlas Rail instance/);
  });

  it('never yields an authorisation for a DENY, so a denied payment cannot be signed even by a cooperative agent', async () => {
    const r = await rig();
    const denied = await r.world.requestGate({ payTo: r.world.keys.attacker.publicKey, amount: '10000', resourceUrl: `${r.origin}/research/summary` });
    expect(denied.outcome.authorization).toBeNull();
    await expect(r.signer.signWithAuthorization(denied.transactionBase64, denied.outcome.authorization)).rejects.toBeInstanceOf(GateAuthorizationRequiredError);
  });
});
