import { Job } from 'bullmq';
import { prisma, WebhookDeliveryStatus, WebhookEndpointStatus } from '@atlas-rail/database';
import { generateWebhookSignature, isValidWebhookUrl } from '@atlas-rail/domain';
import { WebhookDeliveryJobData } from '@atlas-rail/config';

/**
 * Attempts one HTTP delivery of a signed webhook payload. On failure it re-throws so BullMQ
 * applies the queue's exponential backoff (see WEBHOOK_DELIVERY_JOB_OPTIONS) before retrying;
 * on the final attempt the delivery is marked FAILED instead of left PENDING forever.
 */
export async function processWebhookDeliveryJob(job: Job<WebhookDeliveryJobData>): Promise<void> {
  const { webhookDeliveryId } = job.data;

  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: webhookDeliveryId },
    include: { webhookEndpoint: true },
  });
  if (!delivery) {
    throw new Error(`WebhookDelivery ${webhookDeliveryId} not found`);
  }
  if (delivery.status === WebhookDeliveryStatus.DELIVERED) {
    return;
  }

  const endpoint = delivery.webhookEndpoint;
  const allowPrivateNetworks = process.env.WEBHOOK_ALLOW_PRIVATE_NETWORKS !== 'false';
  const attemptCount = delivery.attemptCount + 1;
  const attemptsExhausted = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

  if (endpoint.status !== WebhookEndpointStatus.ACTIVE || !isValidWebhookUrl(endpoint.url, allowPrivateNetworks)) {
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: WebhookDeliveryStatus.FAILED,
        attemptCount,
        responseBodyTruncated: 'Webhook endpoint is disabled or its destination URL is prohibited.',
      },
    });
    return;
  }

  const payloadStr = JSON.stringify(delivery.payload);
  const signature = generateWebhookSignature(payloadStr, endpoint.secretEncrypted);
  const timeoutMs = Number(process.env.WEBHOOK_TIMEOUT_MS || 10000);

  let response: Response | null = null;
  let networkErrorMessage: string | null = null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    response = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [signature.headerName]: signature.headerValue,
        'Atlas-Event-Type': delivery.eventType,
        'Atlas-Delivery-Id': delivery.id,
      },
      body: payloadStr,
      signal: controller.signal,
    });
  } catch (err: any) {
    networkErrorMessage = err?.message || 'Webhook delivery request failed';
  } finally {
    clearTimeout(timer);
  }

  if (response && response.status >= 200 && response.status < 300) {
    const bodyText = (await response.text()).slice(0, 2000);
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: WebhookDeliveryStatus.DELIVERED,
        attemptCount,
        responseStatus: response.status,
        responseBodyTruncated: bodyText,
        deliveredAt: new Date(),
      },
    });
    return;
  }

  const responseBody = response ? (await response.text()).slice(0, 2000) : null;
  const failureReason = response
    ? `Webhook endpoint responded with status ${response.status}`
    : networkErrorMessage || 'Webhook delivery request failed';

  await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: {
      status: attemptsExhausted ? WebhookDeliveryStatus.FAILED : WebhookDeliveryStatus.PENDING,
      attemptCount,
      responseStatus: response?.status,
      responseBodyTruncated: (responseBody ?? failureReason).slice(0, 2000),
      nextAttemptAt: attemptsExhausted ? null : new Date(Date.now() + 5000 * 2 ** attemptCount),
    },
  });

  // Let BullMQ apply the queue's exponential backoff before the next retry.
  throw new Error(failureReason);
}
