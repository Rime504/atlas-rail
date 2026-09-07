import { Queue } from 'bullmq';
import { prisma, generateUlid, WebhookEndpointStatus } from '@atlas-rail/database';
import {
  QUEUE_NAMES,
  WEBHOOK_DELIVERY_JOB_OPTIONS,
  webhookEventMatchesPattern,
  WebhookDeliveryJobData,
  WebhookEventType,
} from '@atlas-rail/config';
import { getRedisConnection } from '../redis';

let webhookDeliveryQueue: Queue<WebhookDeliveryJobData> | null = null;

function getWebhookDeliveryQueue(): Queue<WebhookDeliveryJobData> {
  if (!webhookDeliveryQueue) {
    webhookDeliveryQueue = new Queue(QUEUE_NAMES.WEBHOOK_DELIVERY, { connection: getRedisConnection() });
  }
  return webhookDeliveryQueue;
}

/**
 * Fans a payout lifecycle event (confirmed/failed/etc., emitted from inside the worker itself)
 * out to every active webhook endpoint subscribed to it. Mirrors QueueService#dispatchWebhookEvent
 * on the API side, which handles the events raised synchronously from HTTP request handlers.
 */
export async function dispatchWebhookEvent(
  organizationId: string,
  eventType: WebhookEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { organizationId, status: WebhookEndpointStatus.ACTIVE },
  });

  const matching = endpoints.filter((endpoint) =>
    (endpoint.eventTypes as string[]).some((pattern) => webhookEventMatchesPattern(eventType, pattern)),
  );

  for (const endpoint of matching) {
    const delivery = await prisma.webhookDelivery.create({
      data: {
        id: generateUlid('whd'),
        webhookEndpointId: endpoint.id,
        eventType,
        payload: JSON.parse(JSON.stringify(payload)),
      },
    });

    await getWebhookDeliveryQueue().add('deliver', { webhookDeliveryId: delivery.id }, WEBHOOK_DELIVERY_JOB_OPTIONS);
  }
}
