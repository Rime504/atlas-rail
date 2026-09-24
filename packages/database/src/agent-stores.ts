import { Prisma, PrismaClient } from '@prisma/client';
import type {
  AgentMandate,
  AgentStore,
  ApprovalRecord,
  ApprovalState,
  ApprovalStore,
  AuditEntry,
  AuditSink,
  DecisionStore,
  GateAuthorization,
  MandateRecord,
  MandateSignerRecord,
  MandateStore,
  SignedDecision,
  SpendEntry,
  SpendStore,
  SpendTotals,
  StoredDecision,
  X402Offer,
} from '@atlas-rail/mandate';
import type {
  AnchorBatchRecord,
  AnchorProof,
  BoundReceipt,
  ReceiptStore,
  StoredReceipt,
} from '@atlas-rail/receipt';
import { generateUlid } from './ulid';

/**
 * Postgres implementations of the agent-mandate storage ports. Semantics match the in-memory
 * stores used in tests: decisions and receipts are append-only (the database enforces it with
 * triggers, see migration 20260924000000_agent_mandates), spend is reserved under a per-mandate
 * lock, and every timestamp crossing this boundary is epoch seconds.
 */

const toDate = (seconds: number) => new Date(seconds * 1000);
const toSeconds = (date: Date) => Math.floor(date.getTime() / 1000);
const json = (value: unknown) => value as Prisma.InputJsonValue;

type Db = PrismaClient;

/* ---------------------------------------------------------------------------------------------- */

class PrismaMandateStore implements MandateStore {
  constructor(private readonly db: Db) {}

  private toRecord(row: Prisma.AgentMandateGetPayload<Record<string, never>>): MandateRecord {
    return {
      organizationId: row.organizationId,
      mandate: row.document as unknown as AgentMandate,
      mandateHash: row.mandateHash,
      status: row.status,
      createdBy: row.createdByUserId,
      createdAt: toSeconds(row.createdAt),
      signers: row.signers as unknown as MandateSignerRecord[],
      revocation: row.revokedAt
        ? { revokedAt: toSeconds(row.revokedAt), reason: row.revokedReason, revokedBy: row.revokedByUserId }
        : null,
    };
  }

  async get(organizationId: string, mandateId: string) {
    const row = await this.db.agentMandate.findFirst({ where: { id: mandateId, organizationId } });
    return row ? this.toRecord(row) : null;
  }

  async list(organizationId: string) {
    const rows = await this.db.agentMandate.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } });
    return rows.map((row) => this.toRecord(row));
  }

  async nonceExists(organizationId: string, nonce: string, exceptMandateId: string) {
    const row = await this.db.agentMandate.findFirst({
      where: { organizationId, nonce, id: { not: exceptMandateId } },
      select: { id: true },
    });
    return row !== null;
  }

  async insert(record: MandateRecord) {
    const { mandate } = record;
    await this.db.agentMandate.create({
      data: {
        id: mandate.id,
        organizationId: record.organizationId,
        mandateHash: record.mandateHash,
        document: json(mandate),
        status: record.status,
        agentPublicKey: mandate.agent.publicKey,
        agentLabel: mandate.agent.label,
        nonce: mandate.nonce,
        notBefore: toDate(mandate.notBefore),
        expiresAt: toDate(mandate.expiresAt),
        signers: json(record.signers),
        createdByUserId: record.createdBy,
        createdAt: toDate(record.createdAt),
      },
    });
  }

  async update(record: MandateRecord) {
    await this.db.agentMandate.update({
      where: { id: record.mandate.id },
      data: {
        document: json(record.mandate),
        status: record.status,
        signers: json(record.signers),
        revokedAt: record.revocation ? toDate(record.revocation.revokedAt) : null,
        revokedReason: record.revocation?.reason ?? null,
        revokedByUserId: record.revocation?.revokedBy ?? null,
      },
    });
  }
}

/* ---------------------------------------------------------------------------------------------- */

