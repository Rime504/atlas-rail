import type { AnchorProof } from './receipt';
import type { AnchorBatchRecord, ReceiptStore, StoredReceipt } from './service';
import type { DecisionReceipt } from './decision-receipt';

/**
 * Decision receipts, oldest first, with the same shape AnchorService batches (id, receiptHash,
 * mandate, anchor). `asAnchorStore()` lets AnchorService anchor them exactly like payment receipts.
 */
export class InMemoryDecisionReceiptStore {
  private readonly rows: Array<{ receipt: DecisionReceipt; createdAt: number; batchId: string | null }> = [];
  private readonly batches: AnchorBatchRecord[] = [];

  async insert(receipt: DecisionReceipt, createdAt = receipt.issuedAt): Promise<void> {
    if (this.rows.some((row) => row.receipt.id === receipt.id)) throw new Error('Receipt already exists');
    this.rows.push({ receipt: structuredClone(receipt), createdAt, batchId: null });
  }

  async get(id: string): Promise<DecisionReceipt | null> {
    const row = this.rows.find((r) => r.receipt.id === id);
    return row ? structuredClone(row.receipt) : null;
  }

  async list(limit = 200): Promise<DecisionReceipt[]> {
    return this.rows.slice(-limit).reverse().map((row) => structuredClone(row.receipt));
  }

  asAnchorStore(): ReceiptStore {
    const rows = this.rows;
    const batches = this.batches;
    const asStored = (row: (typeof rows)[number]): StoredReceipt => ({ organizationId: row.receipt.mandate.issuer.organizationId, receipt: row.receipt as never, createdAt: row.createdAt, batchId: row.batchId });
    return {
      async insert() {
        throw new Error('Use InMemoryDecisionReceiptStore.insert');
      },
      async get(_org, id) {
        const row = rows.find((r) => r.receipt.id === id);
        return row ? asStored(row) : null;
      },
      async getByDecision(_org, decisionId) {
        const row = rows.find((r) => r.receipt.decision.record.id === decisionId);
        return row ? asStored(row) : null;
      },
      async list(_org, options) {
        return rows.slice(-options.limit).reverse().map(asStored);
      },
      async listUnanchored(limit) {
        return rows.filter((r) => !r.receipt.anchor).slice(0, limit).map(asStored);
      },
      async saveBatch(batch: AnchorBatchRecord, anchors: Array<{ receiptId: string; anchor: AnchorProof }>) {
        batches.push(batch);
        for (const { receiptId, anchor } of anchors) {
          const row = rows.find((r) => r.receipt.id === receiptId);
          if (row) {
            row.receipt.anchor = anchor;
            row.batchId = batch.id;
          }
        }
      },
      async listBatches(limit) {
        return batches.slice(-limit).reverse();
      },
    };
  }
}
