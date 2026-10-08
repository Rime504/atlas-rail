import { describe, expect, it } from 'vitest';
import { formatReceiptMemo, parseReceiptMemo } from './receipt-memo';

describe('receipt memo format', () => {
  it('round-trips a well-formed receipt id', () => {
    const id = 'rcp_' + '0123456789abcdef'.repeat(2);
    expect(parseReceiptMemo([formatReceiptMemo(id)])).toBe(id);
  });

  it('finds the first well-formed pointer among several memos, ignoring the rest', () => {
    const id = 'rcp_' + 'a'.repeat(32);
    expect(parseReceiptMemo(['some unrelated memo', formatReceiptMemo(id), 'another one'])).toBe(id);
  });

  it('returns null when nothing matches (no memo, or a seller-claimed one)', () => {
    expect(parseReceiptMemo([])).toBeNull();
    expect(parseReceiptMemo(['invoice #4821'])).toBeNull();
  });

  it('rejects malformed ids even with the right prefix (wrong length, uppercase, missing rcp_ inside)', () => {
    expect(parseReceiptMemo(['atlasrail:receipt:rcp_short'])).toBeNull();
    expect(parseReceiptMemo(['atlasrail:receipt:rcp_' + 'A'.repeat(32)])).toBeNull();
    expect(parseReceiptMemo(['atlasrail:receipt:not-a-receipt-id'])).toBeNull();
  });
});
