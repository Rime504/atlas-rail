import {
  GateAuthorization,
  SignedAgentGateRequest,
  SignedDecision,
  buildDecisionRecord,
  createGateAuthorization,
  hashGateRequest,
  signDecision,
  verifyGateRequestSignature,
} from '../decision';
import { GateApproval, GateContext, GateResult, GateSimulation, evaluateGate } from '../gate';
import { MessageSigner } from '../crypto';
import { hashOffer } from '../offer';
import {
  AgentEventSink,
  AgentServiceError,
  AgentStore,
  ApprovalRecord,
  MandateRecord,
  PaymentSimulator,
  StoredDecision,
} from './ports';

export interface GateServiceOptions {
  store: AgentStore;
  /** Signs decisions and gate authorisations (the Atlas Rail instance attestation key). */
  instanceSigner: MessageSigner;
  /** Simulates the exact transaction the agent will sign. Required unless `requireSimulation` is false. */
  simulator: PaymentSimulator | null;
  /** Epoch seconds. Injected so tests control time. */
  clock: () => number;
  newId: (prefix: string) => string;
  notify?: AgentEventSink;
  requireSimulation?: boolean;
  /** Maximum difference between the agent's `requestedAt` and the server clock. */
  requestSkewSeconds?: number;
  /** How long a reserved (unsettled) payment keeps counting against the caps. */
  reservationTtlSeconds?: number;
  /** How long a gate authorisation stays usable by the wallet. */
  authorizationTtlSeconds?: number;
}

export interface GateOutcome {
  decision: SignedDecision;
  authorization: GateAuthorization | null;
  approval: ApprovalRecord | null;
  /** True when this response is a replay of an earlier identical request. */
  replayed: boolean;
}

export class AgentGateService {
  private readonly requireSimulation: boolean;
  private readonly requestSkewSeconds: number;
  private readonly reservationTtlSeconds: number;
  private readonly authorizationTtlSeconds: number;

  constructor(private readonly deps: GateServiceOptions) {
    this.requireSimulation = deps.requireSimulation ?? true;
    this.requestSkewSeconds = deps.requestSkewSeconds ?? 120;
    this.reservationTtlSeconds = deps.reservationTtlSeconds ?? 300;
    this.authorizationTtlSeconds = deps.authorizationTtlSeconds ?? 120;
    if (this.requireSimulation && !deps.simulator) {
      throw new Error('AgentGateService requires a PaymentSimulator when simulation is required');
    }
  }

