import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '@atlas-rail/database';
import {
  AgentServiceError,
  ApprovalState,
  SOLANA_DEVNET_CAIP2,
  addressSchema,
  approverRoleSchema,
  baseUnitsSchema,
  verifyMandateChain,
} from '@atlas-rail/mandate';
import { verifyReceipt } from '@atlas-rail/receipt';
import { AuthGuard, RequirePermission } from '../common/auth.guard';
import { AgentFacade } from './agent.facade';
import { AgentExceptionFilter } from './agent.exceptions';

const createMandateSchema = z.object({
  label: z.string().min(1).max(120),
  agentPublicKey: addressSchema,
  mint: addressSchema,
  maxPerPayment: baseUnitsSchema,
  maxPerWindow: baseUnitsSchema,
  windowSeconds: z.number().int().min(60).max(31_536_000).default(86_400),
  maxTotal: baseUnitsSchema,
  allowedPayTo: z.array(addressSchema).min(1).max(256),
  allowedResources: z.array(z.string().min(1).max(2048)).min(1).max(256),
  escalation: z
    .object({
      thresholdBaseUnits: baseUnitsSchema,
      resources: z.array(z.string().min(1).max(2048)).max(256).default([]),
      approverRoles: z.array(approverRoleSchema).min(1).max(3).default(['OWNER', 'ADMIN', 'APPROVER']),
      approvalTtlSeconds: z.number().int().min(30).max(86_400).default(900),
    })
    .strict(),
  notBefore: z.number().int().nonnegative().optional(),
  expiresAt: z.number().int().positive().optional(),
  ttlSeconds: z.number().int().min(60).max(31_536_000).default(3 * 86_400),
  requiredApprovals: z.number().int().min(1).max(5).default(1),
});

const signSchema = z.object({ role: z.enum(['OWNER', 'APPROVER']) });
const revokeSchema = z.object({ reason: z.string().max(500).optional() });
const decideSchema = z.object({ comment: z.string().max(500).optional() });

@ApiTags('Agent Mandates')
@UseGuards(AuthGuard)
@UseFilters(AgentExceptionFilter)
@Controller('v1/agent')
export class AgentController {
  constructor(private readonly agent: AgentFacade) {}

  /* ---- instance ------------------------------------------------------------------------------ */

  @Get('instance')
  @RequirePermission('mandate:read')
  @ApiOperation({ summary: 'Atlas Rail instance attestation key and network (pin this key when verifying receipts)' })
  instance() {
    return { publicKey: this.agent.instanceSigner.publicKey, network: SOLANA_DEVNET_CAIP2, environment: 'DEVNET_ONLY' };
  }

  /* ---- mandates ------------------------------------------------------------------------------ */

  @Get('mandates')
  @RequirePermission('mandate:read')
  @ApiOperation({ summary: 'List agent mandates with live status and spend' })
  async listMandates(@Req() req: any) {
    const records = await this.agent.store.mandates.list(req.user.organizationId);
    return Promise.all(records.map((r) => this.agent.presentMandate(r)));
  }

