import { Worker, Queue, Job } from 'bullmq';
import { validateEnv, DEVNET_WARNING_BANNER, QUEUE_NAMES } from '@atlas-rail/config';
import { assertNotMainnet } from '@atlas-rail/solana';
import { getRedisConnection } from './redis';
import { processPayoutExecutionJob } from './queues/payout-execution.processor';
import { processPayoutConfirmationJob } from './queues/payout-confirmation.processor';
import { processWebhookDeliveryJob } from './queues/webhook-delivery.processor';
import { processReconciliationExportJob } from './queues/reconciliation-export.processor';
import { processHousekeepingJob } from './queues/housekeeping.processor';

const HOUSEKEEPING_INTERVAL_MS = 5 * 60 * 1000;

async function startWorker() {
  const env = validateEnv();
  assertNotMainnet(env.SOLANA_RPC_URL);

  console.info('⚙️ Starting Atlas Rail Background Queue Worker...');
  console.info(`⚠️ SAFETY NOTICE: ${DEVNET_WARNING_BANNER}`);

  const connection = getRedisConnection();

  const workers = [
    new Worker(QUEUE_NAMES.PAYOUT_EXECUTION, processPayoutExecutionJob, { connection, concurrency: 5 }),
    new Worker(QUEUE_NAMES.PAYOUT_CONFIRMATION, processPayoutConfirmationJob, { connection, concurrency: 5 }),
    new Worker(QUEUE_NAMES.WEBHOOK_DELIVERY, processWebhookDeliveryJob, { connection, concurrency: 10 }),
    new Worker(QUEUE_NAMES.RECONCILIATION_EXPORT, processReconciliationExportJob, { connection, concurrency: 2 }),
    new Worker(QUEUE_NAMES.HOUSEKEEPING, processHousekeepingJob, { connection, concurrency: 1 }),
  ];

  for (const worker of workers) {
    worker.on('completed', (job: Job) => {
      console.info(`✅ [${worker.name}] job ${job.id} completed.`);
    });
    worker.on('failed', (job: Job | undefined, err: Error) => {
      console.error(`❌ [${worker.name}] job ${job?.id} failed:`, err?.message);
    });
  }

  const housekeepingQueue = new Queue(QUEUE_NAMES.HOUSEKEEPING, { connection });
  await housekeepingQueue.add(
    'periodic-housekeeping',
    { reason: 'scheduled' },
    { repeat: { every: HOUSEKEEPING_INTERVAL_MS }, removeOnComplete: 10, removeOnFail: 10 },
  );

  console.info(`📡 Listening on queues: ${Object.values(QUEUE_NAMES).join(', ')}`);

  const shutdown = async (signal: string) => {
    console.info(`🛑 Received ${signal}, shutting down Atlas Rail worker...`);
    await Promise.all(workers.map((worker) => worker.close()));
    await housekeepingQueue.close();
    connection.disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

startWorker().catch((err) => {
  console.error('Fatal worker error:', err);
  process.exit(1);
});
