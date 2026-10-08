import { SignedDecision, SpendResolution } from '@atlas-rail/mandate';

export type AtlasPaymentErrorCode =
  | 'MANDATE_DENIED'
  | 'ESCALATION_REQUIRED'
  | 'ESCALATION_DENIED'
  | 'ESCALATION_TIMEOUT'
  | 'GATE_AUTHORIZATION_REQUIRED'
  | 'UNSUPPORTED_PAYMENT'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_UNCONFIRMED'
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

/**
 * The signed payment went out but the seller never answered (timeout, dropped connection). The gate
 * checked the chain for the exact authorised transaction: SETTLED means the money moved and the
 * spend keeps counting; RELEASED means it never landed and the reserved budget was freed; PENDING
 * means the chain could not tell yet and the budget stays reserved.
 */
export class PaymentUnconfirmedError extends AtlasPaymentError {
  constructor(
    public readonly resolution: SpendResolution,
    public readonly decisionId: string,
    public readonly sellerError: unknown,
  ) {
    super('PAYMENT_UNCONFIRMED', PaymentUnconfirmedError.describe(resolution));
    this.name = 'PaymentUnconfirmedError';
  }

  get txSignature(): string | null {
    return this.resolution.status === 'SETTLED' ? this.resolution.txSignature : null;
  }

  private static describe(resolution: SpendResolution): string {
    switch (resolution.status) {
      case 'SETTLED':
        return `The seller did not answer, but the payment landed on-chain (${resolution.txSignature}); it counts against the mandate`;
      case 'RELEASED':
        return 'The seller did not answer and the payment never landed; the reserved budget was released';
      default:
        return 'The seller did not answer and the chain cannot tell yet whether the payment landed; the budget stays reserved';
    }
  }
}