  /**
   * Evaluates one agent payment request. The agent proves it is the mandate's agent by signing the
   * request; the outcome is idempotent on (mandate, nonce); evaluation for one mandate is
   * serialised so concurrent requests cannot jointly overspend a cap.
   */
  async evaluate(organizationId: string, request: SignedAgentGateRequest): Promise<GateOutcome> {
    const { store, clock } = this.deps;

    if (!verifyGateRequestSignature(request)) {
      throw new AgentServiceError('BAD_SIGNATURE', 'Gate request signature does not verify');
    }
    const record = await store.mandates.get(organizationId, request.mandateId);
    if (!record) throw new AgentServiceError('NOT_FOUND', 'Mandate not found');
    if (record.mandate.agent.publicKey !== request.agentPublicKey) {
      throw new AgentServiceError('AGENT_MISMATCH', 'Request was not signed by the agent named in the mandate');
    }
    const now = clock();
    if (Math.abs(now - request.requestedAt) > this.requestSkewSeconds) {
      throw new AgentServiceError('CLOCK_SKEW', `requestedAt is more than ${this.requestSkewSeconds}s away from the server clock`);
    }
    const { agentPublicKey: _key, signature: _sig, ...body } = request;
    void _key;
    void _sig;
    const requestHash = hashGateRequest(body);

    return store.runExclusive(`mandate:${request.mandateId}`, async () => {
      const existing = await store.decisions.findByRequest(organizationId, request.mandateId, request.nonce);
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new AgentServiceError('NONCE_REUSED', 'This nonce was already used with a different request');
        }
        const approval = existing.approvalId ? await store.approvals.get(organizationId, existing.approvalId) : null;
        return { decision: existing.signed, authorization: existing.authorization, approval, replayed: true };
      }
      return this.evaluateFresh(organizationId, record, request, requestHash, now);
    });
  }

  private async evaluateFresh(
    organizationId: string,
    record: MandateRecord,
    request: SignedAgentGateRequest,
    requestHash: string,
    now: number,
  ): Promise<GateOutcome> {
    const { store } = this.deps;
    const mandate = record.mandate;
    const offer = request.offer;

    const approvalRecord = request.approvalId ? await store.approvals.get(organizationId, request.approvalId) : null;
    const approval = this.toGateApproval(approvalRecord, record, now);

    const limits = mandate.scope.limits;
    const spend = await store.spend.totals(mandate.id, now, limits.windowSeconds, this.reservationTtlSeconds);
    const baseContext: GateContext = {
      now,
      revoked: record.revocation ? { revokedAt: record.revocation.revokedAt, reason: record.revocation.reason } : null,
      spend,
      simulation: null,
      requireSimulation: this.requireSimulation,
      approval,
    };

    // Pass 1: everything that does not need the transaction. Saves an RPC round trip for clear denials.
    const prelim = evaluateGate(mandate, offer, { ...baseContext, requireSimulation: false });
    let simulation: GateSimulation | null = null;
    if (prelim.decision !== 'DENY' && request.transactionBase64 && this.deps.simulator) {
      simulation = await this.deps.simulator.simulate({
        transactionBase64: request.transactionBase64,
        offer,
        payer: mandate.agent.publicKey,
      });
    }

    // Pass 2: the recorded decision, including the simulation of the exact transaction.
    const context: GateContext = { ...baseContext, simulation };
    const result = evaluateGate(mandate, offer, context);

    const decisionId = this.deps.newId('dec');
    const decisionRecord = buildDecisionRecord({
      id: decisionId,
      organizationId,
      mandate,
      offer,
      result,
      context,
      request: { nonce: request.nonce, requestedAt: request.requestedAt, requestHash, agentPublicKey: request.agentPublicKey },
    });
    const signed = await signDecision(decisionRecord, this.deps.instanceSigner);

    let authorization: GateAuthorization | null = null;
    let createdApproval: ApprovalRecord | null = null;

    if (result.decision === 'ALLOW') {
      if (!simulation) throw new Error('invariant: ALLOW without a simulation while simulation is required');
      authorization = await createGateAuthorization(
        {
          type: 'atlasrail.gate-authorization',
          version: '0.1',
          decisionId,
          decisionHash: signed.decisionHash,
          mandateHash: record.mandateHash,
          offerHash: hashOffer(offer),
          txMessageHash: simulation.txMessageHash,
          agentPublicKey: request.agentPublicKey,
          notBefore: now,
          notAfter: now + this.authorizationTtlSeconds,
        },
        this.deps.instanceSigner,
      );
      if (result.kind === 'APPROVED' && request.approvalId) {
        const consumed = await store.approvals.consume(organizationId, request.approvalId);
        if (!consumed) throw new AgentServiceError('INVALID_STATE', 'Approval was already used');
      }
      await store.spend.reserve({
        id: this.deps.newId('spd'),
        organizationId,
        mandateId: mandate.id,
        decisionId,
        amountBaseUnits: offer.amount,
        autonomous: result.kind === 'AUTONOMOUS',
        status: 'RESERVED',
        txSignature: null,
        createdAt: now,
      });
    } else if (result.decision === 'ESCALATE') {
      createdApproval = {
        id: this.deps.newId('apr'),
        organizationId,
        mandateId: mandate.id,
        decisionId,
        offerHash: hashOffer(offer),
        offer,
        status: 'PENDING',
        requiredRoles: result.requiredApproverRoles,
        requestedAt: now,
        expiresAt: now + mandate.escalation.approvalTtlSeconds,
        decidedAt: null,
        decidedBy: null,
        comment: null,
        escalationRules: result.escalationRules,
      };
      await store.approvals.create(createdApproval);
    }

    const stored: StoredDecision = {
      organizationId,
      signed,
      requestHash,
      authorization,
      approvalId: createdApproval?.id ?? request.approvalId ?? null,
      createdAt: now,
    };
    await store.decisions.insert(stored);
    await store.audit.append({
      organizationId,
      actorType: 'AGENT',
      actorId: request.agentPublicKey,
      action: `AGENT_DECISION_${result.decision}`,
      resourceType: 'AGENT_MANDATE',
      resourceId: mandate.id,
      metadata: {
        decisionId,
        decisionHash: signed.decisionHash,
        kind: result.kind,
        failedRule: result.failedRule,
        failedRules: result.failedRules,
        amountBaseUnits: offer.amount,
        payTo: offer.payTo,
        resourceUrl: offer.resourceUrl,
      },
      createdAt: now,
    });

    await this.emit(organizationId, result, decisionId, mandate.id, offer.amount, createdApproval);

    return { decision: signed, authorization, approval: createdApproval, replayed: false };
  }

  private toGateApproval(approval: ApprovalRecord | null, record: MandateRecord, now: number): GateApproval | null {
    if (!approval || approval.mandateId !== record.mandate.id) return null;
    const status = approval.status === 'PENDING' && now >= approval.expiresAt ? 'EXPIRED' : approval.status;
    return {
      id: approval.id,
      offerHash: approval.offerHash,
      status,
      expiresAt: approval.expiresAt,
      approver: approval.decidedBy,
    };
  }

  private async emit(
    organizationId: string,
    result: GateResult,
    decisionId: string,
    mandateId: string,
    amountBaseUnits: string,
    approval: ApprovalRecord | null,
  ): Promise<void> {
    const notify = this.deps.notify;
    if (!notify) return;
    try {
      const type = `agent.decision.${result.decision.toLowerCase()}` as 'agent.decision.allow';
      await notify({
        type,
        organizationId,
        payload: { decisionId, mandateId, decision: result.decision, kind: result.kind, failedRule: result.failedRule, amountBaseUnits },
      });
      if (approval) {
        await notify({
          type: 'agent.approval.requested',
          organizationId,
          payload: { approvalId: approval.id, mandateId, decisionId, amountBaseUnits, expiresAt: approval.expiresAt, requiredRoles: approval.requiredRoles },
        });
      }
    } catch {
      // Notifications are best-effort; a webhook or queue outage must never change or block a decision.
    }
  }
}