class PrismaDecisionStore implements DecisionStore {
  constructor(private readonly db: Db) {}

  private toStored(row: Prisma.AgentDecisionGetPayload<Record<string, never>>): StoredDecision {
    return {
      organizationId: row.organizationId,
      signed: row.record as unknown as SignedDecision,
      requestHash: row.requestHash,
      authorization: row.authorization as unknown as GateAuthorization | null,
      approvalId: row.approvalId,
      createdAt: toSeconds(row.createdAt),
    };
  }

  async get(organizationId: string, decisionId: string) {
    const row = await this.db.agentDecision.findFirst({ where: { id: decisionId, organizationId } });
    return row ? this.toStored(row) : null;
  }

  async findByRequest(organizationId: string, mandateId: string, nonce: string) {
    const row = await this.db.agentDecision.findFirst({ where: { organizationId, mandateId, requestNonce: nonce } });
    return row ? this.toStored(row) : null;
  }

  async insert(decision: StoredDecision) {
    const { record, decisionHash } = decision.signed;
    await this.db.agentDecision.create({
      data: {
        id: record.id,
        organizationId: decision.organizationId,
        mandateId: record.mandateId,
        mandateHash: record.mandateHash,
        offerHash: record.offerHash,
        decision: record.decision,
        kind: record.kind,
        failedRule: record.failedRule,
        reason: record.reason,
        record: json(decision.signed),
        decisionHash,
        requestNonce: record.request?.nonce ?? null,
        requestHash: decision.requestHash,
        authorization: decision.authorization ? json(decision.authorization) : Prisma.DbNull,
        approvalId: decision.approvalId,
        amountBaseUnits: record.offer.amount,
        payTo: record.offer.payTo,
        resourceUrl: record.offer.resourceUrl,
        createdAt: toDate(decision.createdAt),
      },
    });
  }

