import { Body, Controller, Get, Param, Post, Req, UseFilters, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  AgentServiceError,
  SignedAgentGateRequest,
  delegationLinkSchema,
  x402OfferSchema,
} from '@atlas-rail/mandate';
import { AuthGuard, RequirePermission } from '../common/auth.guard';
import { AgentFacade } from './agent.facade';
import { AgentExceptionFilter } from './agent.exceptions';

const gateRequestSchema = z.object({
  type: z.literal('atlasrail.gate-request'),
  version: z.literal('0.1'),
  mandateId: z.string().min(1).max(64),
  offer: x402OfferSchema,
  transactionBase64: z.string().max(4096).nullable(),
  approvalId: z.string().max(64).nullable(),
  nonce: z.string().min(1).max(128),
  requestedAt: z.number().int().nonnegative(),
  agentPublicKey: z.string().min(32).max(44),
  signature: z.string().min(64).max(90),
});

const receiptSchema = z.object({
  decisionId: z.string().min(1).max(64),
  txSignature: z.string().min(64).max(100),
  response: z.object({
    status: z.number().int().min(100).max(599),
    bodySha256: z.string().regex(/^[0-9a-f]{64}$/),
    contentType: z.string().max(200).nullable(),
  }),
});

const acceptSchema = z.object({ link: delegationLinkSchema });

/**
 * The agent-facing surface: what `@atlas-rail/x402` talks to. Authenticated with an organisation
 * API key (role DEVELOPER, permission `agent:gate`); the request itself is additionally signed by
 * the agent's own key, so a leaked API key alone cannot act as the agent.
 */
@ApiTags('Agent Gate')
@UseGuards(AuthGuard)
@UseFilters(AgentExceptionFilter)
@Controller('v1/agent/gate')
export class AgentGateController {
  constructor(private readonly agent: AgentFacade) {}

  @Post('evaluate')
  @RequirePermission('agent:gate')
  @ApiOperation({ summary: 'Ask the mandate gate whether a specific x402 payment (and its exact transaction) is allowed' })
  async evaluate(@Req() req: any, @Body() body: unknown) {
    const request = gateRequestSchema.parse(body) as SignedAgentGateRequest;
    const outcome = await this.agent.gate.evaluate(req.user.organizationId, request);
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

  @Get('approvals/:approvalId')
  @RequirePermission('agent:gate')
  @ApiOperation({ summary: 'Poll an escalation for a human decision' })
  async approval(@Req() req: any, @Param('approvalId') approvalId: string) {
    const approval = await this.agent.store.approvals.get(req.user.organizationId, approvalId);
    if (!approval) throw new AgentServiceError('NOT_FOUND', 'Approval not found');
    const expired = approval.status === 'PENDING' && this.agent.now() >= approval.expiresAt;
    return {
      id: approval.id,
      status: expired ? 'EXPIRED' : approval.status,
      expiresAt: approval.expiresAt,
      requiredRoles: approval.requiredRoles,
      comment: approval.comment,
    };
  }

  @Post('receipts')
  @RequirePermission('agent:gate')
  @ApiOperation({ summary: 'Report a settled payment; returns the bound receipt once the settlement is verified on-chain' })
  async receipt(@Req() req: any, @Body() body: unknown) {
    return this.agent.receiptService.issue(req.user.organizationId, receiptSchema.parse(body));
  }

  @Get('mandates/:mandateId')
  @RequirePermission('agent:gate')
  @ApiOperation({ summary: 'Fetch a mandate (e.g. to compute the agent acceptance link)' })
  async mandate(@Req() req: any, @Param('mandateId') mandateId: string) {
    const record = await this.agent.store.mandates.get(req.user.organizationId, mandateId);
    if (!record) throw new AgentServiceError('NOT_FOUND', 'Mandate not found');
    return { id: record.mandate.id, status: record.status, mandate: record.mandate, mandateHash: record.mandateHash };
  }

  @Post('mandates/:mandateId/accept')
  @RequirePermission('agent:gate')
  @ApiOperation({ summary: 'Attach the agent’s own AGENT link (signed by the agent key) and activate the mandate' })
  async accept(@Req() req: any, @Param('mandateId') mandateId: string, @Body() body: unknown) {
    const { link } = acceptSchema.parse(body);
    const record = await this.agent.lifecycle.attachAgentLink(req.user.organizationId, mandateId, link);
    return this.agent.presentMandate(record);
  }
}
