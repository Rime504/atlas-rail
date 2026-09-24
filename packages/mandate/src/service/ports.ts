import { GateAuthorization, SignedDecision } from '../decision';
import { GateSimulation } from '../gate';
import { X402Offer } from '../offer';
import { AgentMandate, DelegationRole } from '../schema';

/**
 * Ports for the agent-mandate services. The services are framework-free and storage-agnostic:
 * `InMemoryAgentStore` backs tests, the demo's hermetic mode and the offline verifier; the API
 * provides a Prisma implementation with the same semantics (append-only decisions, serialised
 * evaluation per mandate).
 */

export type MandateStatus = 'DRAFT' | 'ACTIVE' | 'REVOKED';

export interface MandateSignerRecord {
  role: DelegationRole;
  publicKey: string;
  /** Console user who signed, when the signature was produced through the console. */
  userId: string | null;
  signedAt: number;
}

export interface MandateRevocation {
  revokedAt: number;
  reason: string | null;
  revokedBy: string | null;
}

export interface MandateRecord {
  organizationId: string;
  mandate: AgentMandate;
  mandateHash: string;
  status: MandateStatus;
  createdBy: string | null;
  createdAt: number;
  signers: MandateSignerRecord[];
  revocation: MandateRevocation | null;
}

export interface MandateStore {
  get(organizationId: string, mandateId: string): Promise<MandateRecord | null>;
  list(organizationId: string): Promise<MandateRecord[]>;
  /** True if another mandate of this organisation already used this nonce. */
  nonceExists(organizationId: string, nonce: string, exceptMandateId: string): Promise<boolean>;
  insert(record: MandateRecord): Promise<void>;
  update(record: MandateRecord): Promise<void>;
}

export interface StoredDecision {
  organizationId: string;
  signed: SignedDecision;
  /** Hash of the agent's signed request, for idempotency. Null for decisions not made through the gate. */
  requestHash: string | null;
  authorization: GateAuthorization | null;
  approvalId: string | null;
  createdAt: number;
}

export interface DecisionStore {
  get(organizationId: string, decisionId: string): Promise<StoredDecision | null>;
  findByRequest(organizationId: string, mandateId: string, nonce: string): Promise<StoredDecision | null>;
  /** Append-only. There is deliberately no update or delete. */
  insert(decision: StoredDecision): Promise<void>;
  /** `afterCreatedAt` is inclusive (>=); callers dedupe by decision id. Newest first. */
  list(organizationId: string, options: { limit: number; mandateId?: string; afterCreatedAt?: number }): Promise<StoredDecision[]>;
}

export type SpendStatus = 'RESERVED' | 'SETTLED' | 'RELEASED';

export interface SpendEntry {
  id: string;
  organizationId: string;
  mandateId: string;
  decisionId: string;
  amountBaseUnits: string;
  autonomous: boolean;
  status: SpendStatus;
  txSignature: string | null;
  createdAt: number;
}

export interface SpendTotals {
  windowAutonomousBaseUnits: string;
  totalBaseUnits: string;
}

export interface SpendStore {
  /**
   * Sums SETTLED entries plus RESERVED entries younger than `reservationTtlSeconds`. Autonomous
   * entries created after `now - windowSeconds` count towards the window (strictly after: an entry
   * exactly `windowSeconds` old has rolled out).
   */
  totals(
    mandateId: string,
    now: number,
    windowSeconds: number,
    reservationTtlSeconds: number,
  ): Promise<SpendTotals>;
  reserve(entry: SpendEntry): Promise<void>;
  markSettled(decisionId: string, txSignature: string): Promise<void>;
  release(decisionId: string): Promise<void>;
}

export type ApprovalState = 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED' | 'CONSUMED';

export interface ApprovalRecord {
  id: string;
  organizationId: string;
  mandateId: string;
  decisionId: string;
  offerHash: string;
  offer: X402Offer;
  status: ApprovalState;
  requiredRoles: string[];
  requestedAt: number;
  expiresAt: number;
  decidedAt: number | null;
  decidedBy: { userId: string; role: string } | null;
  comment: string | null;
  /** Reason(s) the gate escalated, for the human reviewing it. */
  escalationRules: string[];
}

export interface ApprovalStore {
  create(approval: ApprovalRecord): Promise<void>;
  get(organizationId: string, approvalId: string): Promise<ApprovalRecord | null>;
  list(organizationId: string, options: { status?: ApprovalState; limit: number }): Promise<ApprovalRecord[]>;
  update(approval: ApprovalRecord): Promise<void>;
  /** Atomically moves APPROVED → CONSUMED. Returns false if it was not APPROVED (already used, expired...). */
  consume(organizationId: string, approvalId: string): Promise<boolean>;
}

export interface AuditEntry {
  organizationId: string;
  actorType: 'USER' | 'API_KEY' | 'SYSTEM' | 'AGENT';
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: Record<string, unknown>;
  createdAt: number;
}

export interface AuditSink {
  append(entry: AuditEntry): Promise<void>;
}

export interface AgentStore {
  mandates: MandateStore;
  decisions: DecisionStore;
  spend: SpendStore;
  approvals: ApprovalStore;
  audit: AuditSink;
  /** Runs `fn` while holding an exclusive lock on `key`, so evaluations for one mandate are serialised. */
  runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

/** Runs pre-flight checks on the exact transaction the agent intends to sign. */
export interface PaymentSimulator {
  simulate(input: { transactionBase64: string; offer: X402Offer; payer: string }): Promise<GateSimulation>;
}

export type AgentEventType =
  | 'agent.mandate.created'
  | 'agent.mandate.activated'
  | 'agent.mandate.revoked'
  | 'agent.decision.allow'
  | 'agent.decision.deny'
  | 'agent.decision.escalate'
  | 'agent.approval.requested'
  | 'agent.approval.decided'
  | 'agent.receipt.issued';

export interface AgentEvent {
  type: AgentEventType;
  organizationId: string;
  payload: Record<string, unknown>;
}

export type AgentEventSink = (event: AgentEvent) => Promise<void> | void;

export class AgentServiceError extends Error {
  constructor(
    public readonly code:
      | 'NOT_FOUND'
      | 'BAD_SIGNATURE'
      | 'AGENT_MISMATCH'
      | 'CLOCK_SKEW'
      | 'NONCE_REUSED'
      | 'INVALID_STATE'
      | 'FORBIDDEN'
      | 'INVALID_INPUT'
      | 'NONCE_REPLAY',
    message: string,
  ) {
    super(message);
    this.name = 'AgentServiceError';
  }
}
