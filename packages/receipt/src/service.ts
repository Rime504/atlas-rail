import {
  AgentEventSink,
  AgentServiceError,
  AgentStore,
  MessageSigner,
  sha256Hex,
} from '@atlas-rail/mandate';
import {
  ChainClient,
  SignerAdapter,
  buildAnchorTransaction,
  checkSettlement,
} from '@atlas-rail/solana';
import { AnchorProof, BoundReceipt, ReceiptResponse, buildReceipt } from './receipt';
import { buildAnchorMemo, merkleProof, merkleRoot } from './merkle';

export interface StoredReceipt {
  organizationId: string;
  receipt: BoundReceipt;
  createdAt: number;
  batchId: string | null;
}

export type AnchorBatchStatus = 'ANCHORED' | 'FAILED';

export interface AnchorBatchRecord {
  id: string;
  merkleRoot: string;
  leafCount: number;
  txSignature: string | null;
  status: AnchorBatchStatus;
  error: string | null;
  createdAt: number;
  anchoredAt: number | null;
}

export interface ReceiptStore {
  insert(stored: StoredReceipt): Promise<void>;
  get(organizationId: string, receiptId: string): Promise<StoredReceipt | null>;
  getByDecision(organizationId: string, decisionId: string): Promise<StoredReceipt | null>;
  list(organizationId: string, options: { limit: number }): Promise<StoredReceipt[]>;
  /** Oldest first, ordered by (createdAt, id): the order that defines Merkle leaf indexes. */
  listUnanchored(limit: number): Promise<StoredReceipt[]>;
  saveBatch(batch: AnchorBatchRecord, anchors: Array<{ receiptId: string; anchor: AnchorProof }>): Promise<void>;
  listBatches(limit: number): Promise<AnchorBatchRecord[]>;
}

export interface ReceiptServiceOptions {
  store: AgentStore;
  receipts: ReceiptStore;
  chain: ChainClient;
  instanceSigner: MessageSigner;
  clock: () => number;
  newId: (prefix: string) => string;
  notify?: AgentEventSink;
  /** Devnet network label written into receipts. */
  network?: string;
}

export interface IssueReceiptInput {
  decisionId: string;
  txSignature: string;
  response: ReceiptResponse;
}

/**
 * Issues bound receipts. A receipt is only issued after the settlement transaction has been read
 * back from the cluster and matches the offer exactly (one TransferChecked of the offered amount and
 * mint to the payTo account) and was paid by the mandate's agent key.
 */
export class ReceiptService {
  constructor(private readonly deps: ReceiptServiceOptions) {}

  async issue(organizationId: string, input: IssueReceiptInput): Promise<BoundReceipt> {
    const { store, receipts, chain, clock, newId } = this.deps;

    const stored = await store.decisions.get(organizationId, input.decisionId);
    if (!stored) throw new AgentServiceError('NOT_FOUND', 'Decision not found');
    const decision = stored.signed;
    if (decision.record.decision !== 'ALLOW') {
      throw new AgentServiceError('INVALID_STATE', 'Only ALLOW decisions can have a receipt');
    }

    const existing = await receipts.getByDecision(organizationId, input.decisionId);
    if (existing) {
      if (existing.receipt.settlement.txSignature !== input.txSignature) {
        throw new AgentServiceError('NONCE_REUSED', 'A receipt for this decision already exists with a different transaction');
      }
      return existing.receipt;
    }

    const mandateRecord = await store.mandates.get(organizationId, decision.record.mandateId);
    if (!mandateRecord) throw new AgentServiceError('NOT_FOUND', 'Mandate not found');

    const summary = await chain.getTransactionSummary(input.txSignature);
    const offer = decision.record.offer;
    const settlement = checkSettlement(summary, { payTo: offer.payTo, mint: offer.asset, amountBaseUnits: offer.amount });
    if (!settlement.ok) {
      throw new AgentServiceError('INVALID_STATE', `Settlement not verified: ${settlement.reason}`);
    }
    if (settlement.payer !== mandateRecord.mandate.agent.publicKey) {
      throw new AgentServiceError('INVALID_STATE', 'Settlement was not paid by the mandate agent key');
    }

    const receipt = await buildReceipt(
      {
        id: newId('rcp'),
        mandate: mandateRecord.mandate,
        decision,
        settlement: {
          txSignature: input.txSignature,
          network: this.deps.network ?? offer.network,
          payer: settlement.payer,
          settledAt: settlement.blockTime,
          slot: settlement.slot,
        },
        response: input.response,
        issuedAt: clock(),
      },
      this.deps.instanceSigner,
    );

    await receipts.insert({ organizationId, receipt, createdAt: clock(), batchId: null });
    await store.spend.markSettled(input.decisionId, input.txSignature);
    await store.audit.append({
      organizationId,
      actorType: 'AGENT',
      actorId: mandateRecord.mandate.agent.publicKey,
      action: 'AGENT_RECEIPT_ISSUED',
      resourceType: 'AGENT_MANDATE',
      resourceId: mandateRecord.mandate.id,
      metadata: { receiptId: receipt.id, receiptHash: receipt.receiptHash, txSignature: input.txSignature, decisionId: input.decisionId },
      createdAt: clock(),
    });
    try {
      await this.deps.notify?.({
        type: 'agent.receipt.issued',
        organizationId,
        payload: { receiptId: receipt.id, receiptHash: receipt.receiptHash, txSignature: input.txSignature, mandateId: mandateRecord.mandate.id },
      });
    } catch {
      // best-effort
    }
    return receipt;
  }
}

