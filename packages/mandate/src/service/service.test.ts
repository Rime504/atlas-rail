import { describe, expect, it } from 'vitest';
import { verifyDecisionMatchesScope, verifyDecisionSignature, verifyGateAuthorization, signGateRequest } from '../decision';
import { GateSimulation } from '../gate';
import { sha256Hex } from '../crypto';
import { hashOffer, X402Offer } from '../offer';
import { NOW, TEST_ORIGIN, signers, testOffer, unsignedTestMandate } from '../testing';
import { AgentGateService } from './gate-service';
import { MandateLifecycleService, effectiveMandateStatus } from './lifecycle';
import { InMemoryAgentStore } from './memory';
import { AgentServiceError, PaymentSimulator } from './ports';

const ORG = 'org_test';

class FakeSimulator implements PaymentSimulator {
  calls = 0;
  matchesOffer = true;
  success = true;
  async simulate(input: { transactionBase64: string }): Promise<GateSimulation> {
    this.calls += 1;
    return {
      success: this.success,
      error: this.success ? null : 'InsufficientFunds',
      programIds: ['ComputeBudget111111111111111111111111111111'],
      unknownProgramIds: [],
      transferCount: 1,
      matchesOffer: this.matchesOffer,
      mismatch: this.matchesOffer ? null : 'destination is not the payTo token account',
      txMessageHash: sha256Hex(input.transactionBase64),
      unitsConsumed: 18000,
    };
  }
}

async function setup() {
  const store = new InMemoryAgentStore();
  let now = NOW;
  let counter = 0;
  const clock = () => now;
  const events: string[] = [];
  const notify = (e: { type: string }) => {
    events.push(e.type);
  };
  const newId = (prefix: string) => `${prefix}_${String(++counter).padStart(6, '0')}`;
  const simulator = new FakeSimulator();
  const lifecycle = new MandateLifecycleService({ store, clock, notify });
  const gate = new AgentGateService({ store, instanceSigner: signers.instance, simulator, clock, newId, notify });

  const base = unsignedTestMandate();
  const draft = await lifecycle.createDraft(ORG, 'usr_owner', {
    issuer: base.issuer,
    agent: base.agent,
    scope: base.scope,
    escalation: base.escalation,
    notBefore: NOW - 60,
    expiresAt: NOW + 3 * 86_400,
  });
  await lifecycle.sign(ORG, draft.mandate.id, { role: 'OWNER', signer: signers.owner, userId: 'usr_owner' });
  await lifecycle.sign(ORG, draft.mandate.id, { role: 'APPROVER', signer: signers.approver, userId: 'usr_approver' });
  const active = await lifecycle.sign(ORG, draft.mandate.id, { role: 'AGENT', signer: signers.agent, userId: null });

  let nonce = 0;
  const request = async (offerOverrides: Partial<X402Offer> = {}, extra: { approvalId?: string | null; nonce?: string; tx?: string | null } = {}) => {
    const offer = testOffer(offerOverrides);
    return signGateRequest(
      {
        type: 'atlasrail.gate-request',
        version: '0.1',
        mandateId: active.mandate.id,
        offer,
        transactionBase64: extra.tx === undefined ? `tx-${nonce}` : extra.tx,
        approvalId: extra.approvalId ?? null,
        nonce: extra.nonce ?? `nonce-${++nonce}`,
        requestedAt: now,
      },
      signers.agent,
    );
  };

  return {
    store,
    lifecycle,
    gate,
    simulator,
    events,
    mandate: active.mandate,
    request,
    advance: (seconds: number) => {
      now += seconds;
    },
    now: () => now,
  };
}

