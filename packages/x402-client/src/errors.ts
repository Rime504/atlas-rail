import { SignedDecision } from '@atlas-rail/mandate';

export type AtlasPaymentErrorCode =
  | 'MANDATE_DENIED'
  | 'ESCALATION_REQUIRED'
  | 'ESCALATION_DENIED'
  | 'ESCALATION_TIMEOUT'
  | 'GATE_AUTHORIZATION_REQUIRED'
  | 'UNSUPPORTED_PAYMENT'
  | 'PAYMENT_FAILED'
  | 'GATE_UNAVAILABLE';

export class AtlasPaymentError extends Error {
  constructor(
    public readonly code: AtlasPaymentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AtlasPaymentError';
  }
}

/** The gate refused this payment. Nothing was signed. `decision` names every rule that failed. */
export class MandateDeniedError extends AtlasPaymentError {
  constructor(public readonly decision: SignedDecision) {
    super('MANDATE_DENIED', `Payment denied by mandate: ${decision.record.reason}`);
    this.name = 'MandateDeniedError';
  }

  get failedRules(): string[] {
    return this.decision.record.failedRules;
  }
}

/** The gate wants a human to approve this payment and the client was configured not to wait. */
export class EscalationRequiredError extends AtlasPaymentError {
  constructor(
    public readonly approvalId: string,
    public readonly decision: SignedDecision,
  ) {
    super('ESCALATION_REQUIRED', `Payment needs human approval (approval ${approvalId})`);
    this.name = 'EscalationRequiredError';
  }
}

export class EscalationDeniedError extends AtlasPaymentError {
  constructor(public readonly approvalId: string) {
    super('ESCALATION_DENIED', `Approval ${approvalId} was denied or expired`);
    this.name = 'EscalationDeniedError';
  }
}

export class EscalationTimeoutError extends AtlasPaymentError {
  constructor(
    public readonly approvalId: string,
    timeoutMs: number,
  ) {
    super('ESCALATION_TIMEOUT', `No decision on approval ${approvalId} within ${timeoutMs}ms`);
    this.name = 'EscalationTimeoutError';
  }
}

/** A wallet refused to sign because it was not handed a valid gate authorisation for these exact bytes. */
export class GateAuthorizationRequiredError extends AtlasPaymentError {
  constructor(message = 'This signer only signs transactions authorised by the Atlas Rail mandate gate') {
    super('GATE_AUTHORIZATION_REQUIRED', message);
    this.name = 'GateAuthorizationRequiredError';
  }
}

export class UnsupportedPaymentError extends AtlasPaymentError {
  constructor(message: string) {
    super('UNSUPPORTED_PAYMENT', message);
    this.name = 'UnsupportedPaymentError';
  }
}

/** The seller did not accept or settle the payment after it was signed. The response is attached. */
export class PaymentSettlementError extends AtlasPaymentError {
  constructor(
    message: string,
    public readonly response: Response,
  ) {
    super('PAYMENT_FAILED', message);
    this.name = 'PaymentSettlementError';
  }
}
