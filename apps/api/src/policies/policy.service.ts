import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma, generateUlid } from '@atlas-rail/database';
import { evaluatePolicy, PolicyRules } from '@atlas-rail/domain';

@Injectable()
export class PolicyService {
  async findByTreasury(orgId: string, treasuryId: string) {
    return prisma.policy.findMany({
      where: { treasuryId, treasury: { organizationId: orgId } },
      orderBy: { version: 'desc' },
    });
  }

  async findOne(orgId: string, id: string) {
    const policy = await prisma.policy.findFirst({
      where: { id, treasury: { organizationId: orgId } },
      include: { treasury: true },
    });
    if (!policy) throw new NotFoundException('Policy not found.');
    return policy;
  }

  async create(orgId: string, treasuryId: string, userId: string, name: string, rules: any) {
    const latest = await prisma.policy.findFirst({
      where: { treasuryId },
      orderBy: { version: 'desc' },
    });
    const nextVersion = (latest?.version || 0) + 1;

    return prisma.policy.create({
      data: {
        id: generateUlid('pol'),
        treasuryId,
        version: nextVersion,
        name,
        status: 'DRAFT',
        rules,
        createdByUserId: userId,
      },
    });
  }

  async activate(orgId: string, id: string) {
    const policy = await this.findOne(orgId, id);

    // Deactivate previous active policies for this treasury
    await prisma.policy.updateMany({
      where: { treasuryId: policy.treasuryId, status: 'ACTIVE' },
      data: { status: 'ARCHIVED' },
    });

    const activated = await prisma.policy.update({
      where: { id: policy.id },
      data: { status: 'ACTIVE', activatedAt: new Date() },
    });

    await prisma.ledgerEntry.create({
      data: {
        id: generateUlid('ldg'),
        organizationId: orgId,
        treasuryId: policy.treasuryId,
        entryType: 'POLICY_ACTIVATED',
        direction: 'INFORMATIONAL',
        referenceType: 'POLICY',
        referenceId: policy.id,
        metadata: { version: policy.version, name: policy.name },
      },
    });

    return activated;
  }

  async evaluateRequest(orgId: string, payload: any) {
    const treasury = await prisma.treasury.findFirst({
      where: { id: payload.treasuryId, organizationId: orgId },
      include: { policies: { where: { status: 'ACTIVE' } } },
    });
    if (!treasury) throw new NotFoundException('Treasury not found.');

    const activePolicy = treasury.policies[0];
    if (!activePolicy) throw new NotFoundException('No active policy configured for treasury.');

    const recipient = await prisma.recipient.findFirst({
      where: { id: payload.recipientId, organizationId: orgId },
    });
    if (!recipient) throw new NotFoundException('Recipient not found.');

    return evaluatePolicy({
      policy: {
        version: activePolicy.version,
        rules: activePolicy.rules as unknown as PolicyRules,
      },
      treasury: {
        status: treasury.status,
        network: treasury.network,
      },
      recipient: {
        id: recipient.id,
        status: recipient.status,
        riskLevel: recipient.riskLevel,
      },
      payout: {
        amountBaseUnits: payload.amountBaseUnits,
        mintAddress: payload.mintAddress || treasury.mintAddress,
        memo: payload.memo,
        createdByUserId: payload.userId || 'usr_demo',
      },
      rollingSpend: {
        dailyTotalBaseUnits: '0',
        monthlyTotalBaseUnits: '0',
      },
      simulation: payload.simulation,
    });
  }
}
