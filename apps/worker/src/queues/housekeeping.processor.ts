import { Job } from 'bullmq';
import { prisma, PayoutStatus } from '@atlas-rail/database';
import { HousekeepingJobData } from '@atlas-rail/config';
import { isPayoutStuck, STUCK_PAYOUT_STATUSES } from './housekeeping';

/**
 * Periodic maintenance: purges expired idempotency records and fails any payout that has sat in
 * an in-flight execution status too long (most likely a worker crash mid-job). Scheduled as a
 * BullMQ repeatable job from main.ts.
 */
export async function processHousekeepingJob(_job: Job<HousekeepingJobData>): Promise<void> {
  const now = new Date();

  const { count: expiredIdempotencyRecords } = await prisma.idempotencyRecord.deleteMany({
    where: { expiresAt: { lt: now } },
  });

  const candidates = await prisma.payout.findMany({
    where: { status: { in: [...STUCK_PAYOUT_STATUSES] as PayoutStatus[] } },
  });

  const stuckPayouts = candidates.filter((payout) => isPayoutStuck(payout.status, payout.updatedAt, now));

  for (const payout of stuckPayouts) {
    await prisma.payout.update({
      where: { id: payout.id },
      data: {
        status: PayoutStatus.FAILED,
        failureCode: 'STUCK_TIMEOUT',
        failureMessage: `Payout remained in ${payout.status} past the execution timeout and was marked failed by housekeeping.`,
      },
    });
  }

  if (expiredIdempotencyRecords > 0 || stuckPayouts.length > 0) {
    console.info(
      `Housekeeping: purged ${expiredIdempotencyRecords} expired idempotency record(s), failed ${stuckPayouts.length} stuck payout(s).`,
    );
  }
}
