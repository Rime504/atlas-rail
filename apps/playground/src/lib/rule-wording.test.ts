import { describe, expect, it } from 'vitest';
import { formatUsd } from './format';
import { mandateCardTiles } from './mandate-card';
import {
  attack,
  humanDecision,
  initWorld,
  payAfterRevoke,
  payNormal,
  priceSpikeModerate,
  priceSpikeSevere,
  revokeMandate,
  signMandateStep,
  tryToBreak,
} from './scenario';
import type { PaymentOutcome, RuleDisplay } from './types';

const MONEY_FIELDS = ['amount', 'maxPerPayment', 'maxPerWindow', 'maxTotal', 'spentInWindow', 'spentTotal', 'projected', 'threshold', 'expectedPrice', 'toleratedCeiling', 'hardMax'];
/** A standalone run of 5+ digits: how a base-unit amount ("20000", "500000000") would show up. */
const RAW_UNITS = /(?<![\w.$])\d{5,}(?![\w.])/;

async function walkthrough() {
  let world = await signMandateStep(initWorld('instant', null).world);
  const outcomes: Record<string, PaymentOutcome> = {};
  for (const [name, step] of [
    ['normal', payNormal],
    ['attack', attack],
    ['moderate', priceSpikeModerate],
    ['severe', priceSpikeSevere],
  ] as const) {
    const r = await step(world);
    world = r.world;
    outcomes[name] = r.outcome;
  }
  const approved = await humanDecision(world, true);
  outcomes.approved = approved.outcome;
  outcomes.afterRevoke = (await payAfterRevoke(revokeMandate(approved.world, 'test'))).outcome;
  return outcomes;
}

const row = (outcome: PaymentOutcome, id: string): RuleDisplay => {
  const found = outcome.rules.find((r) => r.id === id);
  if (!found) throw new Error(`no ${id} row`);
  return found;
};

describe('playground rule wording', () => {
  it('step 6: a human-approved price is shown as approved, never as "no human can override this"', async () => {
    const { approved } = await walkthrough();
    expect(approved.gate.decision).toBe('ALLOW');
    const price = row(approved, 'PRICE_LIMIT');
    // The gate's result is right (OVERRIDDEN); only the wording was wrong.
    expect(price.raw.status).toBe('OVERRIDDEN');
    expect(price.verdict).toBe('overridden');
    expect(price.label).toBe('Price was higher than expected — a human approved it');
    expect(price.detail).toBe('$0.02 is above the tolerated $0.015 but at or below the hard maximum $0.03 — a human approved it');
    expect(price.detail).not.toMatch(/no human can override/);
  });

  it('step 5: the tolerance reads $0.015, not a rounded $0.02', async () => {
    const { moderate } = await walkthrough();
    expect(formatUsd('15000')).toBe('$0.015');
    expect(row(moderate, 'PRICE_LIMIT').detail).toBe('$0.02 is above the tolerated $0.015 but at or below the hard maximum $0.03 — a human can approve it');
  });

  it('step 4: the approval-threshold row is in dollars', async () => {
    const { attack: blocked } = await walkthrough();
    const threshold = row(blocked, 'ESCALATION_THRESHOLD');
    expect(threshold.label).toBe('Amount is above the human-approval threshold — needs a human');
    expect(threshold.detail).toBe('$500.00 is above the $5.00 approval threshold');
  });

  it('no row anywhere shows raw base units: walkthrough and every /break attack', async () => {
    const outcomes = Object.values(await walkthrough());
    for (const attackName of ['pay-stranger', 'overcharge', 'split', 'after-revoke'] as const) {
      outcomes.push(...(await tryToBreak(attackName)).attempts.map((a) => a.outcome));
    }
    for (const outcome of outcomes) {
      expect(outcome.headline).not.toMatch(RAW_UNITS);
      for (const rule of outcome.rules) {
        expect(rule.label, `${rule.id} label`).not.toMatch(RAW_UNITS);
        expect(rule.detail, `${rule.id} detail`).not.toMatch(RAW_UNITS);
        for (const field of MONEY_FIELDS) {
          if (field in rule.values) expect(String(rule.values[field]), `${rule.id}.${field}`).toMatch(/^\$\d[\d,]*\.\d{2,6}$/);
        }
      }
    }
  });

  it('step 8: the revocation time is a readable UTC time, not epoch seconds', async () => {
    const { afterRevoke } = await walkthrough();
    expect(row(afterRevoke, 'MANDATE_NOT_REVOKED').detail).toMatch(/^The owner revoked this mandate at \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);
  });

  it('step 2: the mandate card shows the $100.00 lifetime total', () => {
    expect(mandateCardTiles()).toContainEqual({ label: 'Lifetime total', value: '$100.00' });
    expect(mandateCardTiles().map((t) => t.label)).toEqual(['Max per payment', 'Max per hour', 'Lifetime total', 'Allowed sellers', 'Research call price']);
  });
});
