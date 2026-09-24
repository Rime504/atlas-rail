import {
  OfferError,
  SOLANA_DEVNET_CAIP2,
  SignedDecision,
  X402Offer,
  normalizeNetwork,
  offerFromRequirements,
  sha256Hex,
  signGateRequest,
} from '@atlas-rail/mandate';
import { BoundReceipt } from '@atlas-rail/receipt';
import { ChainClient, buildExactPaymentTransaction } from '@atlas-rail/solana';
import {
  AtlasPaymentError,
  EscalationDeniedError,
  EscalationRequiredError,
  EscalationTimeoutError,
  MandateDeniedError,
  PaymentSettlementError,
  UnsupportedPaymentError,
} from './errors';
import { GateClient, GateResponse } from './gate-client';
import { GatedSignerAdapter } from './gated-signer';

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

/* -------------------------------------------------------------------------------------------------
 * x402 v2 wire types and header codecs (base64 of UTF-8 JSON, per the x402 v2 HTTP transport)
 * -----------------------------------------------------------------------------------------------*/

export interface X402Requirement {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown> | null;
}

export interface X402PaymentRequired {
  x402Version: number;
  error?: string;
  resource?: { url?: string; description?: string; mimeType?: string };
  accepts: X402Requirement[];
  extensions?: Record<string, unknown>;
}

export interface X402SettleResponse {
  success: boolean;
  transaction?: string;
  network?: string;
  payer?: string;
  errorReason?: string;
}

const encodeHeader = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
const decodeHeader = <T>(value: string): T => JSON.parse(Buffer.from(value, 'base64').toString('utf8')) as T;

/* -------------------------------------------------------------------------------------------------
 * Public API
 * -----------------------------------------------------------------------------------------------*/

export type AtlasClientEvent =
  | { type: 'payment_required'; url: string; amount: string; payTo: string }
  | { type: 'gate_decision'; decision: 'ALLOW' | 'DENY' | 'ESCALATE'; failedRules: string[]; reason: string }
  | { type: 'awaiting_approval'; approvalId: string }
  | { type: 'approval_granted'; approvalId: string }
  | { type: 'payment_signed'; txMessageHash: string }
  | { type: 'settled'; txSignature: string }
  | { type: 'receipt_issued'; receiptId: string };

