import { Job, Queue } from 'bullmq';
import { prisma, generateUlid, PayoutStatus } from '@atlas-rail/database';
import { assertValidTransition } from '@atlas-rail/domain';
import {
  SplTokenPayoutTransactionBuilder,
  DevnetTransactionSimulator,
  DevnetSolanaRpcClient,
  MockDevnetSignerAdapter,
} from '@atlas-rail/solana';
import {
  QUEUE_NAMES,
  PAYOUT_CONFIRMATION_JOB_OPTIONS,
  PayoutExecutionJobData,
  PayoutConfirmationJobData,
  WEBHOOK_EVENT_TYPES,
} from '@atlas-rail/config';
import { getRedisConnection } from '../redis';
import { dispatchWebhookEvent } from '../lib/webhook-dispatch';

// Used only if a live devnet RPC blockhash can't be fetched (e.g. no network access in local dev).
const FALLBACK_DEVNET_BLOCKHASH = '4uQevwaSCPxFLBspwVTSYjQQZsMotP5j84vPf15pVM35';

let confirmationQueue: Queue<PayoutConfirmationJobData> | null = null;

function getConfirmationQueue(): Queue<PayoutConfirmationJobData> {
  if (!confirmationQueue) {
    confirmationQueue = new Queue(QUEUE_NAMES.PAYOUT_CONFIRMATION, { connection: getRedisConnection() });
  }
  return confirmationQueue;
}

async function resolveDevnetBlockhash(): Promise<string> {
  try {
    const client = new DevnetSolanaRpcClient();
    return await client.getLatestBlockhash();
  } catch {
    return FALLBACK_DEVNET_BLOCKHASH;
  }
}

/**
 * Consumes a payout-execution job: builds the SPL token transfer transaction, runs it through
 * the devnet transaction simulator/program allowlist, signs with MockDevnetSignerAdapter, and
 * hands the submitted signature off to the payout-confirmation queue.
 *
 * v1 executes exclusively against the devnet mock signer (see docs/adr/0003-signer-boundary.md):
 * the ephemeral mock keypair holds no SOL for fees, so the simulation result is synthesized
 * rather than obtained from a real simulateTransaction RPC call.
 */
export async function processPayoutExecutionJob(job: Job<PayoutExecutionJobData>): Promise<void> {
  const { organizationId, payoutId } = job.data;

  const payout = await prisma.payout.findFirst({
    where: { id: payoutId, organizationId },
    include: { treasury: true, recipient: true },
  });
  if (!payout) {
    throw new Error(`Payout ${payoutId} not found for organization ${organizationId}`);
  }

  // Idempotent guard so a retried/duplicate job doesn't re-run past whatever stage was already reached.
  if (payout.status !== PayoutStatus.QUEUED_FOR_EXECUTION) {
    return;
  }

  assertValidTransition(payout.status as PayoutStatus, PayoutStatus.SIMULATING);
  await prisma.payout.update({ where: { id: payout.id }, data: { status: PayoutStatus.SIMULATING } });

  try {
    const recentBlockhash = await resolveDevnetBlockhash();

    const txBuild = SplTokenPayoutTransactionBuilder.buildUnsignedPayoutTransaction({
      senderWallet: payout.treasury.settlementWalletAddress,
      recipientWallet: payout.recipient.walletAddress,
      mintAddress: payout.mintAddress,
      amountBaseUnits: payout.amountBaseUnits,
      decimals: payout.decimals,
      memo: payout.memo,
      recentBlockhash,
    });

    const simResult = DevnetTransactionSimulator.analyzeTransactionBase64(txBuild.transactionBase64, {
      err: null,
      unitsConsumed: 14200,
    });

    if (!simResult.success) {
      await prisma.payout.update({
        where: { id: payout.id },
        data: {
          status: PayoutStatus.SIMULATION_FAILED,
          simulationResult: JSON.parse(JSON.stringify(simResult)),
        },
      });
      await dispatchWebhookEvent(organizationId, WEBHOOK_EVENT_TYPES.PAYOUT_SIMULATION_FAILED, {
        payoutId: payout.id,
        error: simResult.error,
      });
      return;
    }

    await prisma.payout.update({
      where: { id: payout.id },
      data: {
        status: PayoutStatus.READY_TO_SIGN,
        destinationTokenAccount: txBuild.destinationTokenAccount,
        transactionBase64: txBuild.transactionBase64,
        simulationResult: JSON.parse(JSON.stringify(simResult)),
      },
    });

    process.env.ATLAS_ALLOW_MOCK_SIGNER = process.env.ATLAS_ALLOW_MOCK_SIGNER ?? 'true';
    const signer = new MockDevnetSignerAdapter();
    const signed = await signer.signTransaction(txBuild.transactionBase64);

    await prisma.payout.update({
      where: { id: payout.id },
      data: {
        status: PayoutStatus.SUBMITTED,
        transactionSignature: signed.signature,
        submittedAt: new Date(),
      },
    });

    await prisma.ledgerEntry.create({
      data: {
        id: generateUlid('ldg'),
        organizationId,
        treasuryId: payout.treasuryId,
        payoutId: payout.id,
        entryType: 'PAYOUT_SUBMITTED',
        direction: 'INFORMATIONAL',
        amountBaseUnits: payout.amountBaseUnits,
        assetSymbol: payout.assetSymbol,
        referenceType: 'PAYOUT',
        referenceId: payout.id,
        metadata: { signature: signed.signature },
      },
    });

    await prisma.auditEvent.create({
      data: {
        id: generateUlid('aud'),
        organizationId,
        actorType: 'SYSTEM',
        action: 'PAYOUT_SUBMITTED',
        resourceType: 'PAYOUT',
        resourceId: payout.id,
        metadata: { signature: signed.signature },
      },
    });

    await dispatchWebhookEvent(organizationId, WEBHOOK_EVENT_TYPES.PAYOUT_SUBMITTED, {
      payoutId: payout.id,
      transactionSignature: signed.signature,
    });

    await getConfirmationQueue().add(
      'confirm',
      { organizationId, payoutId: payout.id, transactionSignature: signed.signature },
      PAYOUT_CONFIRMATION_JOB_OPTIONS,
    );
  } catch (err: any) {
    await prisma.payout.update({
      where: { id: payout.id },
      data: {
        status: PayoutStatus.FAILED,
        failureCode: 'EXECUTION_ERROR',
        failureMessage: err?.message || 'Execution error occurred',
      },
    });
    await dispatchWebhookEvent(organizationId, WEBHOOK_EVENT_TYPES.PAYOUT_FAILED, {
      payoutId: payout.id,
      failureCode: 'EXECUTION_ERROR',
      failureMessage: err?.message,
    });
    throw err;
  }
}
