import { describe, expect, it } from 'vitest';
import { checkBehaviour, type PastPayment } from './behaviour';

const seller = 'Seller1111111111111111111111111111111111111';
const usual = (count: number, amount = 10_000n, start = 1_000): PastPayment[] =>
  Array.from({ length: count }, (_, i) => ({ amount, recipient: seller, at: start + i * 120 }));

describe('behaviour check', () => {
  it('passes a usual payment to a known recipient', () => {
    expect(checkBehaviour(usual(5), { amount: 12_000n, recipient: seller, at: 5_000 })).toEqual([]);
  });

  it('flags a payment far above the usual one, and says how far in one sentence', () => {
    const flags = checkBehaviour(usual(5), { amount: 56_000n, recipient: seller, at: 5_000 });
    expect(flags).toEqual([{ check: 'UNUSUAL_AMOUNT', reason: "5.6x higher than this agent's usual payment." }]);
    expect(checkBehaviour(usual(5), { amount: 50_000n, recipient: seller, at: 5_000 })).toEqual([]);
  });

  it('does not judge amounts until there is some history', () => {
    expect(checkBehaviour(usual(2), { amount: 500_000n, recipient: seller, at: 5_000 })).toEqual([]);
    expect(checkBehaviour([], { amount: 500_000n, recipient: 'Anyone', at: 5_000 })).toEqual([]);
  });

  it('flags the first payment to a new recipient', () => {
    expect(checkBehaviour(usual(1), { amount: 10_000n, recipient: 'Stranger', at: 5_000 })).toEqual([
      { check: 'NEW_RECIPIENT', reason: 'First payment from this agent to this recipient.' },
    ]);
  });

  it('flags a sudden burst of payments', () => {
    const burst = Array.from({ length: 9 }, (_, i) => ({ amount: 10_000n, recipient: seller, at: 5_000 + i }));
    expect(checkBehaviour(burst, { amount: 10_000n, recipient: seller, at: 5_010 })).toEqual([
      { check: 'BURST', reason: '10 payments in the last 60 seconds, more than usual.' },
    ]);
  });
});
