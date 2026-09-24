import { addBaseUnits } from '@atlas-rail/domain';
import {
  AgentStore,
  ApprovalRecord,
  ApprovalState,
  ApprovalStore,
  AuditEntry,
  AuditSink,
  DecisionStore,
  MandateRecord,
  MandateStore,
  SpendEntry,
  SpendStore,
  SpendTotals,
  StoredDecision,
} from './ports';

/** In-memory {@link AgentStore}: same semantics as the Postgres implementation, for tests and hermetic demos. */
export class InMemoryAgentStore implements AgentStore {
  readonly mandates = new InMemoryMandateStore();
  readonly decisions = new InMemoryDecisionStore();
  readonly spend = new InMemorySpendStore();
  readonly approvals = new InMemoryApprovalStore();
  readonly audit = new InMemoryAuditSink();
  private readonly locks = new Map<string, Promise<unknown>>();

  async runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const chained = previous.then(() => gate);
    this.locks.set(key, chained);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === chained) this.locks.delete(key);
    }
  }
}

const clone = <T>(value: T): T => structuredClone(value);

class InMemoryMandateStore implements MandateStore {
  private readonly records = new Map<string, MandateRecord>();
  private key = (organizationId: string, id: string) => `${organizationId}/${id}`;

  async get(organizationId: string, mandateId: string) {
    const record = this.records.get(this.key(organizationId, mandateId));
    return record ? clone(record) : null;
  }
  async list(organizationId: string) {
    return [...this.records.values()].filter((r) => r.organizationId === organizationId).map(clone);
  }
  async nonceExists(organizationId: string, nonce: string, exceptMandateId: string) {
    return [...this.records.values()].some(
      (r) => r.organizationId === organizationId && r.mandate.nonce === nonce && r.mandate.id !== exceptMandateId,
    );
  }
  async insert(record: MandateRecord) {
    const key = this.key(record.organizationId, record.mandate.id);
    if (this.records.has(key)) throw new Error('duplicate mandate id');
    this.records.set(key, clone(record));
  }
  async update(record: MandateRecord) {
    this.records.set(this.key(record.organizationId, record.mandate.id), clone(record));
  }
}

class InMemoryDecisionStore implements DecisionStore {
  private readonly rows: StoredDecision[] = [];

  async get(organizationId: string, decisionId: string) {
    const row = this.rows.find((r) => r.organizationId === organizationId && r.signed.record.id === decisionId);
    return row ? clone(row) : null;
  }
  async findByRequest(organizationId: string, mandateId: string, nonce: string) {
    const row = this.rows.find(
      (r) =>
        r.organizationId === organizationId &&
        r.signed.record.mandateId === mandateId &&
        r.signed.record.request?.nonce === nonce,
    );
    return row ? clone(row) : null;
  }
  async insert(decision: StoredDecision) {
    if (this.rows.some((r) => r.signed.record.id === decision.signed.record.id)) throw new Error('duplicate decision id');
    this.rows.push(clone(decision));
  }
  async list(organizationId: string, options: { limit: number; mandateId?: string; afterCreatedAt?: number }) {
    return this.rows
      .filter(
        (r) =>
          r.organizationId === organizationId &&
          (options.mandateId === undefined || r.signed.record.mandateId === options.mandateId) &&
          (options.afterCreatedAt === undefined || r.createdAt > options.afterCreatedAt),
      )
      .slice(-options.limit)
      .reverse()
      .map(clone);
  }
}

class InMemorySpendStore implements SpendStore {
  private readonly entries: SpendEntry[] = [];

  async totals(mandateId: string, now: number, windowSeconds: number, reservationTtlSeconds: number): Promise<SpendTotals> {
    let windowAutonomous = '0';
    let total = '0';
    for (const entry of this.entries) {
      if (entry.mandateId !== mandateId || entry.status === 'RELEASED') continue;
      if (entry.status === 'RESERVED' && entry.createdAt <= now - reservationTtlSeconds) continue;
      total = addBaseUnits(total, entry.amountBaseUnits);
      if (entry.autonomous && entry.createdAt > now - windowSeconds) {
        windowAutonomous = addBaseUnits(windowAutonomous, entry.amountBaseUnits);
      }
    }
    return { windowAutonomousBaseUnits: windowAutonomous, totalBaseUnits: total };
  }
  async reserve(entry: SpendEntry) {
    this.entries.push(clone(entry));
  }
  async markSettled(decisionId: string, txSignature: string) {
    const entry = this.entries.find((e) => e.decisionId === decisionId);
    if (entry) {
      entry.status = 'SETTLED';
      entry.txSignature = txSignature;
    }
  }
  async release(decisionId: string) {
    const entry = this.entries.find((e) => e.decisionId === decisionId);
    if (entry && entry.status === 'RESERVED') entry.status = 'RELEASED';
  }
}

class InMemoryApprovalStore implements ApprovalStore {
  private readonly rows = new Map<string, ApprovalRecord>();

  async create(approval: ApprovalRecord) {
    this.rows.set(approval.id, clone(approval));
  }
  async get(organizationId: string, approvalId: string) {
    const row = this.rows.get(approvalId);
    return row && row.organizationId === organizationId ? clone(row) : null;
  }
  async list(organizationId: string, options: { status?: ApprovalState; limit: number }) {
    return [...this.rows.values()]
      .filter((r) => r.organizationId === organizationId && (!options.status || r.status === options.status))
      .sort((a, b) => b.requestedAt - a.requestedAt)
      .slice(0, options.limit)
      .map(clone);
  }
  async update(approval: ApprovalRecord) {
    this.rows.set(approval.id, clone(approval));
  }
  async consume(organizationId: string, approvalId: string) {
    const row = this.rows.get(approvalId);
    if (!row || row.organizationId !== organizationId || row.status !== 'APPROVED') return false;
    row.status = 'CONSUMED';
    return true;
  }
}

class InMemoryAuditSink implements AuditSink {
  readonly entries: AuditEntry[] = [];
  async append(entry: AuditEntry) {
    this.entries.push(clone(entry));
  }
}
