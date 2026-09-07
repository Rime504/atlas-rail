import { Job } from 'bullmq';
import { prisma, generateUlid } from '@atlas-rail/database';
import { formatBaseUnitsToDisplay } from '@atlas-rail/domain';
import { ReconciliationExportJobData } from '@atlas-rail/config';

/**
 * Generates a background reconciliation summary for an organization and records it as an
 * audit event. The synchronous CSV download (GET /v1/ledger/reconciliation.csv) stays in the
 * API for interactive use; this queue exists for larger/scheduled exports that shouldn't block
 * a request thread.
 */
export async function processReconciliationExportJob(job: Job<ReconciliationExportJobData>): Promise<void> {
  const { organizationId, requestedByUserId } = job.data;

  const entries = await prisma.ledgerEntry.findMany({
    where: { organizationId, entryType: 'PAYOUT_CONFIRMED' },
  });

  let totalVolumeBaseUnits = 0n;
  for (const entry of entries) {
    if (entry.amountBaseUnits) {
      totalVolumeBaseUnits += BigInt(entry.amountBaseUnits);
    }
  }

  await prisma.auditEvent.create({
    data: {
      id: generateUlid('aud'),
      organizationId,
      actorType: requestedByUserId ? 'USER' : 'SYSTEM',
      actorId: requestedByUserId,
      action: 'RECONCILIATION_EXPORT_GENERATED',
      resourceType: 'ORGANIZATION',
      resourceId: organizationId,
      metadata: {
        confirmedPayoutsCount: entries.length,
        totalVolumeBaseUnits: totalVolumeBaseUnits.toString(),
        totalVolumeDisplay: formatBaseUnitsToDisplay(totalVolumeBaseUnits.toString(), 6),
        generatedAt: new Date().toISOString(),
      },
    },
  });
}
