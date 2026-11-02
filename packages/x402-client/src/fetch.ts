import type { SignedDecision } from '@atlas-rail/mandate';
import type { BoundReceipt } from '@atlas-rail/receipt';

/** Attached to a paid response by callers that already hold a gate decision and a receipt. */
export interface AtlasPaymentInfo {
  decision: SignedDecision;
  approvalId: string | null;
  escalated: boolean;
  txSignature: string | null;
  receipt: BoundReceipt | null;
  receiptError: string | null;
  expectedReceiptId: string | null;
}

export type AtlasResponse = Response & { atlas?: AtlasPaymentInfo };

export type AtlasFetch = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<AtlasResponse>;