export interface AnchorServiceOptions {
  receipts: ReceiptStore;
  chain: ChainClient;
  /** The Atlas Rail instance key: attests receipts AND signs/pays for the anchor transaction. */
  signer: SignerAdapter & MessageSigner;
  clock: () => number;
  newId: (prefix: string) => string;
  network?: string;
  maxBatchSize?: number;
}

export interface AnchorRunResult {
  batch: AnchorBatchRecord;
  anchored: number;
}

/**
 * Batches unanchored receipts into a Merkle tree and anchors the root on Solana devnet with a Memo
 * instruction signed by the instance key. Receipts keep their inclusion proofs so anyone can verify
 * them later with `atlas verify`.
 */
export class AnchorService {
  constructor(private readonly deps: AnchorServiceOptions) {}

  /** Anchors up to `maxBatchSize` pending receipts. Returns null when there is nothing to anchor. */
  async run(): Promise<AnchorRunResult | null> {
    const { receipts, chain, signer, clock, newId } = this.deps;
    const pending = await receipts.listUnanchored(this.deps.maxBatchSize ?? 256);
    if (pending.length === 0) return null;

    const leaves = pending.map((p) => p.receipt.receiptHash);
    const root = merkleRoot(leaves);
    const batchId = newId('anc');
    const memo = buildAnchorMemo({ merkleRoot: root, leafCount: leaves.length, batchId });
    const network = this.deps.network ?? 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';

    try {
      const { blockhash } = await chain.getLatestBlockhash();
      const unsigned = buildAnchorTransaction({ signer: signer.publicKey, memo, recentBlockhash: blockhash });
      const signed = await signer.signTransaction(unsigned);
      const txSignature = await chain.sendAndConfirm(signed.signedBase64);
      const summary = await chain.getTransactionSummary(txSignature);
      const anchoredAt = summary?.blockTime ?? clock();

      const batch: AnchorBatchRecord = {
        id: batchId,
        merkleRoot: root,
        leafCount: leaves.length,
        txSignature,
        status: 'ANCHORED',
        error: null,
        createdAt: clock(),
        anchoredAt,
      };
      const anchors = pending.map((p, index) => ({
        receiptId: p.receipt.id,
        anchor: {
          batchId,
          merkleRoot: root,
          leafCount: leaves.length,
          leafIndex: index,
          proof: merkleProof(leaves, index),
          txSignature,
          network,
          anchoredAt,
          signer: signer.publicKey,
        },
      }));
      await receipts.saveBatch(batch, anchors);
      return { batch, anchored: anchors.length };
    } catch (error) {
      const batch: AnchorBatchRecord = {
        id: batchId,
        merkleRoot: root,
        leafCount: leaves.length,
        txSignature: null,
        status: 'FAILED',
        error: error instanceof Error ? error.message : String(error),
        createdAt: clock(),
        anchoredAt: null,
      };
      await receipts.saveBatch(batch, []); // receipts stay unanchored and are retried on the next run
      throw error;
    }
  }
}

/** Hash of a paid response body, as recorded in receipts. */
export function hashResponseBody(body: Uint8Array | string): string {
  return sha256Hex(body);
}

/** In-memory {@link ReceiptStore} for tests and hermetic demos. */
export class InMemoryReceiptStore implements ReceiptStore {
  private readonly rows: StoredReceipt[] = [];
  private readonly batches: AnchorBatchRecord[] = [];

  async insert(stored: StoredReceipt) {
    this.rows.push(structuredClone(stored));
  }
  async get(organizationId: string, receiptId: string) {
    const row = this.rows.find((r) => r.organizationId === organizationId && r.receipt.id === receiptId);
    return row ? structuredClone(row) : null;
  }
  async getByDecision(organizationId: string, decisionId: string) {
    const row = this.rows.find((r) => r.organizationId === organizationId && r.receipt.decision.record.id === decisionId);
    return row ? structuredClone(row) : null;
  }
  async list(organizationId: string, options: { limit: number }) {
    return this.rows
      .filter((r) => r.organizationId === organizationId)
      .slice(-options.limit)
      .reverse()
      .map((r) => structuredClone(r));
  }
  async listUnanchored(limit: number) {
    return this.rows
      .filter((r) => r.batchId === null)
      .sort((a, b) => a.createdAt - b.createdAt || a.receipt.id.localeCompare(b.receipt.id))
      .slice(0, limit)
      .map((r) => structuredClone(r));
  }
  async saveBatch(batch: AnchorBatchRecord, anchors: Array<{ receiptId: string; anchor: AnchorProof }>) {
    this.batches.push(structuredClone(batch));
    for (const { receiptId, anchor } of anchors) {
      const row = this.rows.find((r) => r.receipt.id === receiptId);
      if (row) {
        row.batchId = batch.id;
        row.receipt = { ...row.receipt, anchor: structuredClone(anchor) };
      }
    }
  }
  async listBatches(limit: number) {
    return this.batches.slice(-limit).reverse().map((b) => structuredClone(b));
  }
}
