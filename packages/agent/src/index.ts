import type { SignedDecision } from '@atlas-rail/mandate';

export type { AtlasFetch, AtlasPaymentInfo, AtlasResponse } from '@atlas-rail/x402';
export { HttpSignerClient, startSignerService } from '@atlas-rail/x402';
export type { AuthorizedSigner } from '@atlas-rail/x402';
export { EscalationDeniedError, EscalationRequiredError, EscalationTimeoutError, PaymentSettlementError, PaymentUnconfirmedError, UnsupportedPaymentError } from '@atlas-rail/x402';

/** Thrown when the mandate refuses a payment. Nothing was signed and nothing left the wallet. */
export class AtlasDenied extends Error {
  readonly reasons: string[];
  readonly decision: SignedDecision;
  constructor(decision: SignedDecision) {
    super(`Atlas Rail refused this payment: ${decision.record.reason}`);
    this.name = 'AtlasDenied';
    this.reasons = decision.record.failedRules;
    this.decision = decision;
  }
}
