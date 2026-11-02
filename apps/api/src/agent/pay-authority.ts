import { createHash } from 'node:crypto';
import {
  AgentMandate,
  GateApproval,
  GateContext,
  JsonValue,
  MessageSigner,
  OwnerReview,
  SIGNATURE_DOMAIN,
  X402Offer,
  buildDecisionRecord,
  evaluateGate,
  hashCanonical,
  hashMandate,
  approvalSigners,
  hashOffer,
  signDecision,
  signDomainHash,
} from '@atlas-rail/mandate';
import type { PayOperationRecord, PayOperationStore, VoucherSpendStore } from '@atlas-rail/database';
import { buildDecisionReceipt, type AuthorityAnswer, type DecisionReceipt } from '@atlas-rail/receipt';
import { z } from 'zod';
import { checkBehaviour } from './behaviour';
import { OwnerApprovals, approvalTerms } from './owner-approvals';

/*
 * Atlas Rail as a pay.sh spending authority (solana-foundation/pay PR #514, HTTP shape of PR #525).
 * pay POSTs its SpendRequest; we answer {"decision": ..., "unavailable": false, ...}. Extra fields
 * (reason, ids, hashes, signature) are ignored by pay and kept for audit. Every decision gets a signed,
 * anchorable receipt. Devnet only.
 */

export const DEVNET_CAIP2 = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
export const DEVNET_ONLY = 'Atlas Rail is devnet-only until its external audit.';
const ANSWER_DOMAIN = SIGNATURE_DOMAIN.authorityAnswer;

/** pay's SpendRequest, field for field. Anything unexpected is denied. */
const spendRequestSchema = z
  .object({
    operation_id: z.string().regex(/^[A-Za-z0-9\-_.:]{1,128}$/),
    attempt_id: z.string().min(1).max(128),
    caller_id: z.string().min(1).max(256),
    request: z
      .object({
        method: z.string().min(1).max(16),
        url: z.string().url().max(4096),
        headers: z.array(z.tuple([z.string().max(256), z.string().max(8192)])).max(200),
        body: z.array(z.number().int().min(0).max(255)).max(1_000_000).nullable(),
      })
      .strict(),
    amount_atomic: z.string().regex(/^[1-9][0-9]{0,19}$/),
    asset: z.string().min(32).max(44),
    network: z.string().min(1).max(80),
    execution_network: z.string().min(1).max(40),
    recipient: z.string().min(32).max(44),
    accepted: z.record(z.unknown()),
  })
  .strict();

export type SpendRequest = z.infer<typeof spendRequestSchema>;

export interface PayAnswer {
  decision: AuthorityAnswer['decision'];
  /** pay reads only `decision` and this flag. */
  unavailable: false;
  reason: string;
  operation_id: string | null;
  attempt_id: string | null;
  caller_id: string | null;
  request_sha256: string | null;
  offer_hash: string | null;
  decision_id: string | null;
  decision_hash: string | null;
  receipt_id: string | null;
  approval_id: string | null;
  answered_at: number;
  /** Ed25519 over the JCS hash of every field above, domain `atlasrail/v0.1/authority-answer`. */
  atlas: { key: string; signature: string } | null;
}

export type PayVerdict = PayAnswer | { decision: 'deny'; unavailable: true; reason: string };

export interface PayCaller {
  /** The signed mandate this caller pays under. */
  mandate: AgentMandate;
}

/** The stored key of one operation. JSON, not a zero-byte separator: Postgres text cannot hold 0x00. */
export function operationKey(callerId: string, operationId: string): string {
  return JSON.stringify([callerId, operationId]);
}

export interface PayAuthorityDeps {
  /** Which caller uses which mandate. Unknown callers are denied. */
  callers: (callerId: string) => Promise<PayCaller | null>;
  /** Gate key: signs decisions, answers and receipts, and is the mandate's on-chain gate authority. */
  instance: MessageSigner;
  spends: VoucherSpendStore;
  operations: PayOperationStore;
  /** Every decision receipt, for anchoring and for anyone to fetch. */
  saveReceipt: (receipt: DecisionReceipt) => Promise<void>;
  approvals: OwnerApprovals | null;
  /** The mandate account on Solana. Throws when the RPC cannot answer. */
  readMandate: (mandateHash: string) => Promise<{ revoked: boolean; revokedAt: number } | null>;
  clock?: () => number;
  newId: (prefix: string) => string;
  /** Our own failures, for the operator's log. The answer to pay stays a plain fail-closed deny. */
  onError?: (error: unknown) => void;
}

