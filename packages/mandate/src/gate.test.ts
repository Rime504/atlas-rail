import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GateResult, RuleId, RuleStatus, evaluateGate } from './gate';
import { hashOffer } from './offer';
import { AgentMandate } from './schema';
import {
  NOW,
  TEST_ORIGIN,
  signedTestMandate,
  signers,
  testApproval,
  testContext,
  testOffer,
  testSimulation,
} from './testing';

function statusOf(result: GateResult, id: RuleId): RuleStatus {
  const rule = result.rulesEvaluated.find((r) => r.id === id);
  if (!rule) throw new Error(`rule ${id} was not evaluated`);
  return rule.status;
}

async function gate(
  offerOverrides: Parameters<typeof testOffer>[0] = {},
  contextOverrides: Parameters<typeof testContext>[0] = {},
  mandate?: AgentMandate,
): Promise<GateResult> {
  return evaluateGate(mandate ?? (await signedTestMandate()), testOffer(offerOverrides), testContext(contextOverrides));
}

describe('evaluateGate — happy path', () => {
  it('ALLOWs a small in-scope research payment autonomously and lists every rule', async () => {
    const result = await gate();
    expect(result.decision).toBe('ALLOW');
    expect(result.kind).toBe('AUTONOMOUS');
    expect(result.failedRule).toBeNull();
    expect(result.rulesEvaluated.map((r) => r.id)).toEqual([
      'OFFER_WELL_FORMED',
      'MANDATE_SIGNATURES',
      'MANDATE_VALIDITY',
      'MANDATE_NOT_REVOKED',
      'NETWORK_ALLOWED',
      'ASSET_ALLOWED',
      'RESOURCE_ALLOWED',
      'PAYTO_ALLOWED',
      'MAX_PER_PAYMENT',
      'WINDOW_BUDGET',
      'MAX_TOTAL',
      'TRANSACTION_SIMULATION',
      'ESCALATION_THRESHOLD',
    ]);
    expect(result.rulesEvaluated.every((r) => r.status === 'PASS')).toBe(true);
    expect(result.offerHash).toBe(hashOffer(testOffer()));
  });

  it('is deterministic and does not mutate its inputs', async () => {
    const mandate = await signedTestMandate();
    const offer = testOffer();
    const context = testContext();
    const before = JSON.stringify({ mandate, offer, context });
    const a = evaluateGate(mandate, offer, context);
    const b = evaluateGate(mandate, offer, context);
    expect(a).toEqual(b);
    expect(JSON.stringify({ mandate, offer, context })).toBe(before);
  });
});