describe('mandate lifecycle', () => {
  it('walks OWNER → APPROVER → AGENT and ends ACTIVE', async () => {
    const t = await setup();
    const record = await t.store.mandates.get(ORG, t.mandate.id);
    expect(record?.status).toBe('ACTIVE');
    expect(effectiveMandateStatus(record!, t.now())).toBe('ACTIVE');
    expect(record?.signers.map((s) => s.role)).toEqual(['OWNER', 'APPROVER', 'AGENT']);
    expect(t.events).toContain('agent.mandate.activated');
  });

  it('requires approvers to be independent users, not just different keys', async () => {
    const store = new InMemoryAgentStore();
    const lifecycle = new MandateLifecycleService({ store, clock: () => NOW });
    const base = unsignedTestMandate();
    const draft = await lifecycle.createDraft(ORG, 'usr_owner', {
      issuer: base.issuer,
      agent: base.agent,
      scope: base.scope,
      escalation: base.escalation,
      notBefore: NOW - 60,
      expiresAt: NOW + 86_400,
    });
    await lifecycle.sign(ORG, draft.mandate.id, { role: 'OWNER', signer: signers.owner, userId: 'usr_owner' });
    await expect(
      lifecycle.sign(ORG, draft.mandate.id, { role: 'APPROVER', signer: signers.approver, userId: 'usr_owner' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects invalid input with a readable error and never persists it', async () => {
    const store = new InMemoryAgentStore();
    const lifecycle = new MandateLifecycleService({ store, clock: () => NOW });
    const base = unsignedTestMandate();
    await expect(
      lifecycle.createDraft(ORG, null, {
        issuer: base.issuer,
        agent: base.agent,
        scope: { ...base.scope, limits: { ...base.scope.limits, maxPerPayment: '999999999999' } },
        escalation: base.escalation,
        notBefore: NOW,
        expiresAt: NOW + 100,
      }),
    ).rejects.toBeInstanceOf(AgentServiceError);
    expect(await store.mandates.list(ORG)).toEqual([]);
  });

  it('signing a revoked or already-active mandate is rejected', async () => {
    const t = await setup();
    await expect(t.lifecycle.sign(ORG, t.mandate.id, { role: 'OWNER', signer: signers.attacker, userId: 'usr_x' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await t.lifecycle.revoke(ORG, t.mandate.id, { userId: 'usr_owner', reason: 'test' });
    await expect(t.lifecycle.sign(ORG, t.mandate.id, { role: 'OWNER', signer: signers.attacker, userId: 'usr_x' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('is scoped to the organisation', async () => {
    const t = await setup();
    expect(await t.store.mandates.get('org_other', t.mandate.id)).toBeNull();
    await expect(t.lifecycle.revoke('org_other', t.mandate.id, { userId: 'u', reason: null })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('gate service — the six demo scenes', () => {
  it('scene 2: ALLOWs a research payment, returns a signed decision and a tx-bound authorization', async () => {
    const t = await setup();
    const req = await t.request({ amount: '10000' });
    const outcome = await t.gate.evaluate(ORG, req);
    expect(outcome.decision.record.decision).toBe('ALLOW');
    expect(outcome.decision.record.kind).toBe('AUTONOMOUS');
    expect(verifyDecisionSignature(outcome.decision).ok).toBe(true);
    expect(verifyDecisionMatchesScope(t.mandate, outcome.decision).ok).toBe(true);
    expect(outcome.authorization).not.toBeNull();
    expect(
      verifyGateAuthorization(outcome.authorization!, {
        trustedInstanceKeys: [signers.instance.publicKey],
        now: t.now(),
        txMessageHash: sha256Hex(req.transactionBase64!),
        agentPublicKey: signers.agent.publicKey,
      }).ok,
    ).toBe(true);
    const audit = (t.store.audit as unknown as { entries: { action: string }[] }).entries.map((e) => e.action);
    expect(audit).toContain('AGENT_DECISION_ALLOW');
  });

  it('scene 3: DENIES the prompt-injected 500 USDC transfer to an unknown address, signs nothing, names both rules', async () => {
    const t = await setup();
    const outcome = await t.gate.evaluate(ORG, await t.request({ payTo: signers.attacker.publicKey, amount: '500000000' }));
    expect(outcome.decision.record.decision).toBe('DENY');
    expect(outcome.decision.record.failedRules).toEqual(expect.arrayContaining(['PAYTO_ALLOWED', 'MAX_PER_PAYMENT']));
    expect(outcome.authorization).toBeNull();
    expect(t.simulator.calls).toBe(0); // a clear denial never costs an RPC simulation
    const totals = await t.store.spend.totals(t.mandate.id, t.now(), 86_400, 300);
    expect(totals.totalBaseUnits).toBe('0');
    expect(t.events).toContain('agent.decision.deny');
  });

  it('scene 4: ESCALATES the $40 inference purchase, creates an approval, and after a human approves it settles once', async () => {
    const t = await setup();
    const heavy = { amount: '40000000', resourceUrl: `${TEST_ORIGIN}/inference/heavy` };
    const escalated = await t.gate.evaluate(ORG, await t.request(heavy));
    expect(escalated.decision.record.decision).toBe('ESCALATE');
    expect(escalated.authorization).toBeNull();
    expect(escalated.approval?.status).toBe('PENDING');
    expect(escalated.approval?.offerHash).toBe(hashOffer(testOffer(heavy)));
    expect(t.events).toContain('agent.approval.requested');

    // Retrying before anyone approved is denied: a pending approval is not an approval.
    const early = await t.gate.evaluate(ORG, await t.request(heavy, { approvalId: escalated.approval!.id }));
    expect(early.decision.record.decision).toBe('DENY');
    expect(early.decision.record.failedRule).toBe('ESCALATION_APPROVAL');

    // A human approves (independent of the agent).
    const approved = await t.lifecycle.decideApproval(ORG, escalated.approval!.id, {
      approve: true,
      approver: { userId: 'usr_approver', role: 'APPROVER' },
      comment: 'ok for Q3 inference budget',
    });
    expect(approved.status).toBe('APPROVED');

    const allowed = await t.gate.evaluate(ORG, await t.request(heavy, { approvalId: escalated.approval!.id }));
    expect(allowed.decision.record.decision).toBe('ALLOW');
    expect(allowed.decision.record.kind).toBe('APPROVED');
    expect(allowed.authorization).not.toBeNull();

    // The approval is single use.
    const reuse = await t.gate.evaluate(ORG, await t.request(heavy, { approvalId: escalated.approval!.id }));
    expect(reuse.decision.record.decision).toBe('DENY');

    // Approved spend counts against the lifetime cap but not the autonomous window.
    const totals = await t.store.spend.totals(t.mandate.id, t.now(), 86_400, 300);
    expect(totals).toEqual({ windowAutonomousBaseUnits: '0', totalBaseUnits: '40000000' });
  });

  it('scene 4b: an approval for one offer cannot be used to pay a different one', async () => {
    const t = await setup();
    const heavy = { amount: '40000000', resourceUrl: `${TEST_ORIGIN}/inference/heavy` };
    const escalated = await t.gate.evaluate(ORG, await t.request(heavy));
    await t.lifecycle.decideApproval(ORG, escalated.approval!.id, { approve: true, approver: { userId: 'usr_approver', role: 'APPROVER' }, comment: null });
    const other = await t.gate.evaluate(ORG, await t.request({ ...heavy, amount: '45000000' }, { approvalId: escalated.approval!.id }));
    expect(other.decision.record.decision).toBe('DENY');
    expect(other.decision.record.reason).toContain('different offer');
  });

  it('scene 6: revocation is immediate and shown as the failed rule', async () => {
    const t = await setup();
    expect((await t.gate.evaluate(ORG, await t.request({ amount: '10000' }))).decision.record.decision).toBe('ALLOW');
    await t.lifecycle.revoke(ORG, t.mandate.id, { userId: 'usr_owner', reason: 'agent behaving oddly' });
    const after = await t.gate.evaluate(ORG, await t.request({ amount: '10000' }));
    expect(after.decision.record.decision).toBe('DENY');
    expect(after.decision.record.failedRule).toBe('MANDATE_NOT_REVOKED');
    expect(after.authorization).toBeNull();
    const record = await t.store.mandates.get(ORG, t.mandate.id);
    expect(effectiveMandateStatus(record!, t.now())).toBe('REVOKED');
  });
});

describe('gate service — safety properties', () => {
  it('is idempotent on (mandate, nonce): a replay returns the same decision and reserves spend once', async () => {
    const t = await setup();
    const req = await t.request({ amount: '10000' }, { nonce: 'fixed-nonce' });
    const first = await t.gate.evaluate(ORG, req);
    const second = await t.gate.evaluate(ORG, req);
    expect(second.replayed).toBe(true);
    expect(second.decision.record.id).toBe(first.decision.record.id);
    expect((await t.store.spend.totals(t.mandate.id, t.now(), 86_400, 300)).totalBaseUnits).toBe('10000');
    expect(t.simulator.calls).toBe(1);
  });

  it('rejects the same nonce with a different request (409-style)', async () => {
    const t = await setup();
    await t.gate.evaluate(ORG, await t.request({ amount: '10000' }, { nonce: 'n' }));
    await expect(t.gate.evaluate(ORG, await t.request({ amount: '20000' }, { nonce: 'n' }))).rejects.toMatchObject({ code: 'NONCE_REUSED' });
  });

  it('rejects requests not signed by the mandate agent and forged signatures', async () => {
    const t = await setup();
    const forged = await signGateRequest(
      { type: 'atlasrail.gate-request', version: '0.1', mandateId: t.mandate.id, offer: testOffer(), transactionBase64: 'x', approvalId: null, nonce: 'z', requestedAt: t.now() },
      signers.attacker,
    );
    await expect(t.gate.evaluate(ORG, forged)).rejects.toMatchObject({ code: 'AGENT_MISMATCH' });
    const tampered = { ...(await t.request()), nonce: 'changed-after-signing' };
    await expect(t.gate.evaluate(ORG, tampered)).rejects.toMatchObject({ code: 'BAD_SIGNATURE' });
  });

  it('rejects stale and future-dated requests (clock skew)', async () => {
    const t = await setup();
    const req = await t.request();
    t.advance(121);
    await expect(t.gate.evaluate(ORG, req)).rejects.toMatchObject({ code: 'CLOCK_SKEW' });
  });

  it('cannot see another organisation’s mandate', async () => {
    const t = await setup();
    await expect(t.gate.evaluate('org_other', await t.request())).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('DENIES when the simulation fails or the transaction does not pay the offer, and reserves nothing', async () => {
    const t = await setup();
    t.simulator.matchesOffer = false;
    const mismatch = await t.gate.evaluate(ORG, await t.request());
    expect(mismatch.decision.record.failedRule).toBe('TRANSACTION_SIMULATION');
    t.simulator.matchesOffer = true;
    t.simulator.success = false;
    const failed = await t.gate.evaluate(ORG, await t.request());
    expect(failed.decision.record.failedRule).toBe('TRANSACTION_SIMULATION');
    expect((await t.store.spend.totals(t.mandate.id, t.now(), 86_400, 300)).totalBaseUnits).toBe('0');
  });

  it('DENIES a request that carries no transaction to simulate', async () => {
    const t = await setup();
    const outcome = await t.gate.evaluate(ORG, await t.request({}, { tx: null }));
    expect(outcome.decision.record.decision).toBe('DENY');
    expect(outcome.decision.record.failedRule).toBe('TRANSACTION_SIMULATION');
  });

  it('serialises concurrent requests so they cannot jointly exceed the lifetime cap', async () => {
    const t = await setup();
    // Lifetime cap is 100 USDC; ten concurrent 11 USDC approved-scale payments... use small autonomous ones near the cap instead.
    const requests = await Promise.all(Array.from({ length: 12 }, () => t.request({ amount: '9000000', resourceUrl: `${TEST_ORIGIN}/research/big` })));
    const outcomes = await Promise.all(requests.map((r) => t.gate.evaluate(ORG, r)));
    const totals = await t.store.spend.totals(t.mandate.id, t.now(), 86_400, 300);
    // Each 9 USDC payment is above the $1 threshold, so all escalate and none may reserve; totals must stay 0 (no overspend).
    expect(outcomes.every((o) => o.decision.record.decision === 'ESCALATE')).toBe(true);
    expect(totals.totalBaseUnits).toBe('0');
  });

  it('rolling window: autonomous spend fills the daily budget, escalates, then rolls out after the window', async () => {
    const t = await setup();
    // Five $1.00 autonomous payments fill the $5 window (threshold is exactly $1, allowed).
    for (let i = 0; i < 5; i++) {
      const outcome = await t.gate.evaluate(ORG, await t.request({ amount: '1000000' }));
      expect(outcome.decision.record.decision).toBe('ALLOW');
      await t.store.spend.markSettled(outcome.decision.record.id, `sig${i}`);
    }
    const over = await t.gate.evaluate(ORG, await t.request({ amount: '1000000' }));
    expect(over.decision.record.decision).toBe('ESCALATE');
    expect(over.decision.record.escalationRules).toContain('WINDOW_BUDGET');

    t.advance(86_400); // exactly one window later: the earliest entries are `windowSeconds` old, so they have rolled out
    const later = await t.gate.evaluate(ORG, await t.request({ amount: '1000000' }));
    expect(later.decision.record.decision).toBe('ALLOW');
  });

  it('unsettled reservations expire after the reservation TTL so a failed payment does not lock the budget', async () => {
    const t = await setup();
    await t.gate.evaluate(ORG, await t.request({ amount: '1000000' }));
    expect((await t.store.spend.totals(t.mandate.id, t.now(), 86_400, 300)).totalBaseUnits).toBe('1000000');
    t.advance(300);
    expect((await t.store.spend.totals(t.mandate.id, t.now(), 86_400, 300)).totalBaseUnits).toBe('0');
  });

  it('expired approvals cannot be decided and are not honoured', async () => {
    const t = await setup();
    const heavy = { amount: '40000000', resourceUrl: `${TEST_ORIGIN}/inference/heavy` };
    const escalated = await t.gate.evaluate(ORG, await t.request(heavy));
    t.advance(901); // approvalTtlSeconds = 900
    await expect(
      t.lifecycle.decideApproval(ORG, escalated.approval!.id, { approve: true, approver: { userId: 'usr_approver', role: 'APPROVER' }, comment: null }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('only mandate-permitted roles may decide an approval', async () => {
    const t = await setup();
    const escalated = await t.gate.evaluate(ORG, await t.request({ amount: '2000000' }));
    await expect(
      t.lifecycle.decideApproval(ORG, escalated.approval!.id, { approve: true, approver: { userId: 'usr_dev', role: 'DEVELOPER' }, comment: null }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a denied approval stays denied', async () => {
    const t = await setup();
    const escalated = await t.gate.evaluate(ORG, await t.request({ amount: '2000000' }));
    await t.lifecycle.decideApproval(ORG, escalated.approval!.id, { approve: false, approver: { userId: 'usr_approver', role: 'APPROVER' }, comment: 'no' });
    const retry = await t.gate.evaluate(ORG, await t.request({ amount: '2000000' }, { approvalId: escalated.approval!.id }));
    expect(retry.decision.record.decision).toBe('DENY');
  });

  it('records every decision in the append-only audit trail (allow, deny, escalate)', async () => {
    const t = await setup();
    await t.gate.evaluate(ORG, await t.request({ amount: '10000' }));
    await t.gate.evaluate(ORG, await t.request({ payTo: signers.attacker.publicKey }));
    await t.gate.evaluate(ORG, await t.request({ amount: '2000000' }));
    const actions = (t.store.audit as unknown as { entries: { action: string }[] }).entries.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['AGENT_DECISION_ALLOW', 'AGENT_DECISION_DENY', 'AGENT_DECISION_ESCALATE']));
    const listed = await t.store.decisions.list(ORG, { limit: 10 });
    expect(listed).toHaveLength(3);
  });

  it('a failing notification sink never blocks or changes a decision', async () => {
    const t = await setup();
    const store = t.store;
    const gate = new AgentGateService({
      store,
      instanceSigner: signers.instance,
      simulator: new FakeSimulator(),
      clock: () => t.now(),
      newId: (p) => `${p}_x${Math.random().toString(36).slice(2, 8)}`,
      notify: () => {
        throw new Error('queue down');
      },
    });
    const outcome = await gate.evaluate(ORG, await t.request({ amount: '10000' }));
    expect(outcome.decision.record.decision).toBe('ALLOW');
  });
});