  @Post('mandates')
  @RequirePermission('mandate:create')
  @ApiOperation({ summary: 'Draft a new agent mandate (unsigned until owner, approver and agent sign)' })
  async createMandate(@Req() req: any, @Body() body: unknown) {
    const input = createMandateSchema.parse(body);
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: req.user.organizationId } });
    const now = this.agent.now();
    const notBefore = input.notBefore ?? now - 30; // small backdate so clock skew never makes a fresh mandate "not yet valid"
    const record = await this.agent.lifecycle.createDraft(req.user.organizationId, req.user.userId, {
      issuer: { organizationId: req.user.organizationId, name: org.name },
      agent: { publicKey: input.agentPublicKey, label: input.label },
      delegation: { requiredApprovals: input.requiredApprovals },
      scope: {
        allowedNetworks: [SOLANA_DEVNET_CAIP2],
        allowedAssets: [input.mint],
        allowedPayTo: input.allowedPayTo,
        allowedResources: input.allowedResources,
        limits: {
          mint: input.mint,
          maxPerPayment: input.maxPerPayment,
          maxPerWindow: input.maxPerWindow,
          windowSeconds: input.windowSeconds,
          maxTotal: input.maxTotal,
        },
      },
      escalation: input.escalation,
      notBefore,
      expiresAt: input.expiresAt ?? notBefore + input.ttlSeconds,
    });
    return this.agent.presentMandate(record);
  }

  @Get('mandates/:mandateId')
  @RequirePermission('mandate:read')
  @ApiOperation({ summary: 'Mandate detail: document, delegation chain, verification, spend' })
  async getMandate(@Req() req: any, @Param('mandateId') mandateId: string) {
    const record = await this.agent.store.mandates.get(req.user.organizationId, mandateId);
    if (!record) throw new AgentServiceError('NOT_FOUND', 'Mandate not found');
    return this.agent.presentMandate(record);
  }

  @Post('mandates/:mandateId/sign')
  @RequirePermission('mandate:sign')
  @ApiOperation({ summary: 'Sign the mandate as OWNER (first) or independent APPROVER, with your devnet signing key' })
  async signMandate(@Req() req: any, @Param('mandateId') mandateId: string, @Body() body: unknown) {
    const { role } = signSchema.parse(body);
    const userRole: string = req.user.role;
    const allowed = role === 'OWNER' ? ['OWNER', 'ADMIN'] : ['OWNER', 'ADMIN', 'APPROVER'];
    if (!allowed.includes(userRole)) {
      throw new ForbiddenException(`Role ${userRole} cannot sign a mandate as ${role}`);
    }
    if (req.user.isApiKey) throw new ForbiddenException('Mandates are signed by people, not API keys');
    const signer = await this.agent.userSigner(req.user.userId);
    const record = await this.agent.lifecycle.sign(req.user.organizationId, mandateId, {
      role,
      signer,
      userId: req.user.userId,
    });
    return this.agent.presentMandate(record);
  }

  @Post('mandates/:mandateId/revoke')
  @RequirePermission('mandate:revoke')
  @ApiOperation({ summary: 'Revoke a mandate. Effective on the very next gate evaluation.' })
  async revokeMandate(@Req() req: any, @Param('mandateId') mandateId: string, @Body() body: unknown) {
    const { reason } = revokeSchema.parse(body ?? {});
    const record = await this.agent.lifecycle.revoke(req.user.organizationId, mandateId, {
      userId: req.user.userId,
      reason: reason ?? null,
    });
    return this.agent.presentMandate(record);
  }

  @Post('mandates/verify')
  @RequirePermission('mandate:read')
  @ApiOperation({ summary: 'Verify any mandate document offline-style (schema, chain, signatures)' })
  verifyDocument(@Body() body: unknown) {
    return verifyMandateChain(body);
  }

  /* ---- decisions ----------------------------------------------------------------------------- */

  @Get('decisions')
  @RequirePermission('mandate:read')
  @ApiOperation({ summary: 'Recent gate decisions (ALLOW / DENY / ESCALATE) with every rule evaluated' })
  async listDecisions(@Req() req: any, @Query('limit') limit?: string, @Query('mandateId') mandateId?: string) {
    const rows = await this.agent.store.decisions.list(req.user.organizationId, {
      limit: Math.min(Number(limit) || 50, 200),
      mandateId,
    });
    return rows.map((row) => this.agent.presentDecision(row));
  }

  /**
   * Server-sent events: the last 25 decisions, then every new one within ~1s. Polling the append-only
   * table (rather than an in-process emitter) keeps it correct across API instances and restarts.
   */
  @Get('decisions/stream')
  @RequirePermission('mandate:read')
  @ApiOperation({ summary: 'Live decision feed (text/event-stream)' })
  async streamDecisions(@Req() req: any, @Res() reply: FastifyReply) {
    const organizationId: string = req.user.organizationId;
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'access-control-allow-origin': '*',
    });
    const send = (event: string, data: unknown) => raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    const seen = new Set<string>();
    let cursor = this.agent.now() - 3600;
    const initial = (await this.agent.store.decisions.list(organizationId, { limit: 25 })).reverse();
    for (const row of initial) {
      seen.add(row.signed.record.id);
      cursor = Math.max(cursor, row.createdAt);
      send('decision', this.agent.presentDecision(row));
    }
    send('ready', { at: this.agent.now() });

    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const fresh = (await this.agent.store.decisions.list(organizationId, { limit: 50, afterCreatedAt: cursor })).reverse();
        for (const row of fresh) {
          if (seen.has(row.signed.record.id)) continue;
          seen.add(row.signed.record.id);
          cursor = Math.max(cursor, row.createdAt);
          send('decision', this.agent.presentDecision(row));
        }
        if (seen.size > 2000) seen.clear();
        const pending = await this.agent.store.approvals.list(organizationId, { status: 'PENDING', limit: 50 });
        send('approvals', { pending: pending.length });
      } catch {
        // a transient DB error must not kill the stream; the next tick retries
      } finally {
        busy = false;
      }
    };
    const poll = setInterval(() => void tick(), 1000);
    const heartbeat = setInterval(() => raw.write(': keep-alive\n\n'), 15_000);
    req.raw.on('close', () => {
      clearInterval(poll);
      clearInterval(heartbeat);
    });
  }

  @Get('decisions/:decisionId')
  @RequirePermission('mandate:read')
  @ApiOperation({ summary: 'Full signed decision record' })
  async getDecision(@Req() req: any, @Param('decisionId') decisionId: string) {
    const row = await this.agent.store.decisions.get(req.user.organizationId, decisionId);
    if (!row) throw new AgentServiceError('NOT_FOUND', 'Decision not found');
    return { ...this.agent.presentDecision(row), signed: row.signed, authorization: row.authorization };
  }

  /* ---- approvals ----------------------------------------------------------------------------- */

  @Get('approvals')
  @RequirePermission('approval:read')
  @ApiOperation({ summary: 'Escalations awaiting (or having received) a human decision' })
  async listApprovals(@Req() req: any, @Query('status') status?: string, @Query('limit') limit?: string) {
    const state = status && ['PENDING', 'APPROVED', 'DENIED', 'EXPIRED', 'CONSUMED'].includes(status) ? (status as ApprovalState) : undefined;
    const rows = await this.agent.store.approvals.list(req.user.organizationId, { status: state, limit: Math.min(Number(limit) || 50, 200) });
    const now = this.agent.now();
    const mandates = new Map<string, string>();
    for (const row of rows) {
      if (!mandates.has(row.mandateId)) {
        const m = await this.agent.store.mandates.get(req.user.organizationId, row.mandateId);
        mandates.set(row.mandateId, m?.mandate.agent.label ?? row.mandateId);
      }
    }
    return rows.map((row) => ({
      ...row,
      status: row.status === 'PENDING' && now >= row.expiresAt ? 'EXPIRED' : row.status,
      agentLabel: mandates.get(row.mandateId),
    }));
  }

  @Post('approvals/:approvalId/approve')
  @RequirePermission('approval:decide')
  @ApiOperation({ summary: 'Approve an escalated agent payment (bound to that exact offer)' })
  async approve(@Req() req: any, @Param('approvalId') approvalId: string, @Body() body: unknown) {
    return this.decide(req, approvalId, true, body);
  }

  @Post('approvals/:approvalId/deny')
  @RequirePermission('approval:decide')
  @ApiOperation({ summary: 'Deny an escalated agent payment' })
  async deny(@Req() req: any, @Param('approvalId') approvalId: string, @Body() body: unknown) {
    return this.decide(req, approvalId, false, body);
  }

  private async decide(req: any, approvalId: string, approve: boolean, body: unknown) {
    const { comment } = decideSchema.parse(body ?? {});
    if (req.user.isApiKey) throw new ForbiddenException('Approvals are decided by people, not API keys');
    return this.agent.lifecycle.decideApproval(req.user.organizationId, approvalId, {
      approve,
      approver: { userId: req.user.userId, role: req.user.role },
      comment: comment ?? null,
    });
  }

  /* ---- receipts ------------------------------------------------------------------------------ */

  @Get('receipts')
  @RequirePermission('receipt:read')
  @ApiOperation({ summary: 'Bound receipts, newest first' })
  async listReceipts(@Req() req: any, @Query('limit') limit?: string) {
    const rows = await this.agent.receipts.list(req.user.organizationId, { limit: Math.min(Number(limit) || 50, 200) });
    return rows.map(({ receipt }) => ({
      id: receipt.id,
      receiptHash: receipt.receiptHash,
      mandateId: receipt.mandate.id,
      agentLabel: receipt.mandate.agent.label,
      decisionId: receipt.decision.record.id,
      decisionKind: receipt.decision.record.kind,
      txSignature: receipt.settlement.txSignature,
      amount: receipt.offer.amount,
      asset: receipt.offer.asset,
      payTo: receipt.offer.payTo,
      resourceUrl: receipt.offer.resourceUrl,
      issuedAt: receipt.issuedAt,
      anchored: Boolean(receipt.anchor),
      anchorTx: receipt.anchor?.txSignature ?? null,
    }));
  }

  @Get('receipts/:receiptId')
  @RequirePermission('receipt:read')
  @ApiOperation({ summary: 'The full self-contained receipt bundle (verify offline with `atlas verify`)' })
  async getReceipt(@Req() req: any, @Param('receiptId') receiptId: string) {
    const row = await this.agent.receipts.get(req.user.organizationId, receiptId);
    if (!row) throw new AgentServiceError('NOT_FOUND', 'Receipt not found');
    return row.receipt;
  }

  @Post('receipts/:receiptId/verify')
  @RequirePermission('receipt:read')
  @ApiOperation({ summary: 'Run the same verification as `atlas verify` (signatures, chain, scope, Merkle, on-chain anchor)' })
  async verifyStoredReceipt(@Req() req: any, @Param('receiptId') receiptId: string) {
    const row = await this.agent.receipts.get(req.user.organizationId, receiptId);
    if (!row) throw new AgentServiceError('NOT_FOUND', 'Receipt not found');
    return verifyReceipt(row.receipt, {
      chain: this.agent.chain,
      trustedInstanceKeys: [this.agent.instanceSigner.publicKey],
      checkSettlementOnChain: true,
    });
  }

  @Post('anchor')
  @RequirePermission('receipt:anchor')
  @ApiOperation({ summary: 'Anchor all pending receipts now (a Merkle root memo on Solana devnet)' })
  async anchorNow() {
    const result = await this.agent.anchorService.run();
    return result ?? { batch: null, anchored: 0 };
  }

  @Get('anchor/batches')
  @RequirePermission('receipt:read')
  @ApiOperation({ summary: 'Recent anchor batches' })
  batches() {
    return this.agent.receipts.listBatches(20);
  }
}
