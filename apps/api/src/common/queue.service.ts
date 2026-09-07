import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { prisma, generateUlid, WebhookEndpointStatus } from '@atlas-rail/database';
import {
  QUEUE_NAMES,
  PAYOUT_EXECUTION_JOB_OPTIONS,
  RECONCILIATION_EXPORT_JOB_OPTIONS,
  WEBHOOK_DELIVERY_JOB_OPTIONS,
  webhookEventMatchesPattern,
  PayoutExecutionJobData,
  ReconciliationExportJobData,
  WebhookDeliveryJobData,
  WebhookEventType,
} from '@atlas-rail/config';

/**
 * Producer-side entry point into the BullMQ queues consumed by @atlas-rail/worker.
 * The API only ever enqueues jobs here; the actual devnet execution, confirmation
 * polling, and webhook HTTP delivery all happen out-of-process in the worker.
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });

  private readonly payoutExecutionQueue = new Queue<PayoutExecutionJobData>(QUEUE_NAMES.PAYOUT_EXECUTION, {
    connection: this.connection,
  });

  private readonly webhookDeliveryQueue = new Queue<WebhookDeliveryJobData>(QUEUE_NAMES.WEBHOOK_DELIVERY, {
    connection: this.connection,
  });

  private readonly reconciliationExportQueue = new Queue<ReconciliationExportJobData>(
    QUEUE_NAMES.RECONCILIATION_EXPORT,
    { connection: this.connection },
  );

  async enqueuePayoutExecution(data: PayoutExecutionJobData): Promise<void> {
    await this.payoutExecutionQueue.add('execute', data, PAYOUT_EXECUTION_JOB_OPTIONS);
  }

  async enqueueReconciliationExport(data: ReconciliationExportJobData): Promise<void> {
    await this.reconciliationExportQueue.add('export', data, RECONCILIATION_EXPORT_JOB_OPTIONS);
  }

  /**
   * Fans an internal lifecycle event out to every active webhook endpoint subscribed to it:
   * persists one WebhookDelivery row per matching endpoint, then enqueues the HTTP attempt.
   */
  async dispatchWebhookEvent(
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

      await this.webhookDeliveryQueue.add(
        'deliver',
        { webhookDeliveryId: delivery.id },
        WEBHOOK_DELIVERY_JOB_OPTIONS,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([
      this.payoutExecutionQueue.close(),
      this.webhookDeliveryQueue.close(),
      this.reconciliationExportQueue.close(),
    ]);
    this.connection.disconnect();
  }
}