describe('evaluateGate — hard rules deny', () => {
  it('denies an unknown payTo (the prompt-injection drain) and names the rule', async () => {
    const result = await gate({ payTo: signers.attacker.publicKey });
    expect(result.decision).toBe('DENY');
    expect(result.failedRule).toBe('PAYTO_ALLOWED');
    expect(statusOf(result, 'PAYTO_ALLOWED')).toBe('FAIL');
    expect(result.reason).toContain('PAYTO_ALLOWED');
  });

  it('reports every failed rule: 500 USDC to an unknown address fails payTo AND maxPerPayment', async () => {
    const result = await gate({ payTo: signers.attacker.publicKey, amount: '500000000' });
    expect(result.decision).toBe('DENY');
    expect(result.failedRules).toEqual(['PAYTO_ALLOWED', 'MAX_PER_PAYMENT', 'MAX_TOTAL']);
    expect(result.failedRule).toBe('PAYTO_ALLOWED');
  });

  it('denies networks other than devnet, including mainnet', async () => {
    for (const network of ['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', 'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z', 'eip155:8453']) {
      const result = await gate({ network });
      expect(result.decision).toBe('DENY');
      expect(result.failedRules).toContain('NETWORK_ALLOWED');
    }
  });

  it('denies a different asset', async () => {
    const result = await gate({ asset: signers.attacker.publicKey });
    expect(result.decision).toBe('DENY');
    expect(result.failedRules).toContain('ASSET_ALLOWED');
  });

  it('denies resources outside both autonomous and approvable scope', async () => {
    for (const resourceUrl of [`${TEST_ORIGIN}/admin/drain`, 'http://evil.example/research/summary', `${TEST_ORIGIN}/research/../admin`]) {
      const result = await gate({ resourceUrl });
      expect(result.decision, resourceUrl).toBe('DENY');
      expect(result.failedRule).toBe('RESOURCE_ALLOWED');
    }
  });

  describe('per-payment ceiling: amount off by one base unit', () => {
    it('50,000,000 is within the ceiling; 50,000,001 is denied', async () => {
      const at = await gate({ amount: '50000000' });
      expect(statusOf(at, 'MAX_PER_PAYMENT')).toBe('PASS');
      expect(at.decision).toBe('ESCALATE'); // above the $1 approval threshold, still inside the hard ceiling

      const over = await gate({ amount: '50000001' });
      expect(statusOf(over, 'MAX_PER_PAYMENT')).toBe('FAIL');
      expect(over.decision).toBe('DENY');
    });
  });

  describe('lifetime cap: off by one', () => {
    it('spend + amount == cap passes; one more base unit fails', async () => {
      const ok = await gate({ amount: '10000' }, { spend: { windowAutonomousBaseUnits: '0', totalBaseUnits: '99990000' } });
      expect(statusOf(ok, 'MAX_TOTAL')).toBe('PASS');
      const over = await gate({ amount: '10001' }, { spend: { windowAutonomousBaseUnits: '0', totalBaseUnits: '99990000' } });
      expect(statusOf(over, 'MAX_TOTAL')).toBe('FAIL');
      expect(over.decision).toBe('DENY');
    });
  });

  it('the lifetime cap counts approved spend too, so a human cannot approve past it', async () => {
    const offer = testOffer({ amount: '2000000', resourceUrl: `${TEST_ORIGIN}/inference/heavy` });
    const result = evaluateGate(
      await signedTestMandate(),
      offer,
      testContext({
        spend: { windowAutonomousBaseUnits: '0', totalBaseUnits: '99000000' },
        approval: testApproval(offer),
      }),
    );
    expect(result.decision).toBe('DENY');
    expect(result.failedRules).toContain('MAX_TOTAL');
  });
});

describe('evaluateGate — mandate validity', () => {
  it('expiry boundary: allowed one second before expiresAt, denied at expiresAt', async () => {
    const mandate = await signedTestMandate();
    const before = evaluateGate(mandate, testOffer(), testContext({ now: mandate.expiresAt - 1 }));
    expect(before.decision).toBe('ALLOW');
    const at = evaluateGate(mandate, testOffer(), testContext({ now: mandate.expiresAt }));
    expect(at.decision).toBe('DENY');
    expect(at.failedRule).toBe('MANDATE_VALIDITY');
  });

  it('not yet valid before notBefore', async () => {
    const mandate = await signedTestMandate();
    const early = evaluateGate(mandate, testOffer(), testContext({ now: mandate.notBefore - 1 }));
    expect(early.failedRule).toBe('MANDATE_VALIDITY');
    const exact = evaluateGate(mandate, testOffer(), testContext({ now: mandate.notBefore }));
    expect(exact.decision).toBe('ALLOW');
  });

  it('revocation is effective immediately and skips the scope rules', async () => {
    const result = await gate({}, { revoked: { revokedAt: NOW, reason: 'operator revoked' } });
    expect(result.decision).toBe('DENY');
    expect(result.failedRule).toBe('MANDATE_NOT_REVOKED');
    expect(statusOf(result, 'PAYTO_ALLOWED')).toBe('SKIPPED');
    expect(statusOf(result, 'MAX_PER_PAYMENT')).toBe('SKIPPED');
  });

  it('denies a mandate whose scope was widened after signing', async () => {
    const mandate = await signedTestMandate();
    const tampered = JSON.parse(JSON.stringify(mandate)) as AgentMandate;
    tampered.scope.allowedPayTo.push(signers.attacker.publicKey);
    const result = evaluateGate(tampered, testOffer({ payTo: signers.attacker.publicKey }), testContext());
    expect(result.decision).toBe('DENY');
    expect(result.failedRule).toBe('MANDATE_SIGNATURES');
    expect(statusOf(result, 'PAYTO_ALLOWED')).toBe('SKIPPED');
  });

  it('denies a mandate with a reordered delegation chain', async () => {
    const mandate = await signedTestMandate({ requiredApprovals: 2 });
    const reordered = JSON.parse(JSON.stringify(mandate)) as AgentMandate;
    [reordered.delegationChain[1], reordered.delegationChain[2]] = [reordered.delegationChain[2], reordered.delegationChain[1]];
    const result = evaluateGate(reordered, testOffer(), testContext());
    expect(result.failedRule).toBe('MANDATE_SIGNATURES');
  });

  it('denies garbage mandates and offers without throwing', async () => {
    for (const junk of [null, {}, 'x', 42]) {
      const result = evaluateGate(junk, testOffer(), testContext());
      expect(result.decision).toBe('DENY');
    }
    const badOffers = [null, {}, testOffer({ amount: '0' }), { ...testOffer(), amount: '-5' }, { ...testOffer(), amount: '1.5' }, { ...testOffer(), scheme: 'upto' }];
    for (const offer of badOffers) {
      const result = evaluateGate(await signedTestMandate(), offer, testContext());
      expect(result.decision).toBe('DENY');
      expect(result.failedRule).toBe('OFFER_WELL_FORMED');
    }
  });
});

