/**
 * Which /verify answers may be cached at the edge. Only answers that can never change are: NOT_FOUND
 * can be an RPC node that hasn't seen a fresh transaction yet, and "its receipt hasn't been
 * published" can be a receipt published a moment ago. Caching either would pin a wrong answer to a
 * real payment for a day.
 */
export function isFinal(verdict: string, receiptMissing: boolean): boolean {
  if (verdict === 'NOT_FOUND') return false;
  if (verdict === 'NO_PROOF' && receiptMissing) return false;
  return true;
}
