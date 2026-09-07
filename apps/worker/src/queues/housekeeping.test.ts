import { describe, it, expect } from 'vitest';
import { isPayoutStuck, STUCK_EXECUTION_TIMEOUT_MS } from './housekeeping';

describe('isPayoutStuck', () => {
  const now = new Date('2026-01-01T00:30:00.000Z');

  it('flags an in-flight payout that has exceeded the timeout', () => {
    const updatedAt = new Date(now.getTime() - STUCK_EXECUTION_TIMEOUT_MS - 1000);
    expect(isPayoutStuck('SIMULATING', updatedAt, now)).toBe(true);
  });

  it('does not flag an in-flight payout still within the timeout', () => {
    const updatedAt = new Date(now.getTime() - 1000);
    expect(isPayoutStuck('QUEUED_FOR_EXECUTION', updatedAt, now)).toBe(false);
  });

  it('never flags terminal statuses regardless of age', () => {
    const veryOld = new Date(now.getTime() - STUCK_EXECUTION_TIMEOUT_MS * 100);
    expect(isPayoutStuck('CONFIRMED', veryOld, now)).toBe(false);
    expect(isPayoutStuck('FAILED', veryOld, now)).toBe(false);
    expect(isPayoutStuck('DRAFT', veryOld, now)).toBe(false);
  });

  it('respects a custom timeout', () => {
    const updatedAt = new Date(now.getTime() - 5000);
    expect(isPayoutStuck('SUBMITTED', updatedAt, now, 1000)).toBe(true);
    expect(isPayoutStuck('SUBMITTED', updatedAt, now, 10000)).toBe(false);
  });
});
