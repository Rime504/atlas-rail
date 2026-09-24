import { ZodError } from 'zod';
import { MessageSigner } from '../crypto';
import { CreateMandateInput, MandateSigningError, createMandate, hashMandate, signMandate, verifyMandateChain } from '../mandate';
import { DelegationRole } from '../schema';
import {
  AgentEvent,
  AgentEventSink,
  AgentServiceError,
  AgentStore,
  ApprovalRecord,
  MandateRecord,
} from './ports';

export type EffectiveMandateStatus = 'DRAFT' | 'ACTIVE' | 'EXPIRED' | 'NOT_YET_VALID' | 'REVOKED';

/** Status as the console shows it: revocation and the validity window are applied on top of the stored state. */
export function effectiveMandateStatus(record: MandateRecord, now: number): EffectiveMandateStatus {
  if (record.revocation) return 'REVOKED';
  if (record.status === 'DRAFT') return 'DRAFT';
  if (now >= record.mandate.expiresAt) return 'EXPIRED';
  if (now < record.mandate.notBefore) return 'NOT_YET_VALID';
  return 'ACTIVE';
}

export interface LifecycleOptions {
  store: AgentStore;
  clock: () => number;
  notify?: AgentEventSink;
}

export type CreateDraftInput = Omit<CreateMandateInput, 'id' | 'nonce'>;

/**
 * Mandate and approval lifecycle. Callers (the API) are responsible for authenticating the actor and
 * checking RBAC; this service enforces the invariants that must hold regardless of caller: chain
 * order, independent approvers (distinct keys AND distinct users), immediate revocation, and
 * approval eligibility.
 */
export class MandateLifecycleService {
  constructor(private readonly deps: LifecycleOptions) {}

  async createDraft(organizationId: string, createdBy: string | null, input: CreateDraftInput): Promise<MandateRecord> {
    const { store, clock } = this.deps;
    let mandate;
    try {
      mandate = createMandate({ ...input, id: undefined, nonce: undefined, issuer: { ...input.issuer, organizationId } });
    } catch (error) {
      if (error instanceof ZodError) {
        const issue = error.issues[0];
        throw new AgentServiceError('INVALID_INPUT', `${issue.path.join('.') || 'mandate'}: ${issue.message}`);
      }
      throw error;
    }
    // Ids come from the caller's generator so the demo and tests can be deterministic; the schema fixes the format.
    if (await store.mandates.nonceExists(organizationId, mandate.nonce, mandate.id)) {
      throw new AgentServiceError('NONCE_REPLAY', 'A mandate with this nonce already exists');
    }
    const record: MandateRecord = {
      organizationId,
      mandate,
      mandateHash: hashMandate(mandate),
      status: 'DRAFT',
      createdBy,
      createdAt: clock(),
      signers: [],
      revocation: null,
    };
    await store.mandates.insert(record);
    await this.audit(organizationId, createdBy, 'AGENT_MANDATE_CREATED', record.mandate.id, { mandateHash: record.mandateHash });
    await this.emit({ type: 'agent.mandate.created', organizationId, payload: { mandateId: mandate.id, mandateHash: record.mandateHash } });
    return record;
  }

  async sign(
    organizationId: string,
    mandateId: string,
    params: { role: DelegationRole; signer: MessageSigner; userId: string | null },
  ): Promise<MandateRecord> {
    const { store, clock } = this.deps;
    return store.runExclusive(`mandate:${mandateId}`, async () => {
      const record = await store.mandates.get(organizationId, mandateId);
      if (!record) throw new AgentServiceError('NOT_FOUND', 'Mandate not found');
      if (record.revocation) throw new AgentServiceError('INVALID_STATE', 'Mandate is revoked');
      if (record.status === 'ACTIVE') throw new AgentServiceError('INVALID_STATE', 'Mandate is already fully signed');

      if (params.userId && record.signers.some((s) => s.userId === params.userId)) {
        throw new AgentServiceError('FORBIDDEN', 'The same user cannot sign more than once: approvers must be independent of the issuer');
      }

      let signed;
      try {
        signed = await signMandate(record.mandate, { role: params.role, signer: params.signer });
      } catch (error) {
        if (error instanceof MandateSigningError) throw new AgentServiceError('INVALID_STATE', error.message);
        throw error;
      }

      const next: MandateRecord = {
        ...record,
        mandate: signed,
        signers: [...record.signers, { role: params.role, publicKey: params.signer.publicKey, userId: params.userId, signedAt: clock() }],
      };
      if (params.role === 'AGENT') {
        const verification = verifyMandateChain(signed);
        if (!verification.valid) throw new AgentServiceError('INVALID_STATE', verification.errors[0]);
        next.status = 'ACTIVE';
      }
      await store.mandates.update(next);
      await this.audit(organizationId, params.userId, `AGENT_MANDATE_SIGNED_${params.role}`, mandateId, {
        publicKey: params.signer.publicKey,
      });
      if (next.status === 'ACTIVE') {
        await this.emit({ type: 'agent.mandate.activated', organizationId, payload: { mandateId, mandateHash: next.mandateHash } });
      }
      return next;
    });
  }

