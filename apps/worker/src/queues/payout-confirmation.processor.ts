import { Job } from 'bullmq';
import { prisma, generateUlid, PayoutStatus } from '@atlas-rail/database';
import { assertValidTransition } from '@atlas-rail/domain';
import { DevnetConfirmationTracker } from '@atlas-rail/solana';
import { PayoutConfirmationJobData, WEBHOOK_EVENT_TYPES } from '@atlas-rail/config';
import { dispatchWebhookEvent } from '../lib/webhook-dispatch';

/**
 * Polls devnet for confirmation of a submitted payout's transaction signature. BullMQ retries
 * this job (with backoff, per PAYOUT_CONFIRMATION_JOB_OPTIONS) until it either confirms or the
 * retry budget is exhausted, at which point the payout is marked FAILED.
 */
export async function processPayoutConfirmationJob(job: Job<PayoutConfirmationJobData>): Promise<void> {
  const { organizationId, payoutId, transactionSignature } = job.data;

  const payout = await prisma.payout.findFirst({ where: { id: payoutId, organizationId } });
  if (!payout) {
    throw new Error(`Payout ${payoutId} not found for organization ${organizationId}`);
  }

  // Idempotent guard: a prior attempt may have already confirmed or failed this payout.
  if (payout.status !== PayoutStatus.SUBMITTED) {
    return;
  }

  const confirmation = await DevnetConfirmationTracker.pollConfirmation(transactionSignature);

  const attemptsExhausted = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

  if (!confirmation.confirmed) {
    if (attemptsExhausted) {
      await prisma.payout.update({
        where: { id: payout.id },
        data: {
          status: PayoutStatus.FAILED,
          failureCode: 'CONFIRMATION_TIMEOUT',
          failureMessage: 'Transaction was not confirmed on devnet within the retry window.',
        },
      });
      await dispatchWebhookEvent(organizationId, WEBHOOK_EVENT_TYPES.PAYOUT_FAILED, {
        payoutId,
        failureCode: 'CONFIRMATION_TIMEOUT',
      });
      return;
    }
    throw new Error('Transaction not yet confirmed on devnet; will retry.');
  }

  if (confirmation.err) {
    await prisma.payout.update({
      where: { id: payout.id },
      data: {
        status: PayoutStatus.FAILED,
        failureCode: 'ON_CHAIN_ERROR',
        failureMessage: JSON.stringify(confirmation.err),
      },
    });
    await dispatchWebhookEvent(organizationId, WEBHOOK_EVENT_TYPES.PAYOUT_FAILED, {
      payoutId,
      failureCode: 'ON_CHAIN_ERROR',
    });
    return;
  }

  assertValidTransition(payout.status as PayoutStatus, PayoutStatus.CONFIRMED);
  await prisma.payout.update({
    where: { id: payout.id },
    data: { status: PayoutStatus.CONFIRMED, confirmedAt: new Date() },
  });

  await prisma.ledgerEntry.create({
    data: {
      id: generateUlid('ldg'),
      organizationId,
      treasuryId: payout.treasuryId,
      payoutId: payout.id,
      entryType: 'PAYOUT_CONFIRMED',
      direction: 'DEBIT',
      amountBaseUnits: payout.amountBaseUnits,
      assetSymbol: payout.assetSymbol,
      referenceType: 'PAYOUT',
      referenceId: payout.id,
      metadata: { signature: transactionSignature, slot: confirmation.slot },
    },
  });

  await prisma.auditEvent.create({
    data: {
      id: generateUlid('aud'),
      organizationId,
      actorType: 'SYSTEM',
      action: 'PAYOUT_CONFIRMED',
      resourceType: 'PAYOUT',
      resourceId: payout.id,
      metadata: { signature: transactionSignature },
    },
  });

  await dispatchWebhookEvent(organizationId, WEBHOOK_EVENT_TYPES.PAYOUT_CONFIRMED, {
    payoutId: payout.id,
    transactionSignature,
  });
}
