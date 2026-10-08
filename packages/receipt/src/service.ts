import {
  AgentEventSink,
  AgentMandate,
  AgentServiceError,
  AgentStore,
  MessageSigner,
  hashMandate,
  parseReceiptMemo,
  sha256Hex,
} from '@atlas-rail/mandate';
import {
  ChainClient,
  SignerAdapter,
  buildAnchorRootTransaction,
  buildAnchorTransaction,
  checkSettlement,
  fetchMandateAccount,
  findMandatePda,
} from '@atlas-rail/solana';
import { AnchorProof, BoundReceipt, ReceiptResponse, buildReceipt } from './receipt';
import { buildAnchorMemo, merkleProof, merkleRoot } from './merkle';

const DEFAULT_MANDATE_PROGRAM_ID = 'CnGoTE5Bxc8MFGaeK5LDv5uAZ7pNiktMunYy8JZcLY4k';

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

    // Self-proving payments: the transaction itself may already name this receipt's id in its Memo
    // instruction (written by the client before it signed — see packages/x402-client/src/fetch.ts).
    // Using that id instead of minting a fresh one is what lets someone who only has the transaction
    // signature, with no other context, find this exact receipt. A memo that collides with an
    // existing receipt (replay, or a client bug) is never trusted — mint a fresh id instead, same as
    // if there were no memo at all.
    const memoReceiptId = parseReceiptMemo(summary?.memos ?? []);
    const receiptId = memoReceiptId && !(await receipts.get(organizationId, memoReceiptId)) ? memoReceiptId : newId('rcp');

    const receipt = await buildReceipt(
      {
        id: receiptId,
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
  /** 'root' anchors each mandate's pending receipts separately via the mandate registry's
   * `anchor_root` instruction (a per-mandate on-chain Root PDA) instead of one SPL Memo across all
   * of them. Default 'memo'. Requires `rpcUrl`, and only anchors receipts whose mandate is already
   * registered on-chain — others are left pending and retried on the next run. */
  mode?: 'memo' | 'root';
  /** Required when mode is 'root': reads each mandate's current anchor_root sequence number before anchoring. */
  rpcUrl?: string;
  programId?: string;
}

export interface AnchorRunResult {
  batch: AnchorBatchRecord;
  anchored: number;
}

/**
 * Batches unanchored receipts into a Merkle tree and anchors the root on Solana devnet — either as
 * an SPL Memo (default) or, in 'root' mode, via the mandate registry's per-mandate `anchor_root`
 * instruction. Receipts keep their inclusion proofs so anyone can verify them later with
 * `atlas verify`.
 */
export class AnchorService {
  constructor(private readonly deps: AnchorServiceOptions) {}

  /** Anchors up to `maxBatchSize` pending receipts. Returns null when there is nothing to anchor. */
  async run(): Promise<AnchorRunResult | null> {
    if (this.deps.mode === 'root') return this.runRoot();
    return this.runMemo();
  }

  private async runMemo(): Promise<AnchorRunResult | null> {
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
          mechanism: 'memo' as const,
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

  /**
   * 'root' mode: groups pending receipts by mandate (the Root PDA's seq counter lives on the
   * Mandate account, so a batch can only ever cover one mandate) and anchors each group with its own
   * `anchor_root` call. A mandate that isn't registered on-chain is skipped — its receipts stay
   * pending and are retried on the next run, same as a failed anchor. Returns the last batch anchored
   * this run (there is normally exactly one mandate with pending receipts at a time); callers that
   * need the full picture should use `listBatches`.
   */
  private async runRoot(): Promise<AnchorRunResult | null> {
    const { receipts, chain, signer, clock, newId } = this.deps;
    const rpcUrl = this.deps.rpcUrl;
    if (!rpcUrl) throw new Error('AnchorService: rpcUrl is required when mode is "root"');
    const programId = this.deps.programId ?? DEFAULT_MANDATE_PROGRAM_ID;
    const network = this.deps.network ?? 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
    const pending = await receipts.listUnanchored(this.deps.maxBatchSize ?? 256);
    if (pending.length === 0) return null;

    const groups = new Map<string, { mandate: AgentMandate; items: typeof pending }>();
    for (const item of pending) {
      const hash = hashMandate(item.receipt.mandate);
      const group = groups.get(hash);
      if (group) group.items.push(item);
      else groups.set(hash, { mandate: item.receipt.mandate, items: [item] });
    }

    let last: AnchorRunResult | null = null;
    for (const [mandateHashHex, group] of groups) {
      const mandateHashBytes = Buffer.from(mandateHashHex, 'hex');
      const { address: mandatePda } = findMandatePda(programId, mandateHashBytes);
      const onchain = await fetchMandateAccount(rpcUrl, mandatePda).catch(() => null);
      if (!onchain) continue; // not registered on-chain; anchor_root needs the Mandate account to exist

      const leaves = group.items.map((p) => p.receipt.receiptHash);
      const root = merkleRoot(leaves);
      const batchId = newId('anc');
      const seq = onchain.nextRootSeq;

      try {
        const { blockhash } = await chain.getLatestBlockhash();
        const unsigned = buildAnchorRootTransaction({
          programId,
          mandatePda,
          gateAuthority: signer.publicKey,
          seq,
          merkleRoot: Buffer.from(root, 'hex'),
          leafCount: leaves.length,
          recentBlockhash: blockhash,
        });
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
        const anchors = group.items.map((p, index) => ({
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
            mechanism: 'root' as const,
            seq: Number(seq),
          },
        }));
        await receipts.saveBatch(batch, anchors);
        last = { batch, anchored: anchors.length };
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
        await receipts.saveBatch(batch, []);
        // Keep anchoring the other mandates' groups rather than aborting the whole run.
      }
    }
    return last;
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