  /** `afterCreatedAt` is inclusive (>=): callers dedupe by id, so same-second decisions are never missed. */
  async list(organizationId: string, options: { limit: number; mandateId?: string; afterCreatedAt?: number }) {
    const rows = await this.db.agentDecision.findMany({
      where: {
        organizationId,
        ...(options.mandateId ? { mandateId: options.mandateId } : {}),
        ...(options.afterCreatedAt !== undefined ? { createdAt: { gte: toDate(options.afterCreatedAt) } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: options.limit,
    });
    return rows.map((row) => this.toStored(row));
  }
}

/* ---------------------------------------------------------------------------------------------- */

class PrismaSpendStore implements SpendStore {
  constructor(private readonly db: Db) {}

  async totals(mandateId: string, now: number, windowSeconds: number, reservationTtlSeconds: number): Promise<SpendTotals> {
    const windowStart = toDate(now - windowSeconds);
    const reservationCutoff = toDate(now - reservationTtlSeconds);
    const rows = await this.db.$queryRaw<Array<{ window_autonomous: string; total: string }>>(Prisma.sql`
      SELECT
        COALESCE(SUM(CAST("amountBaseUnits" AS NUMERIC)) FILTER (WHERE "autonomous" AND "createdAt" > ${windowStart}), 0)::text AS window_autonomous,
        COALESCE(SUM(CAST("amountBaseUnits" AS NUMERIC)), 0)::text AS total
      FROM "AgentSpend"
      WHERE "mandateId" = ${mandateId}
        AND "status" <> 'RELEASED'
        AND NOT ("status" = 'RESERVED' AND "createdAt" <= ${reservationCutoff})
    `);
    const row = rows[0];
    return { windowAutonomousBaseUnits: row?.window_autonomous ?? '0', totalBaseUnits: row?.total ?? '0' };
  }

  async reserve(entry: SpendEntry) {
    await this.db.agentSpend.create({
      data: {
        id: entry.id,
        organizationId: entry.organizationId,
        mandateId: entry.mandateId,
        decisionId: entry.decisionId,
        amountBaseUnits: entry.amountBaseUnits,
        autonomous: entry.autonomous,
        status: entry.status,
        txSignature: entry.txSignature,
        createdAt: toDate(entry.createdAt),
      },
    });
  }

  async markSettled(decisionId: string, txSignature: string) {
    await this.db.agentSpend.updateMany({ where: { decisionId }, data: { status: 'SETTLED', txSignature } });
  }

  async release(decisionId: string) {
    await this.db.agentSpend.updateMany({ where: { decisionId, status: 'RESERVED' }, data: { status: 'RELEASED' } });
  }
}

/* ---------------------------------------------------------------------------------------------- */

class PrismaApprovalStore implements ApprovalStore {
  constructor(private readonly db: Db) {}

  private toRecord(row: Prisma.AgentApprovalGetPayload<Record<string, never>>): ApprovalRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      mandateId: row.mandateId,
      decisionId: row.decisionId,
      offerHash: row.offerHash,
      offer: row.offer as unknown as X402Offer,
      status: row.status as ApprovalState,
      requiredRoles: row.requiredRoles as unknown as string[],
      requestedAt: toSeconds(row.requestedAt),
      expiresAt: toSeconds(row.expiresAt),
      decidedAt: row.decidedAt ? toSeconds(row.decidedAt) : null,
      decidedBy: row.decidedByUserId && row.decidedByRole ? { userId: row.decidedByUserId, role: row.decidedByRole } : null,
      comment: row.comment,
      escalationRules: row.escalationRules as unknown as string[],
    };
  }

  async create(approval: ApprovalRecord) {
    await this.db.agentApproval.create({
      data: {
        id: approval.id,
        organizationId: approval.organizationId,
        mandateId: approval.mandateId,
        decisionId: approval.decisionId,
        offerHash: approval.offerHash,
        offer: json(approval.offer),
        status: approval.status,
        requiredRoles: json(approval.requiredRoles),
        escalationRules: json(approval.escalationRules),
        requestedAt: toDate(approval.requestedAt),
        expiresAt: toDate(approval.expiresAt),
      },
    });
  }

  async get(organizationId: string, approvalId: string) {
    const row = await this.db.agentApproval.findFirst({ where: { id: approvalId, organizationId } });
    return row ? this.toRecord(row) : null;
  }

  async list(organizationId: string, options: { status?: ApprovalState; limit: number }) {
    const rows = await this.db.agentApproval.findMany({
      where: { organizationId, ...(options.status ? { status: options.status } : {}) },
      orderBy: { requestedAt: 'desc' },
      take: options.limit,
    });
    return rows.map((row) => this.toRecord(row));
  }

  async update(approval: ApprovalRecord) {
    await this.db.agentApproval.update({
      where: { id: approval.id },
      data: {
        status: approval.status,
        decidedAt: approval.decidedAt ? toDate(approval.decidedAt) : null,
        decidedByUserId: approval.decidedBy?.userId ?? null,
        decidedByRole: approval.decidedBy?.role ?? null,
        comment: approval.comment,
      },
    });
  }

  async consume(organizationId: string, approvalId: string) {
    const result = await this.db.agentApproval.updateMany({
      where: { id: approvalId, organizationId, status: 'APPROVED' },
      data: { status: 'CONSUMED' },
    });
    return result.count === 1;
  }
}

/* ---------------------------------------------------------------------------------------------- */

class PrismaAuditSink implements AuditSink {
  constructor(private readonly db: Db) {}

  async append(entry: AuditEntry) {
    await this.db.auditEvent.create({
      data: {
        id: generateUlid('aud'),
        organizationId: entry.organizationId,
        // The audit enum predates agents; agents authenticate with an API key, so they are recorded as such.
        actorType: entry.actorType === 'AGENT' ? 'API_KEY' : entry.actorType,
        actorId: entry.actorId,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        metadata: json({ ...entry.metadata, actorKind: entry.actorType }),
        createdAt: toDate(entry.createdAt),
      },
    });
  }
}

/* ---------------------------------------------------------------------------------------------- */

export class PrismaAgentStore implements AgentStore {
  readonly mandates: MandateStore;
  readonly decisions: DecisionStore;
  readonly spend: SpendStore;
  readonly approvals: ApprovalStore;
  readonly audit: AuditSink;

