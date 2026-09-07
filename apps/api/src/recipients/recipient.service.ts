import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma, generateUlid, RecipientStatus, RecipientType, RiskLevel } from '@atlas-rail/database';

@Injectable()
export class RecipientService {
  async findAll(orgId: string) {
    return prisma.recipient.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(orgId: string, id: string) {
    const recipient = await prisma.recipient.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!recipient) throw new NotFoundException('Recipient not found.');
    return recipient;
  }

  async create(
    orgId: string,
    data: {
      displayName: string;
      recipientType: RecipientType;
      walletAddress: string;
      expectedMintAddress: string;
      countryCode?: string;
      email?: string;
      referenceCode?: string;
      verificationNotes?: string;
    },
  ) {
    const recipient = await prisma.recipient.create({
      data: {
        id: generateUlid('rec'),
        organizationId: orgId,
        displayName: data.displayName,
        recipientType: data.recipientType || RecipientType.BUSINESS,
        status: RecipientStatus.PENDING,
        walletAddress: data.walletAddress,
        expectedMintAddress: data.expectedMintAddress || process.env.SOLANA_USDC_MINT || '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
        countryCode: data.countryCode,
        email: data.email,
        referenceCode: data.referenceCode,
        riskLevel: RiskLevel.LOW,
        verificationNotes: data.verificationNotes,
      },
    });

    await prisma.auditEvent.create({
      data: {
        id: generateUlid('aud'),
        organizationId: orgId,
        actorType: 'USER',
        action: 'RECIPIENT_CREATED',
        resourceType: 'RECIPIENT',
        resourceId: recipient.id,
        metadata: { displayName: recipient.displayName, walletAddress: recipient.walletAddress },
      },
    });

    return recipient;
  }

  async setStatus(orgId: string, id: string, status: RecipientStatus, notes?: string) {
    const recipient = await this.findOne(orgId, id);
    const updated = await prisma.recipient.update({
      where: { id: recipient.id },
      data: {
        status,
        verificationNotes: notes || recipient.verificationNotes,
      },
    });

    await prisma.auditEvent.create({
      data: {
        id: generateUlid('aud'),
        organizationId: orgId,
        actorType: 'USER',
        action: `RECIPIENT_STATUS_${status}`,
        resourceType: 'RECIPIENT',
        resourceId: recipient.id,
        metadata: { previousStatus: recipient.status, newStatus: status, notes },
      },
    });

    return updated;
  }
}
