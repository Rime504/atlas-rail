export const STUCK_EXECUTION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

const STUCK_ELIGIBLE_STATUSES = ['QUEUED_FOR_EXECUTION', 'SIMULATING', 'SUBMITTED'] as const;

/**
 * A payout is considered stuck if it has sat in an in-flight execution status for longer than
 * the timeout without progressing — most likely a worker crash mid-job. Pure function so the
 * threshold logic can be unit tested without a database.
 */
export function isPayoutStuck(
  status: string,
  updatedAt: Date,
  now: Date,
  timeoutMs: number = STUCK_EXECUTION_TIMEOUT_MS,
): boolean {
  if (!(STUCK_ELIGIBLE_STATUSES as readonly string[]).includes(status)) return false;
  return now.getTime() - updatedAt.getTime() > timeoutMs;
}

export const STUCK_PAYOUT_STATUSES = STUCK_ELIGIBLE_STATUSES;
