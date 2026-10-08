import { describe, expect, it } from 'vitest';
import { EXPECTED_PRICE, MODERATE_SPIKE_AMOUNT, PRICE_HARD_MAX, PRICE_TOLERANCE_PCT, SEVERE_SPIKE_AMOUNT } from './amounts';

/** Rule 15 boundary (step 5): the copy, the mandate's price limit and the gate's actual arithmetic
 * must agree. If these relationships ever drift (someone edits one constant but not the others),
 * step 5's "moderate" demo would silently stop escalating, or "severe" would stop being an
 * unconditional denial — this test is the tripwire for that. */
describe('rule 15 demo amounts', () => {
  const toleratedCeiling = (BigInt(EXPECTED_PRICE) * BigInt(100 + PRICE_TOLERANCE_PCT)) / 100n;

  it('the moderate spike is above tolerance but at or below the hard maximum (escalates)', () => {
    expect(BigInt(MODERATE_SPIKE_AMOUNT)).toBeGreaterThan(toleratedCeiling);
    expect(BigInt(MODERATE_SPIKE_AMOUNT)).toBeLessThanOrEqual(BigInt(PRICE_HARD_MAX));
  });

  it('the severe spike is clearly above the hard maximum (denies unconditionally, no human can override it)', () => {
    expect(BigInt(SEVERE_SPIKE_AMOUNT)).toBeGreaterThan(BigInt(PRICE_HARD_MAX));
  });

  it('the severe spike is exactly 5x the expected price, matching the playground copy ("A 5x spike")', () => {
    expect(BigInt(SEVERE_SPIKE_AMOUNT)).toBe(BigInt(EXPECTED_PRICE) * 5n);
  });
});
