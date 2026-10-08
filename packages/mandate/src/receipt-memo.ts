/**
 * Self-proving payments: the memo format a payment's optional Memo instruction carries when the
 * seller hasn't claimed that slot for something else (see `packages/x402-client/src/fetch.ts`, which
 * writes it before the transaction is signed, and `packages/receipt/src/service.ts`'s
 * `ReceiptService.issue`, which reads it back off the settled transaction and uses it as the
 * receipt's actual id). Defined once here, in the package both already depend on, so the writer and
 * the reader can never drift out of sync. See spec/proof-of-permission.md for the full format.
 */
export const RECEIPT_MEMO_PREFIX = 'atlasrail:receipt:';
const RECEIPT_ID_PATTERN = /^rcp_[0-9a-f]{32}$/;

export function formatReceiptMemo(receiptId: string): string {
  return `${RECEIPT_MEMO_PREFIX}${receiptId}`;
}

/** Finds the first well-formed Atlas Rail receipt pointer among a settled transaction's memos, if
 * any — null if none match (the seller claimed the memo slot, or this isn't an Atlas Rail payment). */
export function parseReceiptMemo(memos: readonly string[]): string | null {
  for (const memo of memos) {
    if (!memo.startsWith(RECEIPT_MEMO_PREFIX)) continue;
    const id = memo.slice(RECEIPT_MEMO_PREFIX.length);
    if (RECEIPT_ID_PATTERN.test(id)) return id;
  }
  return null;
}