describe('evaluateGate — approvable rules escalate', () => {
  it('escalates an amount above the threshold and names the rule', async () => {
    const result = await gate({ amount: '1000001' });
    expect(result.decision).toBe('ESCALATE');
    expect(result.failedRule).toBe('ESCALATION_THRESHOLD');
    expect(result.requiredApproverRoles).toEqual(['OWNER', 'ADMIN', 'APPROVER']);
  });

  it('threshold boundary: exactly the threshold is allowed', async () => {
    const result = await gate({ amount: '1000000' });
    expect(result.decision).toBe('ALLOW');
  });

  it('escalates the $40 inference purchase (resource + window + threshold) instead of denying it', async () => {
    const result = await gate({ amount: '40000000', resourceUrl: `${TEST_ORIGIN}/inference/heavy` });
    expect(result.decision).toBe('ESCALATE');
    expect(result.escalationRules).toEqual(['RESOURCE_ALLOWED', 'WINDOW_BUDGET', 'ESCALATION_THRESHOLD']);
    expect(result.failedRules).toEqual([]);
  });

  describe('rolling window rollover', () => {
    it('is exactly at budget when spend + amount == maxPerWindow, over by one base unit escalates', async () => {
      const mandate = await signedTestMandate({ threshold: '50000000' });
      const at = evaluateGate(mandate, testOffer({ amount: '1000000' }), testContext({ spend: { windowAutonomousBaseUnits: '4000000', totalBaseUnits: '4000000' } }));
      expect(statusOf(at, 'WINDOW_BUDGET')).toBe('PASS');
      expect(at.decision).toBe('ALLOW');
      const over = evaluateGate(mandate, testOffer({ amount: '1000001' }), testContext({ spend: { windowAutonomousBaseUnits: '4000000', totalBaseUnits: '4000000' } }));
      expect(statusOf(over, 'WINDOW_BUDGET')).toBe('ESCALATE');
      expect(over.decision).toBe('ESCALATE');
    });

    it('after the window rolls over the caller passes lower window spend and the same payment is allowed again', async () => {
      const mandate = await signedTestMandate({ threshold: '50000000' });
      const offer = testOffer({ amount: '1000000' });
      const full = evaluateGate(mandate, offer, testContext({ spend: { windowAutonomousBaseUnits: '5000000', totalBaseUnits: '5000000' } }));
      expect(full.decision).toBe('ESCALATE');
      const rolled = evaluateGate(mandate, offer, testContext({ spend: { windowAutonomousBaseUnits: '0', totalBaseUnits: '5000000' } }));
      expect(rolled.decision).toBe('ALLOW');
    });
  });

  it('a payTo violation is never overridden by approval', async () => {
    const offer = testOffer({ payTo: signers.attacker.publicKey, amount: '2000000' });
    const result = evaluateGate(await signedTestMandate(), offer, testContext({ approval: testApproval(offer) }));
    expect(result.decision).toBe('DENY');
    expect(result.failedRules).toContain('PAYTO_ALLOWED');
  });
});