export interface EscalationConfig {
  /** `wait` polls for a human decision; `fail` throws {@link EscalationRequiredError} immediately. */
  mode: 'wait' | 'fail';
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export interface AtlasFetchConfig {
  mandateId: string;
  /** The agent's wallet, wrapped so it only signs what the gate allowed. */
  signer: GatedSignerAdapter;
  gate: GateClient;
  chain: ChainClient;
  fetch?: typeof fetch;
  /** Epoch seconds. */
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
  escalation?: EscalationConfig;
  receiptRetries?: number;
  receiptRetryDelayMs?: number;
  onEvent?: (event: AtlasClientEvent) => void;
}

export interface AtlasPaymentInfo {
  decision: SignedDecision;
  approvalId: string | null;
  escalated: boolean;
  txSignature: string | null;
  receipt: BoundReceipt | null;
  /** Set if the resource was paid for and delivered but the receipt could not be issued yet. */
  receiptError: string | null;
}

export type AtlasResponse = Response & { atlas?: AtlasPaymentInfo };

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * A drop-in `fetch` for agents. Requests that do not need payment pass straight through. On an
 * HTTP 402 it parses the x402 requirements, asks the Atlas Rail gate whether the mandate allows the
 * payment, and only on ALLOW builds the transaction, gets the wallet to sign it (the wallet
 * independently verifies the gate's authorisation), retries with the payment header, and returns
 * the paid response with the bound receipt attached as `response.atlas`.
 */
export type AtlasFetch = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<AtlasResponse>;

export function createAtlasFetch(config: AtlasFetchConfig): AtlasFetch {
  const doFetch = config.fetch ?? fetch;
  const clock = config.clock ?? (() => Math.floor(Date.now() / 1000));
  const sleep = config.sleep ?? defaultSleep;
  const emit = (event: AtlasClientEvent) => {
    try {
      config.onEvent?.(event);
    } catch {
      // observers must never break payments
    }
  };
  let nonceCounter = 0;
  const newNonce = () => `${clock()}-${Math.random().toString(36).slice(2, 10)}-${++nonceCounter}`;

  async function buildPayment(requirement: X402Requirement, offer: X402Offer): Promise<string> {
    const mint = await config.chain.getMintInfo(requirement.asset);
    if (!mint) throw new UnsupportedPaymentError(`Asset ${requirement.asset} does not exist on this cluster`);
    if (mint.tokenProgram !== TOKEN_PROGRAM) {
      throw new UnsupportedPaymentError('Only classic SPL Token mints are supported (Token-2022 is not allowlisted)');
    }
    if (!offer.feePayer) throw new UnsupportedPaymentError('Seller did not provide extra.feePayer, which the SVM exact scheme requires');
    const { blockhash } = await config.chain.getLatestBlockhash();
    const tx = buildExactPaymentTransaction({
      payer: config.signer.publicKey,
      feePayer: offer.feePayer,
      mint: offer.asset,
      decimals: mint.decimals,
      payTo: offer.payTo,
      amountBaseUnits: offer.amount,
      recentBlockhash: blockhash,
      memo: offer.memo,
    });
    return Buffer.from(tx.serialize()).toString('base64');
  }

  async function askGate(offer: X402Offer, transactionBase64: string, approvalId: string | null): Promise<GateResponse> {
    const request = await signGateRequest(
      {
        type: 'atlasrail.gate-request',
        version: '0.1',
        mandateId: config.mandateId,
        offer,
        transactionBase64,
        approvalId,
        nonce: newNonce(),
        requestedAt: clock(),
      },
      config.signer,
    );
    const response = await config.gate.evaluate(request);
    emit({
      type: 'gate_decision',
      decision: response.decision.record.decision,
      failedRules: response.decision.record.failedRules,
      reason: response.decision.record.reason,
    });
    return response;
  }

  async function waitForApproval(approvalId: string, decision: SignedDecision): Promise<void> {
    const mode = config.escalation?.mode ?? 'wait';
    if (mode === 'fail') throw new EscalationRequiredError(approvalId, decision);
    const timeoutMs = config.escalation?.timeoutMs ?? 120_000;
    const poll = config.escalation?.pollIntervalMs ?? 1_000;
    emit({ type: 'awaiting_approval', approvalId });
    const started = Date.now();
    for (;;) {
      const approval = await config.gate.getApproval(approvalId);
      if (approval.status === 'APPROVED') {
        emit({ type: 'approval_granted', approvalId });
        return;
      }
      if (approval.status === 'DENIED' || approval.status === 'EXPIRED' || approval.status === 'CONSUMED') {
        throw new EscalationDeniedError(approvalId);
      }
      if (Date.now() - started >= timeoutMs) throw new EscalationTimeoutError(approvalId, timeoutMs);
      await sleep(poll);
    }
  }

  async function issueReceipt(
    decisionId: string,
    txSignature: string,
    response: Response,
  ): Promise<{ receipt: BoundReceipt | null; error: string | null }> {
    const body = new Uint8Array(await response.clone().arrayBuffer());
    const payload = {
      decisionId,
      txSignature,
      response: {
        status: response.status,
        bodySha256: sha256Hex(body),
        contentType: response.headers.get('content-type'),
      },
    };
    const attempts = config.receiptRetries ?? 6;
    let lastError = 'unknown error';
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const receipt = await config.gate.issueReceipt(payload);
        emit({ type: 'receipt_issued', receiptId: receipt.id });
        return { receipt, error: null };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        await sleep(config.receiptRetryDelayMs ?? 750); // the cluster may not have finalised the settlement yet
      }
    }
    return { receipt: null, error: lastError };
  }

