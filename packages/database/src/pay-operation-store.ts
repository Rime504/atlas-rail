import type { PrismaClient } from '@prisma/client';

/**
 * One pay.sh spending-authority operation: `(caller_id, operation_id)` bound for good to the exact
 * request and offer it was first asked about, with the signed answer Atlas Rail gave.
 */
export interface PayOperationRecord {
  /** `JSON.stringify([caller_id, operation_id])`. */
  key: string;
  callerId: string;
  operationId: string;
  /** SHA-256 over the request fingerprint, offer hash, amount, asset, recipient and network. */
  bindingHash: string;
  mandateHash: string;
  /** The attempt the stored answer was given to. */
  attemptId: string;
  /** `allow`, `deny`, or `reject_before_execution` (waiting for the owner, nothing reserved). */
  decision: 'allow' | 'deny' | 'reject_before_execution';
  /** The signed answer JSON, returned as-is when the same attempt asks again. */
  answer: string;
  /** Set while the owner has been asked. */
  approvalId: string | null;
  /** Epoch seconds. */
  createdAt: number;
  updatedAt: number;
}

export class InMemoryPayOperationStore {
  private readonly rows = new Map<string, PayOperationRecord>();

  async get(key: string): Promise<PayOperationRecord | null> {
    const row = this.rows.get(key);
    return row ? { ...row } : null;
  }

  /** Creates the row, or replaces it only when it is still `reject_before_execution`. */
  async save(record: PayOperationRecord): Promise<void> {
    const existing = this.rows.get(record.key);
    if (existing && existing.decision !== 'reject_before_execution') throw new Error('Operation already decided');
    this.rows.set(record.key, { ...record });
  }

  async list(): Promise<PayOperationRecord[]> {
    return [...this.rows.values()].map((r) => ({ ...r })).sort((a, b) => b.createdAt - a.createdAt);
  }
}

const toDate = (seconds: number) => new Date(seconds * 1000);
const toSeconds = (date: Date) => Math.floor(date.getTime() / 1000);

export class PrismaPayOperationStore {
  constructor(private readonly db: PrismaClient) {}

  async get(key: string): Promise<PayOperationRecord | null> {
    const row = await this.db.payOperation.findUnique({ where: { key } });
    if (!row) return null;
    return { ...row, decision: row.decision as PayOperationRecord['decision'], createdAt: toSeconds(row.createdAt), updatedAt: toSeconds(row.updatedAt) };
  }

  async save(record: PayOperationRecord): Promise<void> {
    const data = { ...record, createdAt: toDate(record.createdAt), updatedAt: toDate(record.updatedAt) };
    const existing = await this.db.payOperation.findUnique({ where: { key: record.key } });
    if (!existing) {
      await this.db.payOperation.create({ data });
      return;
    }
    const updated = await this.db.payOperation.updateMany({ where: { key: record.key, decision: 'reject_before_execution' }, data });
    if (updated.count !== 1) throw new Error('Operation already decided');
  }

  async list(): Promise<PayOperationRecord[]> {
    const rows = await this.db.payOperation.findMany({ orderBy: { createdAt: 'desc' }, take: 500 });
    return rows.map((row) => ({ ...row, decision: row.decision as PayOperationRecord['decision'], createdAt: toSeconds(row.createdAt), updatedAt: toSeconds(row.updatedAt) }));
  }
}

export type PayOperationStore = Pick<InMemoryPayOperationStore, 'get' | 'save' | 'list'>;