describe('evaluateGate — human approval', () => {
  const inference = { amount: '40000000', resourceUrl: `${TEST_ORIGIN}/inference/heavy` };

  it('a valid approval for exactly this offer turns ESCALATE into ALLOW (kind APPROVED)', async () => {
    const offer = testOffer(inference);
    const result = evaluateGate(await signedTestMandate(), offer, testContext({ approval: testApproval(offer) }));
    expect(result.decision).toBe('ALLOW');
    expect(result.kind).toBe('APPROVED');
    expect(statusOf(result, 'RESOURCE_ALLOWED')).toBe('OVERRIDDEN');
    expect(statusOf(result, 'WINDOW_BUDGET')).toBe('OVERRIDDEN');
    expect(statusOf(result, 'ESCALATION_THRESHOLD')).toBe('OVERRIDDEN');
    expect(statusOf(result, 'ESCALATION_APPROVAL')).toBe('PASS');
  });

  it('an approval for a different offer is rejected (no confused deputy)', async () => {
    const approved = testOffer(inference);
    const other = testOffer({ ...inference, amount: '40000001' });
    const result = evaluateGate(await signedTestMandate(), other, testContext({ approval: testApproval(approved) }));
    expect(result.decision).toBe('DENY');
    expect(result.failedRule).toBe('ESCALATION_APPROVAL');
    expect(result.reason).toContain('different offer');
  });

  it('approval expiry boundary: valid one second before expiresAt, rejected at expiresAt', async () => {
    const offer = testOffer(inference);
    const mandate = await signedTestMandate();
    const before = evaluateGate(mandate, offer, testContext({ approval: testApproval(offer, { expiresAt: NOW + 1 }) }));
    expect(before.decision).toBe('ALLOW');
    const at = evaluateGate(mandate, offer, testContext({ approval: testApproval(offer, { expiresAt: NOW }) }));
    expect(at.decision).toBe('DENY');
    expect(at.reason).toContain('expired');
  });

  it('rejects approvals that are pending, denied, expired or already consumed', async () => {
    const offer = testOffer(inference);
    const mandate = await signedTestMandate();
    for (const status of ['PENDING', 'DENIED', 'EXPIRED', 'CONSUMED'] as const) {
      const result = evaluateGate(mandate, offer, testContext({ approval: testApproval(offer, { status }) }));
      expect(result.decision, status).toBe('DENY');
    }
  });

  it('rejects an approver whose role the mandate does not permit', async () => {
    const offer = testOffer(inference);
    const result = evaluateGate(
      await signedTestMandate(),
      offer,
      testContext({ approval: testApproval(offer, { approver: { userId: 'usr_dev', role: 'DEVELOPER' } }) }),
    );
    expect(result.decision).toBe('DENY');
    expect(result.reason).toContain('role');
  });
});

describe('evaluateGate — transaction simulation', () => {
  it('denies when simulation fails', async () => {
    const result = await gate({}, { simulation: testSimulation({ success: false, error: 'InsufficientFunds' }) });
    expect(result.decision).toBe('DENY');
    expect(result.failedRule).toBe('TRANSACTION_SIMULATION');
    expect(result.reason).toContain('InsufficientFunds');
  });

  it('denies unknown program ids, multiple transfers and transactions that do not pay the offer', async () => {
    const cases = [
      testSimulation({ unknownProgramIds: ['Evi1111111111111111111111111111111111111111'] }),
      testSimulation({ transferCount: 2 }),
      testSimulation({ transferCount: 0 }),
      testSimulation({ matchesOffer: false, mismatch: 'destination is not the payTo token account' }),
    ];
    for (const simulation of cases) {
      const result = await gate({}, { simulation });
      expect(result.decision).toBe('DENY');
      expect(result.failedRule).toBe('TRANSACTION_SIMULATION');
    }
  });

  it('denies a missing simulation when it is required, passes when it is not', async () => {
    const required = await gate({}, { simulation: null, requireSimulation: true });
    expect(required.failedRule).toBe('TRANSACTION_SIMULATION');
    const optional = await gate({}, { simulation: null, requireSimulation: false });
    expect(optional.decision).toBe('ALLOW');
  });

  it('is skipped (not run) when a scope rule already failed and no transaction was simulated', async () => {
    const result = await gate({ payTo: signers.attacker.publicKey }, { simulation: null });
    expect(statusOf(result, 'TRANSACTION_SIMULATION')).toBe('SKIPPED');
    expect(result.decision).toBe('DENY');
  });
});