  /** Revokes a mandate. Takes effect on the very next gate evaluation. Idempotent. */
  async revoke(
    organizationId: string,
    mandateId: string,
    params: { userId: string | null; reason: string | null },
  ): Promise<MandateRecord> {
    const { store, clock } = this.deps;
    return store.runExclusive(`mandate:${mandateId}`, async () => {
      const record = await store.mandates.get(organizationId, mandateId);
      if (!record) throw new AgentServiceError('NOT_FOUND', 'Mandate not found');
      if (record.revocation) return record;
      const next: MandateRecord = {
        ...record,
        status: 'REVOKED',
        revocation: { revokedAt: clock(), reason: params.reason, revokedBy: params.userId },
      };
      await store.mandates.update(next);
      await this.audit(organizationId, params.userId, 'AGENT_MANDATE_REVOKED', mandateId, { reason: params.reason });
      await this.emit({ type: 'agent.mandate.revoked', organizationId, payload: { mandateId, reason: params.reason } });
      return next;
    });
  }

  async decideApproval(
    organizationId: string,
    approvalId: string,
    params: { approve: boolean; approver: { userId: string; role: string }; comment: string | null },
  ): Promise<ApprovalRecord> {
    const { store, clock } = this.deps;
    const approval = await store.approvals.get(organizationId, approvalId);
    if (!approval) throw new AgentServiceError('NOT_FOUND', 'Approval not found');
    const now = clock();
    if (approval.status === 'PENDING' && now >= approval.expiresAt) {
      const expired = { ...approval, status: 'EXPIRED' as const };
      await store.approvals.update(expired);
      throw new AgentServiceError('INVALID_STATE', 'Approval request has expired');
    }
    if (approval.status !== 'PENDING') {
      throw new AgentServiceError('INVALID_STATE', `Approval is already ${approval.status}`);
    }
    if (!approval.requiredRoles.includes(params.approver.role)) {
      throw new AgentServiceError('FORBIDDEN', `Role ${params.approver.role} may not decide this approval (allowed: ${approval.requiredRoles.join(', ')})`);
    }
    const next: ApprovalRecord = {
      ...approval,
      status: params.approve ? 'APPROVED' : 'DENIED',
      decidedAt: now,
      decidedBy: params.approver,
      comment: params.comment,
    };
    await store.approvals.update(next);
    await this.audit(organizationId, params.approver.userId, params.approve ? 'AGENT_APPROVAL_APPROVED' : 'AGENT_APPROVAL_DENIED', approval.mandateId, {
      approvalId,
      decisionId: approval.decisionId,
      offerHash: approval.offerHash,
      comment: params.comment,
    });
    await this.emit({
      type: 'agent.approval.decided',
      organizationId,
      payload: { approvalId, mandateId: approval.mandateId, approved: params.approve },
    });
    return next;
  }

  private async audit(
    organizationId: string,
    actorId: string | null,
    action: string,
    resourceId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.deps.store.audit.append({
      organizationId,
      actorType: actorId ? 'USER' : 'SYSTEM',
      actorId,
      action,
      resourceType: 'AGENT_MANDATE',
      resourceId,
      metadata,
      createdAt: this.deps.clock(),
    });
  }

  private async emit(event: AgentEvent): Promise<void> {
    try {
      await this.deps.notify?.(event);
    } catch {
      // best-effort
    }
  }
}

