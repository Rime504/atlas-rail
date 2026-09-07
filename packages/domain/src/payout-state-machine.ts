export type PayoutStatusType =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'QUEUED_FOR_EXECUTION'
  | 'SIMULATING'
  | 'SIMULATION_FAILED'
  | 'READY_TO_SIGN'
  | 'SUBMITTED'
  | 'CONFIRMED'
  | 'FAILED'
  | 'CANCELLED'
  | 'BLOCKED';

export const TERMINAL_PAYOUT_STATUSES: PayoutStatusType[] = ['CONFIRMED', 'REJECTED', 'CANCELLED'];

export const VALID_STATUS_TRANSITIONS: Record<PayoutStatusType, PayoutStatusType[]> = {
  DRAFT: ['PENDING_APPROVAL', 'CANCELLED'],
  PENDING_APPROVAL: ['APPROVED', 'REJECTED', 'BLOCKED', 'CANCELLED'],
  APPROVED: ['QUEUED_FOR_EXECUTION', 'CANCELLED'],
  REJECTED: [],
  QUEUED_FOR_EXECUTION: ['SIMULATING'],
  SIMULATING: ['SIMULATION_FAILED', 'READY_TO_SIGN'],
  SIMULATION_FAILED: ['BLOCKED', 'CANCELLED'],
  READY_TO_SIGN: ['SUBMITTED', 'BLOCKED'],
  SUBMITTED: ['CONFIRMED', 'FAILED'],
  FAILED: ['QUEUED_FOR_EXECUTION'], // Retryable failures only
  CANCELLED: [],
  BLOCKED: ['CANCELLED'],
  CONFIRMED: [],
};

export function canTransitionPayoutStatus(from: PayoutStatusType, to: PayoutStatusType): boolean {
  if (from === to) return true;
  const allowed = VALID_STATUS_TRANSITIONS[from] || [];
  return allowed.includes(to);
}

export function assertValidTransition(from: PayoutStatusType, to: PayoutStatusType): void {
  if (!canTransitionPayoutStatus(from, to)) {
    throw new Error(`Invalid payout status transition from ${from} to ${to}`);
  }
}

export function isTerminalPayoutStatus(status: PayoutStatusType): boolean {
  return TERMINAL_PAYOUT_STATUSES.includes(status);
}
