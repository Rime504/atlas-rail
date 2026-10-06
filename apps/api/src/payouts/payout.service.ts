import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { prisma, generateUlid, PayoutStatus, runExclusive } from '@atlas-rail/database';
import { evaluatePolicy, assertValidTransition, PolicyRules, addBaseUnits } from '@atlas-rail/domain';
import { WEBHOOK_EVENT_TYPES } from '@atlas-rail/config';
import { QueueService } from '../common/queue.service';

/** Statuses that still count against daily/monthly limits (in-flight + confirmed). */
const ROLLING_SPEND_STATUSES: PayoutStatus[] = [
  PayoutStatus.PENDING_APPROVAL,
  PayoutStatus.APPROVED,
  PayoutStatus.QUEUED_FOR_EXECUTION,
  PayoutStatus.SIMULATING,
  PayoutStatus.READY_TO_SIGN,
  PayoutStatus.SUBMITTED,
  PayoutStatus.CONFIRMED,
];

async function rollingSpendForTreasury(treasuryId: string): Promise<{
  dailyTotalBaseUnits: string;
  monthlyTotalBaseUnits: string;
}> {
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const rows = await prisma.payout.findMany({
    where: {
      treasuryId,
      status: { in: ROLLING_SPEND_STATUSES },
      createdAt: { gte: monthStart },
    },
    select: { amountBaseUnits: true, createdAt: true },
  });

  let dailyTotalBaseUnits = '0';
  let monthlyTotalBaseUnits = '0';
  for (const row of rows) {
    monthlyTotalBaseUnits = addBaseUnits(monthlyTotalBaseUnits, row.amountBaseUnits);
    if (row.createdAt >= dayStart) {
      dailyTotalBaseUnits = addBaseUnits(dailyTotalBaseUnits, row.amountBaseUnits);
    }
  }
  return { dailyTotalBaseUnits, monthlyTotalBaseUnits };
}

@Injectable()
export class PayoutService {
  constructor(private readonly queueService: QueueService) {}

