import { describe, it, expect } from 'vitest';
import { canTransitionPayoutStatus, assertValidTransition, isTerminalPayoutStatus } from './payout-state-machine';

describe('Payout State Machine', () => {
  it('allows valid state transitions', () => {
    expect(canTransitionPayoutStatus('DRAFT', 'PENDING_APPROVAL')).toBe(true);
    expect(canTransitionPayoutStatus('PENDING_APPROVAL', 'APPROVED')).toBe(true);
    expect(canTransitionPayoutStatus('APPROVED', 'QUEUED_FOR_EXECUTION')).toBe(true);
    expect(canTransitionPayoutStatus('QUEUED_FOR_EXECUTION', 'SIMULATING')).toBe(true);
    expect(canTransitionPayoutStatus('SIMULATING', 'READY_TO_SIGN')).toBe(true);
    expect(canTransitionPayoutStatus('READY_TO_SIGN', 'SUBMITTED')).toBe(true);
    expect(canTransitionPayoutStatus('SUBMITTED', 'CONFIRMED')).toBe(true);
  });

  it('rejects invalid or dangerous state transitions', () => {
    expect(canTransitionPayoutStatus('DRAFT', 'SUBMITTED')).toBe(false);
    expect(canTransitionPayoutStatus('CONFIRMED', 'QUEUED_FOR_EXECUTION')).toBe(false);
    expect(canTransitionPayoutStatus('REJECTED', 'APPROVED')).toBe(false);
    expect(() => assertValidTransition('CONFIRMED', 'READY_TO_SIGN')).toThrow();
  });

  it('correctly identifies terminal statuses', () => {
    expect(isTerminalPayoutStatus('CONFIRMED')).toBe(true);
    expect(isTerminalPayoutStatus('REJECTED')).toBe(true);
    expect(isTerminalPayoutStatus('CANCELLED')).toBe(true);
    expect(isTerminalPayoutStatus('SUBMITTED')).toBe(false);
  });
});
