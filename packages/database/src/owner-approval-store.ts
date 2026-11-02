import type { PrismaClient } from '@prisma/client';

export type OwnerApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CONSUMED';

/**
 * One request to the owner to allow one exact payment. It never changes the mandate: it is bound to
 * `subjectHash` (the voucher bytes or the pay.sh operation fingerprint) and `offerHash`, and it can be
 * used once. A PENDING request past `expiresAt` counts as rejected.
 */
export interface OwnerApprovalRecord {
  id: string;
  /** `voucher` for the channel voucher ask, `pay` for the pay.sh spending authority. */
  kind: 'voucher' | 'pay';
  mandateHash: string;
  subjectHash: string;
  offerHash: string;
  amount: string;
  recipient: string;
  agent: string;
  /** One plain sentence: which rule needs the owner, or why the behaviour check flagged it. */
  reason: string;
  status: OwnerApprovalStatus;
  /** Epoch seconds. */
  createdAt: number;
  expiresAt: number;
  decidedAt: number | null;
  /** `wallet:<public key>` of the owner or approver who signed. Never the agent. */
  decidedBy: string | null;
  telegramMessageId: number | null;
  /** Who may sign this approval: the mandate's owner and approver keys, fixed when it was asked. */
  signers: Array<{ publicKey: string; role: 'OWNER' | 'APPROVER' }>;
  /** The wallet signature over the exact payment, once the owner or an approver signed. */
  ownerSignature: { scheme: 'ed25519'; signer: string; signature: string } | null;
}

export class InMemoryOwnerApprovalStore {
  private readonly rows = new Map<string, OwnerApprovalRecord>();

  async create(approval: OwnerApprovalRecord): Promise<void> {
    if (this.rows.has(approval.id)) throw new Error('Approval already exists');
    this.rows.set(approval.id, { ...approval });
  }

  async get(id: string): Promise<OwnerApprovalRecord | null> {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }

  /** Newest pending or decided request for this exact subject, if any. */
  async findBySubject(subjectHash: string): Promise<OwnerApprovalRecord | null> {
    const rows = [...this.rows.values()].filter((r) => r.subjectHash === subjectHash).sort((a, b) => b.createdAt - a.createdAt);
    return rows[0] ? { ...rows[0] } : null;
  }

  /** Moves `from` → `to` only if the row is still `from`. Returns false when someone else got there first. */
  async transition(id: string, from: OwnerApprovalStatus, to: OwnerApprovalStatus, patch: Partial<OwnerApprovalRecord> = {}): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.status !== from) return false;
    this.rows.set(id, { ...row, ...patch, status: to });
    return true;
  }

  async setTelegramMessage(id: string, messageId: number): Promise<void> {
    const row = this.rows.get(id);
    if (row) row.telegramMessageId = messageId;
  }

  async list(): Promise<OwnerApprovalRecord[]> {
    return [...this.rows.values()].map((r) => ({ ...r })).sort((a, b) => b.createdAt - a.createdAt);
  }
}

const toDate = (seconds: number) => new Date(seconds * 1000);
const toSeconds = (date: Date) => Math.floor(date.getTime() / 1000);

export class PrismaOwnerApprovalStore {
  constructor(private readonly db: PrismaClient) {}

  private toRecord(row: Awaited<ReturnType<PrismaClient['ownerApproval']['findUniqueOrThrow']>>): OwnerApprovalRecord {
    const { signatureScheme, signer, signature, signers, ...rest } = row;
    return {
      ...rest,
      kind: row.kind as OwnerApprovalRecord['kind'],
      status: row.status as OwnerApprovalStatus,
      createdAt: toSeconds(row.createdAt),
      expiresAt: toSeconds(row.expiresAt),
      decidedAt: row.decidedAt ? toSeconds(row.decidedAt) : null,
      signers: signers as OwnerApprovalRecord['signers'],
      ownerSignature: signatureScheme === 'ed25519' && signer && signature ? { scheme: 'ed25519', signer, signature } : null,
    };
  }

  async create(approval: OwnerApprovalRecord): Promise<void> {
    const { ownerSignature, signers, ...rest } = approval;
    await this.db.ownerApproval.create({
      data: {
        ...rest,
        signers: signers as never,
        signatureScheme: ownerSignature?.scheme ?? null,
        signer: ownerSignature?.signer ?? null,
        signature: ownerSignature?.signature ?? null,
        createdAt: toDate(approval.createdAt),
        expiresAt: toDate(approval.expiresAt),
        decidedAt: approval.decidedAt === null ? null : toDate(approval.decidedAt),
      },
    });
  }

  async get(id: string): Promise<OwnerApprovalRecord | null> {
    const row = await this.db.ownerApproval.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  async findBySubject(subjectHash: string): Promise<OwnerApprovalRecord | null> {
    const row = await this.db.ownerApproval.findFirst({ where: { subjectHash }, orderBy: { createdAt: 'desc' } });
    return row ? this.toRecord(row) : null;
  }

  async transition(id: string, from: OwnerApprovalStatus, to: OwnerApprovalStatus, patch: Partial<OwnerApprovalRecord> = {}): Promise<boolean> {
    const { decidedAt, decidedBy, ownerSignature } = patch;
    const result = await this.db.ownerApproval.updateMany({
      where: { id, status: from },
      data: {
        status: to,
        ...(decidedAt !== undefined ? { decidedAt: decidedAt === null ? null : toDate(decidedAt) } : {}),
        ...(decidedBy !== undefined ? { decidedBy } : {}),
        ...(ownerSignature ? { signatureScheme: ownerSignature.scheme, signer: ownerSignature.signer, signature: ownerSignature.signature } : {}),
      },
    });
    return result.count === 1;
  }

  async setTelegramMessage(id: string, messageId: number): Promise<void> {
    await this.db.ownerApproval.update({ where: { id }, data: { telegramMessageId: messageId } });
  }

  async list(): Promise<OwnerApprovalRecord[]> {
    const rows = await this.db.ownerApproval.findMany({ orderBy: { createdAt: 'desc' }, take: 500 });
    return rows.map((row) => this.toRecord(row));
  }
}

export type OwnerApprovalStore = Pick<InMemoryOwnerApprovalStore, 'create' | 'get' | 'findBySubject' | 'transition' | 'setTelegramMessage' | 'list'>;
