import { Prisma, prisma } from '@atlas-rail/database';
import { BoundReceipt, verifyReceipt } from '@atlas-rail/receipt';

/** Which deployment published this receipt — informational only, never trusted for anything. */
export type PublicReceiptSource = 'demo-agent' | 'playground';

export interface PublishResult {
  accepted: boolean;
  reason?: string;
}

/**
 * N2's public receipt store: anyone with only a devnet transaction signature reads its memo for a
 * receipt id, and this is what they fetch. Deliberately offline-verified at publish time (no chain
 * access, no trustedInstanceKeys allowlist) — the only thing published here is confirmed internally
 * self-consistent (schema, hash binding, a signature that verifies for the key inside the receipt).
 * That check is explicitly untrusted: it does not decide that the instance key is Atlas Rail's.
 * On-chain checks (anchor, settlement) aren't run here since a receipt is published right after
 * settlement, before it's been anchored — `atlas verify`/the /verify page run those separately,
 * with real chain access and a trusted instance key.
 */
export async function publishPublicReceipt(receipt: unknown, source: PublicReceiptSource): Promise<PublishResult> {
  const verification = await verifyReceipt(receipt, { untrusted: true });
  const hardFail = verification.checks.find((c) => c.status === 'FAIL');
  if (hardFail) return { accepted: false, reason: `${hardFail.id}: ${hardFail.message}` };

  const bound = receipt as BoundReceipt;
  const existing = await prisma.publicReceipt.findUnique({ where: { id: bound.id } });
  if (existing) {
    // Idempotent for the exact same receipt (a retried publish); never silently overwritten by a
    // different one claiming the same id — same anti-collision principle as ReceiptService.issue.
    if (existing.receiptHash !== bound.receiptHash) return { accepted: false, reason: 'id already used by a different receipt' };
    return { accepted: true };
  }

  await prisma.publicReceipt.create({
    data: { id: bound.id, receiptHash: bound.receiptHash, document: receipt as Prisma.InputJsonValue, source },
  });
  return { accepted: true };
}