  async findAll(orgId: string) {
    return prisma.payout.findMany({
      where: { organizationId: orgId },
      include: {
        recipient: true,
        treasury: true,
        approvals: { include: { user: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(orgId: string, id: string) {
    const payout = await prisma.payout.findFirst({
      where: { id, organizationId: orgId },
      include: {
        recipient: true,
        treasury: true,
        approvals: { include: { user: true } },
        ledgerEntries: true,
      },
    });
    if (!payout) throw new NotFoundException('Payout not found.');
    return payout;
  }

  async create(
    orgId: string,
    userId: string,
    idempotencyKey: string,
    data: {
      treasuryId: string;
      recipientId: string;
      amountBaseUnits: string;
      externalReference?: string;
      invoiceReference?: string;
      memo?: string;
    },
  ) {
    const treasury = await prisma.treasury.findFirst({
      where: { id: data.treasuryId, organizationId: orgId },
      include: { policies: { where: { status: 'ACTIVE' } } },
    });
    if (!treasury) throw new NotFoundException('Treasury not found.');
    if (treasury.status !== 'ACTIVE') throw new BadRequestException('Treasury is frozen or inactive.');

    const recipient = await prisma.recipient.findFirst({
      where: { id: data.recipientId, organizationId: orgId },
    });
    if (!recipient) throw new NotFoundException('Recipient not found.');

    const activePolicy = treasury.policies[0];
    if (!activePolicy) throw new BadRequestException('No active policy configured for treasury.');

    // Serialize load-spend + evaluate + insert per org so concurrent creates cannot both pass on
    // the same rolling totals and jointly exceed daily/monthly limits.
    const payout = await runExclusive(prisma, `payout-create:${orgId}`, async () => {
      const rollingSpend = await rollingSpendForTreasury(treasury.id);

      const evalResult = evaluatePolicy({
        policy: { version: activePolicy.version, rules: activePolicy.rules as unknown as PolicyRules },
        treasury: { status: treasury.status, network: treasury.network },
        recipient: { id: recipient.id, status: recipient.status, riskLevel: recipient.riskLevel },
        payout: {
          amountBaseUnits: data.amountBaseUnits,
          mintAddress: treasury.mintAddress,
          memo: data.memo,
          createdByUserId: userId,
        },
        rollingSpend,
      });

      const initialStatus = evalResult.decision === 'BLOCK' ? PayoutStatus.BLOCKED : PayoutStatus.PENDING_APPROVAL;

      const created = await prisma.payout.create({
        data: {
          id: generateUlid('pay'),
          organizationId: orgId,
          treasuryId: treasury.id,
          recipientId: recipient.id,
          idempotencyKey,
          externalReference: data.externalReference,
          invoiceReference: data.invoiceReference,
          amountBaseUnits: data.amountBaseUnits,
          decimals: 6,
          assetSymbol: 'USDC',
          mintAddress: treasury.mintAddress,
          memo: data.memo,
          status: initialStatus,
          riskLevel: recipient.riskLevel,
          policyEvaluation: JSON.parse(JSON.stringify(evalResult)),
          createdByUserId: userId,
        },
      });

      await prisma.auditEvent.create({
        data: {
          id: generateUlid('aud'),
          organizationId: orgId,
          actorType: 'USER',
          actorId: userId,
          action: 'PAYOUT_CREATED',
          resourceType: 'PAYOUT',
          resourceId: created.id,
          metadata: { idempotencyKey, initialStatus, amountBaseUnits: data.amountBaseUnits },
        },
      });

      return created;
    });

    await this.queueService.dispatchWebhookEvent(
      orgId,
      payout.status === PayoutStatus.BLOCKED ? WEBHOOK_EVENT_TYPES.PAYOUT_BLOCKED : WEBHOOK_EVENT_TYPES.PAYOUT_CREATED,
      { payoutId: payout.id, status: payout.status, amountBaseUnits: payout.amountBaseUnits },
    );

    return payout;
  }

  async approve(orgId: string, userId: string, payoutId: string, comment?: string) {
    const payout = await this.findOne(orgId, payoutId);
    assertValidTransition(payout.status as PayoutStatus, PayoutStatus.APPROVED);

    const treasury = await prisma.treasury.findUnique({
      where: { id: payout.treasuryId },
      include: { policies: { where: { status: 'ACTIVE' } } },
    });

    const policyRules = treasury?.policies[0]?.rules as unknown as PolicyRules;

    if (policyRules?.approval?.preventCreatorApproval && payout.createdByUserId === userId) {
      throw new ForbiddenException('Policy prevents payout creator from approving their own payout.');
    }

    await prisma.payoutApproval.create({
      data: {
        id: generateUlid('app'),
        payoutId: payout.id,
        userId,
        decision: 'APPROVED',
        comment,
      },
    });

    const currentApprovals = await prisma.payoutApproval.count({
      where: { payoutId: payout.id, decision: 'APPROVED' },
    });

    const requiredApprovals = (payout.policyEvaluation as any)?.requiredApprovals ?? 2;

    let updatedPayout = payout;
    if (currentApprovals >= requiredApprovals) {
      updatedPayout = await prisma.payout.update({
        where: { id: payout.id },
        data: { status: PayoutStatus.APPROVED },
        include: { recipient: true, treasury: true, approvals: { include: { user: true } }, ledgerEntries: true },
      });
    }

    await prisma.auditEvent.create({
      data: {
        id: generateUlid('aud'),
        organizationId: orgId,
        actorType: 'USER',
        actorId: userId,
        action: 'PAYOUT_APPROVED',
        resourceType: 'PAYOUT',
        resourceId: payout.id,
        metadata: { currentApprovals, requiredApprovals, comment },
      },
    });

    if (updatedPayout.status === PayoutStatus.APPROVED) {
      await this.queueService.dispatchWebhookEvent(orgId, WEBHOOK_EVENT_TYPES.PAYOUT_APPROVED, {
        payoutId: payout.id,
        currentApprovals,
        requiredApprovals,
      });
    }

    return updatedPayout;
  }

  async reject(orgId: string, userId: string, payoutId: string, comment?: string) {
    const payout = await this.findOne(orgId, payoutId);
    assertValidTransition(payout.status as PayoutStatus, PayoutStatus.REJECTED);

    await prisma.payoutApproval.create({
      data: {
        id: generateUlid('app'),
        payoutId: payout.id,
        userId,
        decision: 'REJECTED',
        comment,
      },
    });

    const updated = await prisma.payout.update({
      where: { id: payout.id },
      data: { status: PayoutStatus.REJECTED },
    });

    await prisma.auditEvent.create({
      data: {
        id: generateUlid('aud'),
        organizationId: orgId,
        actorType: 'USER',
        actorId: userId,
        action: 'PAYOUT_REJECTED',
        resourceType: 'PAYOUT',
        resourceId: payout.id,
        metadata: { comment },
      },
    });

    await this.queueService.dispatchWebhookEvent(orgId, WEBHOOK_EVENT_TYPES.PAYOUT_REJECTED, {
      payoutId: payout.id,
      comment,
    });

    return updated;
  }

  async queueExecution(orgId: string, userId: string, payoutId: string) {
    const payout = await this.findOne(orgId, payoutId);
    assertValidTransition(payout.status as PayoutStatus, PayoutStatus.QUEUED_FOR_EXECUTION);

    const queued = await prisma.payout.update({
      where: { id: payout.id },
      data: { status: PayoutStatus.QUEUED_FOR_EXECUTION },
    });

    await prisma.auditEvent.create({
      data: {
        id: generateUlid('aud'),
        organizationId: orgId,
        actorType: 'USER',
        actorId: userId,
        action: 'PAYOUT_QUEUED_FOR_EXECUTION',
        resourceType: 'PAYOUT',
        resourceId: payout.id,
        metadata: {},
      },
    });

    // Hands off to the @atlas-rail/worker payout-execution processor: simulation, signing via
    // MockDevnetSignerAdapter, and submission all happen out-of-process from here on.
    await this.queueService.enqueuePayoutExecution({
      organizationId: orgId,
      payoutId: payout.id,
      triggeredByUserId: userId,
    });

    return queued;
  }

  async getAudit(orgId: string, payoutId: string) {
    await this.findOne(orgId, payoutId);
    return prisma.auditEvent.findMany({
      where: { organizationId: orgId, resourceType: 'PAYOUT', resourceId: payoutId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
