import { BlobNotFoundError, head, put } from '@vercel/blob';
import { proveBlockedAttempt, verifyReceipt } from '@atlas-rail/receipt';
import type { ChainClient } from '@atlas-rail/solana';

/**
 * The public receipt store (N2): a Vercel Blob store attached to this project. Anyone can read;
 * only this server (after a real devnet proof step) and the showcase script holding the store token
 * can write, and only records that verify in full:
 *  - receipts: every verifyReceipt check must PASS, including the on-chain anchor and settlement
 *    reads (a synthetic instant-mode receipt can never get in);
 *  - blocked attempts: a signed DENY decision under a mandate whose signatures all verify.
 * Blobs are never overwritten, so a published proof can't be swapped for another later.
 */

export const MAX_RECORD_BYTES = 32 * 1024;
export const RECEIPT_ID = /^rcp_[0-9A-Za-z]{6,40}$/;
export const DECISION_ID = /^dec_[0-9A-Za-z]{6,40}$/;

export interface BlobBackend {
  read(pathname: string): Promise<string | null>;
  /** Must refuse to overwrite an existing pathname. */
  create(pathname: string, body: string): Promise<void>;
}

export const vercelBlob: BlobBackend = {
  /**
   * Existence comes from the store's API (`head`), never from the public URL: a URL read of a
   * not-yet-written record can be cached as "not found", and publishing reads before it writes, so
   * a fresh receipt could look unpublished for a while. The content is then fetched at a URL tagged
   * with its upload time; records are never overwritten, so that tagged copy is always current.
   */
  async read(pathname) {
    let meta: Awaited<ReturnType<typeof head>>;
    try {
      meta = await head(pathname);
    } catch (err) {
      if (err instanceof BlobNotFoundError) return null;
      throw err;
    }
    const res = await fetch(`${meta.url}?v=${meta.uploadedAt.getTime()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Receipt store read failed (HTTP ${res.status})`);
    return res.text();
  },
  async create(pathname, body) {
    await put(pathname, body, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: 'application/json',
      cacheControlMaxAge: 31_536_000,
    });
  },
};

export function storeConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export interface StoreResult {
  stored: boolean;
  reason: string;
}

const receiptPath = (id: string) => `receipts/${id}.json`;
const decisionPath = (id: string) => `decisions/${id}.json`;

async function createOnce(backend: BlobBackend, pathname: string, body: string, sameAs: (existing: unknown) => boolean): Promise<StoreResult> {
  const existing = await backend.read(pathname);
  if (existing !== null) {
    return sameAs(JSON.parse(existing))
      ? { stored: true, reason: 'Already published (identical record).' }
      : { stored: false, reason: 'A different record is already published under this id.' };
  }
  await backend.create(pathname, body);
  return { stored: true, reason: 'Published.' };
}

export async function publishReceipt(receipt: unknown, deps: { chain: ChainClient; backend?: BlobBackend }): Promise<StoreResult> {
  const backend = deps.backend ?? vercelBlob;
  const body = JSON.stringify(receipt);
  if (body.length > MAX_RECORD_BYTES) return { stored: false, reason: `Record exceeds ${MAX_RECORD_BYTES} bytes.` };
  const verification = await verifyReceipt(receipt, { chain: deps.chain, requireAnchor: true });
  const notPassed = verification.checks.filter((c) => c.status !== 'PASS');
  if (notPassed.length > 0) return { stored: false, reason: `Not every check passed: ${notPassed.map((c) => `${c.id} ${c.status}`).join(', ')}` };
  const r = receipt as { id: string; receiptHash: string };
  if (!RECEIPT_ID.test(r.id)) return { stored: false, reason: 'Receipt id has an unexpected format.' };
  return createOnce(backend, receiptPath(r.id), body, (e) => (e as { receiptHash?: string }).receiptHash === r.receiptHash);
}

export async function publishBlockedAttempt(record: unknown, deps: { backend?: BlobBackend } = {}): Promise<StoreResult> {
  const backend = deps.backend ?? vercelBlob;
  const body = JSON.stringify(record);
  if (body.length > MAX_RECORD_BYTES) return { stored: false, reason: `Record exceeds ${MAX_RECORD_BYTES} bytes.` };
  const proof = proveBlockedAttempt(record);
  if (proof.verdict !== 'BLOCKED' || !proof.facts) return { stored: false, reason: proof.reason };
  const id = proof.facts.decisionId;
  if (!DECISION_ID.test(id)) return { stored: false, reason: 'Decision id has an unexpected format.' };
  const hash = (record as { decision: { decisionHash: string } }).decision.decisionHash;
  return createOnce(backend, decisionPath(id), body, (e) => (e as { decision?: { decisionHash?: string } }).decision?.decisionHash === hash);
}

export async function loadPublished(kind: 'receipt' | 'decision', id: string, backend: BlobBackend = vercelBlob): Promise<unknown | null> {
  const pattern = kind === 'receipt' ? RECEIPT_ID : DECISION_ID;
  if (!pattern.test(id)) return null;
  const text = await backend.read(kind === 'receipt' ? receiptPath(id) : decisionPath(id));
  return text === null ? null : JSON.parse(text);
}