  return async (input, init) => {
    const request = new Request(input, init);
    const retryRequest = request.clone();
    const first = await doFetch(request);
    if (first.status !== 402) return first;

    // 1. Parse what the seller is asking for.
    let paymentRequired: X402PaymentRequired;
    try {
      const header = first.headers.get('PAYMENT-REQUIRED');
      const text = await first.text();
      paymentRequired = header ? decodeHeader<X402PaymentRequired>(header) : (JSON.parse(text) as X402PaymentRequired);
    } catch {
      throw new UnsupportedPaymentError('402 response did not carry a valid x402 payment requirement');
    }
    const requirement = paymentRequired.accepts?.find(
      (a) => a.scheme === 'exact' && normalizeNetwork(a.network) === SOLANA_DEVNET_CAIP2,
    );
    if (!requirement) {
      const offered = (paymentRequired.accepts ?? []).map((a) => `${a.scheme}@${a.network}`).join(', ') || 'nothing';
      throw new UnsupportedPaymentError(`No supported payment option (Atlas Rail v1 pays exact on Solana devnet only); seller offered: ${offered}`);
    }

    // The URL we actually requested is the ground truth for scope; a seller cannot rename its own resource.
    let offer: X402Offer;
    try {
      offer = offerFromRequirements(requirement, request.url, paymentRequired.x402Version ?? 2);
    } catch (error) {
      throw new UnsupportedPaymentError(error instanceof OfferError ? error.message : 'Malformed x402 offer');
    }
    emit({ type: 'payment_required', url: offer.resourceUrl, amount: offer.amount, payTo: offer.payTo });

    // 2. Build the exact transaction we would sign and ask the gate about *that*.
    let transactionBase64 = await buildPayment(requirement, offer);
    let outcome = await askGate(offer, transactionBase64, null);
    let escalated = false;
    let approvalId: string | null = null;

    if (outcome.decision.record.decision === 'DENY') throw new MandateDeniedError(outcome.decision);

    if (outcome.decision.record.decision === 'ESCALATE') {
      escalated = true;
      approvalId = outcome.approval?.id ?? null;
      if (!approvalId) throw new AtlasPaymentError('GATE_UNAVAILABLE', 'Gate escalated without creating an approval');
      await waitForApproval(approvalId, outcome.decision);
      // Approved: rebuild with a fresh blockhash and ask again, presenting the approval.
      transactionBase64 = await buildPayment(requirement, offer);
      outcome = await askGate(offer, transactionBase64, approvalId);
      if (outcome.decision.record.decision !== 'ALLOW') throw new MandateDeniedError(outcome.decision);
    }

    // 3. Only now does the wallet sign — and it re-verifies the gate's authorisation itself.
    const signed = await config.signer.signWithAuthorization(transactionBase64, outcome.authorization);
    emit({ type: 'payment_signed', txMessageHash: outcome.authorization?.txMessageHash ?? '' });

    const paymentPayload = {
      x402Version: paymentRequired.x402Version ?? 2,
      ...(paymentRequired.resource ? { resource: paymentRequired.resource } : {}),
      accepted: requirement,
      payload: { transaction: signed.signedBase64 },
      ...(paymentRequired.extensions ? { extensions: paymentRequired.extensions } : {}),
    };
    retryRequest.headers.set('PAYMENT-SIGNATURE', encodeHeader(paymentPayload));
    retryRequest.headers.set('Access-Control-Expose-Headers', 'PAYMENT-RESPONSE,X-PAYMENT-RESPONSE');
    const paid = (await doFetch(retryRequest)) as AtlasResponse;

    if (paid.status >= 400) {
      throw new PaymentSettlementError(
        `Seller rejected the payment with HTTP ${paid.status}; the reserved budget is released automatically after the reservation TTL`,
        paid,
      );
    }
    const settleHeader = paid.headers.get('PAYMENT-RESPONSE') ?? paid.headers.get('X-PAYMENT-RESPONSE');
    let settle: X402SettleResponse | null = null;
    try {
      settle = settleHeader ? decodeHeader<X402SettleResponse>(settleHeader) : null;
    } catch {
      settle = null;
    }
    const txSignature = settle?.success && settle.transaction ? settle.transaction : null;
    if (txSignature) emit({ type: 'settled', txSignature });

    let receipt: BoundReceipt | null = null;
    let receiptError: string | null = null;
    if (txSignature) {
      ({ receipt, error: receiptError } = await issueReceipt(outcome.decision.record.id, txSignature, paid));
    } else {
      receiptError = 'Seller response carried no settlement (PAYMENT-RESPONSE) header';
    }

    paid.atlas = { decision: outcome.decision, approvalId, escalated, txSignature, receipt, receiptError };
    return paid;
  };
}