const PLAIN: Record<string, string> = {
  OFFER_WELL_FORMED: 'The payment offer is not valid.',
  MANDATE_SIGNATURES: "The mandate's signatures do not verify.",
  MANDATE_VALIDITY: 'The mandate is not active: it expired or has not started.',
  MANDATE_NOT_REVOKED: 'The owner revoked this mandate.',
  NETWORK_ALLOWED: 'This network is not allowed by the mandate.',
  ASSET_ALLOWED: 'This token is not allowed by the mandate.',
  RESOURCE_ALLOWED: 'This service is not allowed by the mandate.',
  PAYTO_ALLOWED: "This recipient is not on the mandate's list.",
  MAX_PER_PAYMENT: 'Above the most this agent may pay at once.',
  PRICE_LIMIT: 'The price is above the hard maximum for this service.',
  MAX_TOTAL: "Above the mandate's total budget.",
  ESCALATION_APPROVAL: "The owner's approval does not match this payment.",
};

function sha256Hex(bytes: string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The same bytes pay hashes for its replay guard: serde JSON of the ImmutableRequest. */
export function requestFingerprint(request: SpendRequest['request']): string {
  return sha256Hex(JSON.stringify({ method: request.method, url: request.url, headers: request.headers, body: request.body }));
}

function failedReason(rules: Array<{ id: string; status: string }>): string {
  const failed = rules.filter((r) => r.status === 'FAIL').map((r) => PLAIN[r.id] ?? `Rule ${r.id} failed.`);
  return failed.length > 0 ? failed.join(' ') : 'Denied by the mandate.';
}

export class PayAuthority {
  private readonly clock: () => number;

  constructor(private readonly deps: PayAuthorityDeps) {
    this.clock = deps.clock ?? (() => Math.floor(Date.now() / 1000));
  }

  /** Never throws for bad input: anything wrong is a signed or plain deny. Our own failures are `unavailable`. */
  async authorize(input: unknown): Promise<PayVerdict> {
    const parsed = spendRequestSchema.safeParse(input);
    if (!parsed.success) return this.sign(this.answer('deny', 'The request is not a valid pay.sh spend request.', null));
    const req = parsed.data;
    try {
      return await this.decide(req);
    } catch (error) {
      this.deps.onError?.(error);
      // Our own error (database, RPC, signer): fail closed, as unavailable so it is not read as a policy deny.
      return { decision: 'deny', unavailable: true, reason: 'Atlas Rail could not decide. Nothing was approved.' };
    }
  }

  private answer(decision: PayAnswer['decision'], reason: string, req: SpendRequest | null, extra: Partial<PayAnswer> = {}): PayAnswer {
    return {
      decision,
      unavailable: false,
      reason,
      operation_id: req?.operation_id ?? null,
      attempt_id: req?.attempt_id ?? null,
      caller_id: req?.caller_id ?? null,
      request_sha256: req ? requestFingerprint(req.request) : null,
      offer_hash: req ? hashCanonical(req.accepted as JsonValue) : null,
      decision_id: null,
      decision_hash: null,
      receipt_id: null,
      approval_id: null,
      answered_at: this.clock(),
      atlas: null,
      ...extra,
    };
  }

  private async sign(answer: PayAnswer): Promise<PayAnswer> {
    const { atlas: _unsigned, ...body } = answer;
    void _unsigned;
    const signature = await signDomainHash(this.deps.instance, ANSWER_DOMAIN, hashCanonical(body as unknown as JsonValue));
    return { ...answer, atlas: { key: this.deps.instance.publicKey, signature } };
  }

  private async decide(req: SpendRequest): Promise<PayVerdict> {
    const accepted = req.accepted;
    if (req.network !== DEVNET_CAIP2 || req.execution_network !== 'devnet') return this.sign(this.answer('deny', DEVNET_ONLY, req));
    if (accepted.scheme !== 'exact' || accepted.network !== req.network || accepted.asset !== req.asset || accepted.payTo !== req.recipient || String(accepted.amount) !== req.amount_atomic) {
      return this.sign(this.answer('deny', 'The request and its offer do not match.', req));
    }
    const caller = await this.deps.callers(req.caller_id);
    if (!caller) return this.sign(this.answer('deny', 'Unknown caller: no mandate is set up for it.', req));

    const mandate = caller.mandate;
    const mandateHash = hashMandate(mandate);
    const requestSha = requestFingerprint(req.request);
    const offerHash = hashCanonical(accepted as JsonValue);
    const binding = hashCanonical({ requestSha, offerHash, amount: req.amount_atomic, asset: req.asset, recipient: req.recipient, network: req.network, executionNetwork: req.execution_network } as unknown as JsonValue);
    const key = operationKey(req.caller_id, req.operation_id);

    // Same lock as the voucher ask: one decision at a time per mandate, across API processes.
    return this.deps.spends.runExclusive(`voucher:${mandateHash}`, async () => {
      const existing = await this.deps.operations.get(key);
      if (existing && existing.bindingHash !== binding) {
        return this.sign(this.answer('deny', 'This operation id was already used for a different payment.', req));
      }
      if (existing && existing.decision !== 'reject_before_execution') {
        if (existing.attemptId === req.attempt_id) return JSON.parse(existing.answer) as PayAnswer;
        if (existing.decision === 'allow') {
          return this.sign(this.answer('deny', 'This operation was already allowed once. A new attempt is never allowed again.', req));
        }
        return JSON.parse(existing.answer) as PayAnswer;
      }

      const extra = (accepted.extra ?? {}) as Record<string, unknown>;
      const offer: X402Offer = {
        x402Version: 2,
        scheme: 'exact',
        network: req.network,
        asset: req.asset,
        payTo: req.recipient,
        amount: req.amount_atomic,
        resourceUrl: req.request.url,
        feePayer: typeof extra.feePayer === 'string' ? extra.feePayer : null,
        memo: typeof extra.memo === 'string' ? extra.memo : null,
      };
      const onChain = await this.deps.readMandate(mandateHash);
      if (!onChain) return this.finish(req, key, binding, mandate, 'deny', 'The mandate is not on Solana.', null, existing);
      const now = this.clock();
      const spend = await this.deps.spends.totals(mandateHash, now, mandate.scope.limits.windowSeconds);
      const revoked = onChain.revoked ? { revokedAt: onChain.revokedAt, reason: 'revoked on-chain' } : null;

      // Waiting for the owner: approved → allow once; still waiting → same answer; anything else → deny.
      let approval: GateApproval | null = null;
      let review: OwnerReview | null = null;
      if (existing?.approvalId && this.deps.approvals) {
        const used = await this.deps.approvals.consume(existing.approvalId, { kind: 'pay', mandateHash, subjectHash: binding });
        const role = used ? OwnerApprovals.signerRole(used) : null;
        if (used?.ownerSignature && role) {
          approval = {
            id: used.id,
            offerHash: used.offerHash,
            status: 'APPROVED',
            expiresAt: used.expiresAt,
            approver: { userId: used.decidedBy ?? `wallet:${used.ownerSignature.signer}`, role },
            terms: approvalTerms(used),
            ownerSignature: used.ownerSignature,
          };
          review = { reason: used.reason, approvalId: used.id, approvedBy: used.decidedBy };
        } else {
          const record = await this.deps.approvals.get(existing.approvalId);
          if (record?.status === 'PENDING') return JSON.parse(existing.answer) as PayAnswer;
          return this.finish(req, key, binding, mandate, 'deny', 'The owner did not approve this payment.', null, existing);
        }
      }

      const context: GateContext = { now, revoked, spend, simulation: null, requireSimulation: false, approval, ...(review ? { review } : {}) };
      const result = evaluateGate(mandate, offer, context);
      let needsOwner = result.decision === 'ESCALATE' ? 'Needs owner approval.' : null;
      if (result.decision === 'ALLOW' && !approval) {
        const history = (await this.deps.spends.list(mandateHash)).map((row) => ({ amount: BigInt(row.delta), recipient: row.recipient, at: row.createdAt }));
        const flags = checkBehaviour(history, { amount: BigInt(req.amount_atomic), recipient: req.recipient, at: now });
        if (flags.length > 0) needsOwner = `Needs owner approval: ${flags.map((f) => f.reason).join(' ')}`;
      }
      const decisionRecord = buildDecisionRecord({
        id: this.deps.newId('dec'),
        organizationId: mandate.issuer.organizationId,
        mandate,
        offer,
        result,
        context,
        request: { nonce: req.attempt_id, requestedAt: now, requestHash: binding, agentPublicKey: mandate.agent.publicKey },
      });
      const signed = await signDecision(decisionRecord, this.deps.instance);

      if (result.decision === 'ALLOW' && !needsOwner) {
        // Reserved for good: pay never reports whether the payment landed, so it always counts.
        await this.deps.spends.record({
          id: this.deps.newId('vsp'),
          mandateHash,
          channelId: `pay:${req.caller_id}`,
          cumulative: req.amount_atomic,
          delta: req.amount_atomic,
          autonomous: result.kind === 'AUTONOMOUS',
          recipient: req.recipient,
          // Unique per operation: two operations may ask for the identical payment.
          messageHash: sha256Hex(`${key}\u0000${binding}`),
          createdAt: now,
        });
        return this.finish(req, key, binding, mandate, 'allow', approval ? 'Allowed once with the owner\'s approval.' : 'Allowed by the mandate.', signed, existing);
      }
      if (needsOwner) {
        if (!this.deps.approvals?.enabled) return this.finish(req, key, binding, mandate, 'deny', `${needsOwner} Owner approvals are off.`, signed, existing);
        const asked = await this.deps.approvals.request({
          kind: 'pay', mandateHash, subjectHash: binding, offerHash: hashOffer(offer), amount: req.amount_atomic,
          recipient: req.recipient, agent: mandate.agent.publicKey, reason: needsOwner.replace(/^Needs owner approval[.:]\s*/, '') || 'Above the agent\'s own limit.',
          ttlSeconds: mandate.escalation.approvalTtlSeconds,
          signers: approvalSigners(mandate),
        });
        // Nothing is reserved while the owner decides, so "rejected before execution" is true.
        return this.finish(req, key, binding, mandate, 'reject_before_execution', needsOwner, signed, existing, asked.id);
      }
      return this.finish(req, key, binding, mandate, 'deny', failedReason(result.rulesEvaluated), signed, existing);
    });
  }

  /** Signs the answer, issues its decision receipt and stores the operation. */
  private async finish(
    req: SpendRequest,
    key: string,
    binding: string,
    mandate: AgentMandate,
    decision: PayAnswer['decision'],
    reason: string,
    signed: Awaited<ReturnType<typeof signDecision>> | null,
    existing: PayOperationRecord | null,
    approvalId: string | null = null,
  ): Promise<PayAnswer> {
    const now = this.clock();
    let receiptId: string | null = null;
    if (signed) {
      const answerBody: AuthorityAnswer = {
        decision, reason, operation_id: req.operation_id, attempt_id: req.attempt_id, caller_id: req.caller_id,
        request_sha256: requestFingerprint(req.request), offer_hash: hashCanonical(req.accepted as JsonValue),
      };
      const receipt = await buildDecisionReceipt({ id: this.deps.newId('drc'), mandate, decision: signed, answer: answerBody, issuedAt: now }, this.deps.instance);
      await this.deps.saveReceipt(receipt);
      receiptId = receipt.id;
    }
    const answer = await this.sign(this.answer(decision, reason, req, {
      decision_id: signed?.record.id ?? null,
      decision_hash: signed?.decisionHash ?? null,
      receipt_id: receiptId,
      approval_id: approvalId,
    }));
    await this.deps.operations.save({
      key, callerId: req.caller_id, operationId: req.operation_id, bindingHash: binding, mandateHash: hashMandate(mandate),
      attemptId: req.attempt_id, decision, answer: JSON.stringify(answer), approvalId,
      createdAt: existing?.createdAt ?? now, updatedAt: now,
    });
    return answer;
  }
}
