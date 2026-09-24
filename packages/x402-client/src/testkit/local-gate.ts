import { AgentGateService, AgentServiceError, AgentStore, SignedAgentGateRequest } from '@atlas-rail/mandate';
import { BoundReceipt, ReceiptService } from '@atlas-rail/receipt';
import { GateApprovalView, GateClient, GateResponse, IssueReceiptRequest } from '../gate-client';

/** {@link GateClient} that talks to in-process services instead of the HTTP API. For tests and hermetic demos. */
export class LocalGateClient implements GateClient {
  constructor(
    private readonly deps: {
      organizationId: string;
      gate: AgentGateService;
      store: AgentStore;
      receiptService: ReceiptService;
    },
  ) {}

  async evaluate(request: SignedAgentGateRequest): Promise<GateResponse> {
    const outcome = await this.deps.gate.evaluate(this.deps.organizationId, request);
    return {
      decision: outcome.decision,
      authorization: outcome.authorization,
      approval: outcome.approval
        ? {
            id: outcome.approval.id,
            status: outcome.approval.status,
            expiresAt: outcome.approval.expiresAt,
            requiredRoles: outcome.approval.requiredRoles,
          }
        : null,
      replayed: outcome.replayed,
    };
  }

  async getApproval(approvalId: string): Promise<GateApprovalView> {
    const approval = await this.deps.store.approvals.get(this.deps.organizationId, approvalId);
    if (!approval) throw new AgentServiceError('NOT_FOUND', 'Approval not found');
    return {
      id: approval.id,
      status: approval.status,
      expiresAt: approval.expiresAt,
      requiredRoles: approval.requiredRoles,
      comment: approval.comment,
    };
  }

  issueReceipt(input: IssueReceiptRequest): Promise<BoundReceipt> {
    return this.deps.receiptService.issue(this.deps.organizationId, input);
  }
}
