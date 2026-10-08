import { describe, expect, it } from 'vitest';
import { CASES } from './cases';
import { runCase } from './harness';
import { memoryRig } from './memory-rig';

const REPETITIONS = 3;

describe('red team: a fully compromised agent, every case, in-memory cluster', () => {
  it('has at least 40 distinct cases', () => {
    expect(new Set(CASES.map((c) => c.id)).size).toBeGreaterThanOrEqual(40);
  });

  for (const c of CASES) {
    it(`${c.id} ${c.title}: nothing leaves the wallet outside the mandate`, async () => {
      for (let rep = 1; rep <= REPETITIONS; rep++) {
        const outcome = await runCase(c, await memoryRig(c.world ?? {}), rep);
        expect(outcome.problems).toEqual([]);
        expect(outcome.outsideMandateBaseUnits).toBe(0n);
      }
    }, 120_000);
  }
});

describe('red team harness', () => {
  it('canary: really does catch money leaving the wallet (a payment the case did not authorize counts as outside the mandate)', async () => {
    const { attempt } = await import('./harness');
    const leaky = { id: 'CANARY', category: 'canary', title: 'canary', expected: '', stoppedBy: ['GATE' as const], run: async (ctx: Parameters<typeof CASES[number]['run']>[0]) => [await attempt(ctx.rig, { offer: ctx.rig.offer({ amount: '10000' }) })] };
    const outcome = await runCase(leaky, await memoryRig(), 1);
    expect(outcome.outsideMandateBaseUnits).toBe(10000n);
    expect(outcome.pass).toBe(false);
  });
});