describe('evaluateGate — context validation', () => {
  it('throws on malformed counters instead of silently mis-evaluating', async () => {
    const mandate = await signedTestMandate();
    for (const bad of ['-1', '1.5', '', 'abc', '0x10', ' 1']) {
      expect(() =>
        evaluateGate(mandate, testOffer(), testContext({ spend: { windowAutonomousBaseUnits: bad, totalBaseUnits: '0' } })),
      ).toThrow(TypeError);
    }
    expect(() => evaluateGate(mandate, testOffer(), testContext({ now: 1.5 }))).toThrow(TypeError);
  });
});

describe('evaluateGate — properties (money math)', () => {
  const u64 = fc.bigInt({ min: 1n, max: 1_000_000_000_000n });

  it('MAX_PER_PAYMENT passes iff amount <= ceiling, for any amounts (no float rounding anywhere)', async () => {
    const mandate = await signedTestMandate();
    const ceiling = 50_000_000n;
    await fc.assert(
      fc.asyncProperty(u64, async (amount) => {
        const result = evaluateGate(mandate, testOffer({ amount: amount.toString() }), testContext());
        expect(statusOf(result, 'MAX_PER_PAYMENT') === 'PASS').toBe(amount <= ceiling);
      }),
      { numRuns: 200 },
    );
  });

  it('MAX_TOTAL passes iff spent + amount <= cap', async () => {
    const mandate = await signedTestMandate();
    await fc.assert(
      fc.asyncProperty(fc.bigInt({ min: 0n, max: 200_000_000n }), fc.bigInt({ min: 1n, max: 50_000_000n }), async (spent, amount) => {
        const result = evaluateGate(
          mandate,
          testOffer({ amount: amount.toString() }),
          testContext({ spend: { windowAutonomousBaseUnits: '0', totalBaseUnits: spent.toString() } }),
        );
        expect(statusOf(result, 'MAX_TOTAL') === 'PASS').toBe(spent + amount <= 100_000_000n);
      }),
      { numRuns: 200 },
    );
  });

  it('WINDOW_BUDGET escalates iff windowSpend + amount > budget', async () => {
    const mandate = await signedTestMandate({ threshold: '50000000' });
    await fc.assert(
      fc.asyncProperty(fc.bigInt({ min: 0n, max: 10_000_000n }), fc.bigInt({ min: 1n, max: 10_000_000n }), async (spent, amount) => {
        const result = evaluateGate(
          mandate,
          testOffer({ amount: amount.toString() }),
          testContext({ spend: { windowAutonomousBaseUnits: spent.toString(), totalBaseUnits: spent.toString() } }),
        );
        expect(statusOf(result, 'WINDOW_BUDGET') === 'ESCALATE').toBe(spent + amount > 5_000_000n);
      }),
      { numRuns: 200 },
    );
  });

  it('a decision is ALLOW only when no rule failed or escalated', async () => {
    const mandate = await signedTestMandate();
    await fc.assert(
      fc.asyncProperty(u64, fc.boolean(), async (amount, badPayTo) => {
        const result = evaluateGate(
          mandate,
          testOffer({ amount: amount.toString(), payTo: badPayTo ? signers.attacker.publicKey : signers.merchant.publicKey }),
          testContext(),
        );
        const clean = result.rulesEvaluated.every((r) => r.status === 'PASS');
        expect(result.decision === 'ALLOW').toBe(clean);
      }),
      { numRuns: 150 },
    );
  });
});
