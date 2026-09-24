export const QUEUE_NAMES = {
  PAYOUT_EXECUTION: 'payout-execution',
  PAYOUT_CONFIRMATION: 'payout-confirmation',
  WEBHOOK_DELIVERY: 'webhook-delivery',
  RECONCILIATION_EXPORT: 'reconciliation-export',
  HOUSEKEEPING: 'housekeeping',
  AGENT_ANCHOR: 'agent-anchor',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export interface PayoutExecutionJobData {
  organizationId: string;
  payoutId: string;
  triggeredByUserId: string;
}

export interface PayoutConfirmationJobData {
  organizationId: string;
  payoutId: string;
  transactionSignature: string;
}

export interface WebhookDeliveryJobData {
  webhookDeliveryId: string;
}

export interface ReconciliationExportJobData {
  organizationId: string;
  requestedByUserId?: string;
}

export interface AgentAnchorJobData {
  reason?: string;
}

export interface HousekeepingJobData {
  reason?: string;
}

export const WEBHOOK_EVENT_TYPES = {
  PAYOUT_CREATED: 'payout.created',
  PAYOUT_APPROVED: 'payout.approved',
  PAYOUT_REJECTED: 'payout.rejected',
  PAYOUT_BLOCKED: 'payout.blocked',
  PAYOUT_SIMULATION_FAILED: 'payout.simulation_failed',
  PAYOUT_SUBMITTED: 'payout.submitted',
  PAYOUT_CONFIRMED: 'payout.confirmed',
  PAYOUT_FAILED: 'payout.failed',
  AGENT_MANDATE_CREATED: 'agent.mandate.created',
  AGENT_MANDATE_ACTIVATED: 'agent.mandate.activated',
  AGENT_MANDATE_REVOKED: 'agent.mandate.revoked',
  AGENT_DECISION_ALLOW: 'agent.decision.allow',
  AGENT_DECISION_DENY: 'agent.decision.deny',
  AGENT_DECISION_ESCALATE: 'agent.decision.escalate',
  AGENT_APPROVAL_REQUESTED: 'agent.approval.requested',
  AGENT_APPROVAL_DECIDED: 'agent.approval.decided',
  AGENT_RECEIPT_ISSUED: 'agent.receipt.issued',
} as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[keyof typeof WEBHOOK_EVENT_TYPES];

/**
 * Matches an event type against a webhook endpoint's subscribed pattern.
 * Supports exact matches and a trailing wildcard, e.g. "payout.*" matches "payout.confirmed".
 */
export function webhookEventMatchesPattern(eventType: string, pattern: string): boolean {
  if (pattern === '*' || pattern === eventType) return true;
  if (pattern.endsWith('.*')) {
    return eventType.startsWith(pattern.slice(0, -1));
  }
  return false;
}

export const WEBHOOK_DELIVERY_JOB_OPTIONS = {
  attempts: 6,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: 500,
  removeOnFail: 1000,
};

export const PAYOUT_EXECUTION_JOB_OPTIONS = {
  attempts: 1,
  removeOnComplete: 500,
  removeOnFail: 1000,
};

export const PAYOUT_CONFIRMATION_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 3000 },
  removeOnComplete: 500,
  removeOnFail: 1000,
};

export const RECONCILIATION_EXPORT_JOB_OPTIONS = {
  attempts: 3,
  removeOnComplete: 100,
  removeOnFail: 200,
};
