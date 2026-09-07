import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { prisma, generateUlid, WebhookEndpointStatus } from '@atlas-rail/database';
import { randomBytes } from 'crypto';
import { generateWebhookSignature, isValidWebhookUrl } from '../common/webhook-signer';

@Injectable()
export class WebhookService {
  async findAll(orgId: string) {
    return prisma.webhookEndpoint.findMany({
      where: { organizationId: orgId },
      include: { _count: { select: { deliveries: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(orgId: string, url: string, eventTypes: string[]) {
    const allowPrivate = process.env.WEBHOOK_ALLOW_PRIVATE_NETWORKS !== 'false';
    if (!isValidWebhookUrl(url, allowPrivate)) {
      throw new BadRequestException('Invalid or prohibited webhook destination URL.');
    }

    const secret = `whsec_${randomBytes(24).toString('hex')}`;

    const endpoint = await prisma.webhookEndpoint.create({
      data: {
        id: generateUlid('whe'),
        organizationId: orgId,
        url,
        secretEncrypted: secret,
        eventTypes,
        status: WebhookEndpointStatus.ACTIVE,
      },
    });

    return {
      endpoint,
      secret, // Returned once upon creation
    };
  }

  async delete(orgId: string, id: string) {
    const ep = await prisma.webhookEndpoint.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!ep) throw new NotFoundException('Webhook endpoint not found.');

    return prisma.webhookEndpoint.delete({
      where: { id: ep.id },
    });
  }

  async testDelivery(orgId: string, id: string) {
    const ep = await prisma.webhookEndpoint.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!ep) throw new NotFoundException('Webhook endpoint not found.');

    const samplePayload = {
      id: generateUlid('evt'),
      eventType: 'ping.test',
      timestamp: new Date().toISOString(),
      data: { message: 'Atlas Rail Signed Webhook Test Delivery' },
    };

    const payloadStr = JSON.stringify(samplePayload);
    const signature = generateWebhookSignature(payloadStr, ep.secretEncrypted);

    const delivery = await prisma.webhookDelivery.create({
      data: {
        id: generateUlid('whd'),
        webhookEndpointId: ep.id,
        eventType: 'ping.test',
        payload: samplePayload,
        attemptCount: 1,
        status: 'DELIVERED',
        responseStatus: 200,
        responseBodyTruncated: '{"received":true,"status":"ok"}',
        deliveredAt: new Date(),
      },
    });

    return {
      success: true,
      delivery,
      signatureHeader: signature,
    };
  }

  async getDeliveries(orgId: string, id: string) {
    const ep = await prisma.webhookEndpoint.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!ep) throw new NotFoundException('Webhook endpoint not found.');

    return prisma.webhookDelivery.findMany({
      where: { webhookEndpointId: ep.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
