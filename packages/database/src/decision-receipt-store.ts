import type { PrismaClient } from '@prisma/client';
import type { AnchorBatchRecord, AnchorProof, DecisionReceipt, ReceiptStore, StoredReceipt } from '@atlas-rail/receipt';

/** pay.sh decision receipts in Postgres, in the shape AnchorService batches. */
export class PrismaDecisionReceiptStore {
  constructor(private readonly db: PrismaClient) {}

  async insert(receipt: DecisionReceipt): Promise<void> {
    await this.db.payDecisionReceipt.create({
      data: { id: receipt.id, mandateHash: receipt.decision.record.mandateHash, receiptHash: receipt.receiptHash, document: receipt as never, createdAt: new Date(receipt.issuedAt * 1000) },
    });
  }

  async get(id: string): Promise<DecisionReceipt | null> {
    const row = await this.db.payDecisionReceipt.findUnique({ where: { id } });
    return row ? (row.document as unknown as DecisionReceipt) : null;
  }

  asAnchorStore(): ReceiptStore {
    const db = this.db;
    const asStored = (row: { document: unknown; createdAt: Date; batchId: string | null }): StoredReceipt => {
      const receipt = row.document as DecisionReceipt;
      return { organizationId: receipt.mandate.issuer.organizationId, receipt: receipt as never, createdAt: Math.floor(row.createdAt.getTime() / 1000), batchId: row.batchId };
    };
    return {
      async insert() {
        throw new Error('Use PrismaDecisionReceiptStore.insert');
      },
      async get(_org, id) {
        const row = await db.payDecisionReceipt.findUnique({ where: { id } });
        return row ? asStored(row) : null;
      },
      async getByDecision() {
        return null;
      },
      async list(_org, options) {
        return (await db.payDecisionReceipt.findMany({ orderBy: { createdAt: 'desc' }, take: options.limit })).map(asStored);
      },
      async listUnanchored(limit) {
        return (await db.payDecisionReceipt.findMany({ where: { batchId: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: limit })).map(asStored);
      },
      async saveBatch(batch: AnchorBatchRecord, anchors: Array<{ receiptId: string; anchor: AnchorProof }>) {
        for (const { receiptId, anchor } of anchors) {
          const row = await db.payDecisionReceipt.findUnique({ where: { id: receiptId } });
          if (!row) continue;
          await db.payDecisionReceipt.update({ where: { id: receiptId }, data: { batchId: batch.id, document: { ...(row.document as object), anchor } as never } });
        }
      },
      async listBatches() {
        return [];
      },
    };
  }
}
