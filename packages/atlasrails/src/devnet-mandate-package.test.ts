import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVIDENCE_CHANNEL, FORBIDDEN_CHANNEL, LIMITS, assertSafeChannel, graceSecondsForOpen, graceZeroRejected } from '../../../scripts/devnet-mandate-package.mjs';

describe('mandate package devnet runner', () => {
  it('refuses the recovery channel and the saved evidence channel', () => {
    expect(() => assertSafeChannel(FORBIDDEN_CHANNEL)).toThrow(/Recovery/);
    expect(() => assertSafeChannel(EVIDENCE_CHANNEL)).toThrow(/evidence/);
    expect(() => assertSafeChannel('11111111111111111111111111111111')).not.toThrow();
  });

  it('compares payments above, below, and equal to the per-payment cap', () => {
    expect(LIMITS.above > LIMITS.maxPerPayment).toBe(true);
    expect(LIMITS.below < LIMITS.maxPerPayment).toBe(true);
    expect(LIMITS.same).toBe(LIMITS.maxPerPayment);
    expect(LIMITS.deposit > LIMITS.same).toBe(true);
  });

  it('does not broadcast unless --execute is passed', () => {
    const source = readFileSync(join(process.cwd(), 'scripts/devnet-mandate-package.mjs'), 'utf8');
    expect(source).toContain("!process.argv.includes('--execute')");
    expect(source).toContain('Refusing to broadcast');
  });

  it('keeps a requested grace and turns a rejected zero into one second', () => {
    expect(graceSecondsForOpen(3600, true)).toBe(3600);
    expect(graceSecondsForOpen(0, false)).toBe(0);
    expect(graceSecondsForOpen(0, true)).toBe(1);
    expect(graceZeroRejected({ err: { InstructionError: [2, { Custom: 201 }] }, logs: [] })).toBe(true);
    expect(graceZeroRejected({ err: null, logs: ['Grace period must be non-zero'] })).toBe(true);
    expect(graceZeroRejected({ err: null, logs: [] })).toBe(false);
    const clientRun = readFileSync(join(process.cwd(), 'scripts/devnet-client-open-refund.mjs'), 'utf8');
    expect(clientRun).toContain('atlas.openChannel');
    expect(clientRun).toContain('atlas.refundRemainder');
    expect(clientRun).toContain("!process.argv.includes('--execute')");
    const runner = readFileSync(join(process.cwd(), 'scripts/devnet-mandate-grace0.mjs'), 'utf8');
    expect(runner).toContain('graceSeconds: 0');
    expect(runner).toContain("!process.argv.includes('--execute')");
  });
});