  constructor(private readonly db: Db) {
    this.mandates = new PrismaMandateStore(db);
    this.decisions = new PrismaDecisionStore(db);
    this.spend = new PrismaSpendStore(db);
    this.approvals = new PrismaApprovalStore(db);
    this.audit = new PrismaAuditSink(db);
  }

  /**
   * Serialises work on one key across all API instances with a Postgres advisory lock held for the
   * duration of an interactive transaction. The lock is a mutex: the guarded work uses its own
   * connections, which is fine because every writer takes the same lock first.
   */
  runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
        return fn();
      },
      { timeout: 60_000, maxWait: 15_000 },
    );
  }
}

/* ---------------------------------------------------------------------------------------------- */

export class PrismaReceiptStore implements ReceiptStore {
  constructor(private readonly db: Db) {}

  private toStored(row: Prisma.BoundReceiptGetPayload<Record<string, never>>): StoredReceipt {
    return {
      organizationId: row.organizationId,
      receipt: row.document as unknown as BoundReceipt,
      createdAt: toSeconds(row.createdAt),
      batchId: row.batchId,
    };
  }

  async insert(stored: StoredReceipt) {
    const { receipt } = stored;
    await this.db.boundReceipt.create({
      data: {
        id: receipt.id,
        organizationId: stored.organizationId,
        mandateId: receipt.mandate.id,
        decisionId: receipt.decision.record.id,
        receiptHash: receipt.receiptHash,
        document: json(receipt),
        txSignature: receipt.settlement.txSignature,
        createdAt: toDate(stored.createdAt),
      },
    });
  }

  async get(organizationId: string, receiptId: string) {
    const row = await this.db.boundReceipt.findFirst({ where: { id: receiptId, organizationId } });
    return row ? this.toStored(row) : null;
  }

  async getByDecision(organizationId: string, decisionId: string) {
    const row = await this.db.boundReceipt.findFirst({ where: { decisionId, organizationId } });
    return row ? this.toStored(row) : null;
  }

  async list(organizationId: string, options: { limit: number }) {
    const rows = await this.db.boundReceipt.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: options.limit,
    });
    return rows.map((row) => this.toStored(row));
  }

  async listUnanchored(limit: number) {
    const rows = await this.db.boundReceipt.findMany({
      where: { batchId: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map((row) => this.toStored(row));
  }

  async saveBatch(batch: AnchorBatchRecord, anchors: Array<{ receiptId: string; anchor: AnchorProof }>) {
    await this.db.$transaction(async (tx) => {
      await tx.anchorBatch.create({
        data: {
          id: batch.id,
          merkleRoot: batch.merkleRoot,
          leafCount: batch.leafCount,
          txSignature: batch.txSignature,
          status: batch.status,
          error: batch.error,
          createdAt: toDate(batch.createdAt),
          anchoredAt: batch.anchoredAt ? toDate(batch.anchoredAt) : null,
        },
      });
      for (const { receiptId, anchor } of anchors) {
        const row = await tx.boundReceipt.findUniqueOrThrow({ where: { id: receiptId } });
        const document = { ...(row.document as Record<string, unknown>), anchor };
        await tx.boundReceipt.update({ where: { id: receiptId }, data: { batchId: batch.id, document: json(document) } });
      }
    });
  }

  async listBatches(limit: number) {
    const rows = await this.db.anchorBatch.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
    return rows.map(
      (row): AnchorBatchRecord => ({
        id: row.id,
        merkleRoot: row.merkleRoot,
        leafCount: row.leafCount,
        txSignature: row.txSignature,
        status: row.status,
        error: row.error,
        createdAt: toSeconds(row.createdAt),
        anchoredAt: row.anchoredAt ? toSeconds(row.anchoredAt) : null,
      }),
    );
  }
}
