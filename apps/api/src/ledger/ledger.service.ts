import { Injectable } from '@nestjs/common';
import { prisma } from '@atlas-rail/database';
import { formatBaseUnitsToDisplay } from '@atlas-rail/domain';
import { QueueService } from '../common/queue.service';

@Injectable()
export class LedgerService {
  constructor(private readonly queueService: QueueService) {}

  async getLedgerEntries(orgId: string) {
    return prisma.ledgerEntry.findMany({
      where: { organizationId: orgId },
      include: { payout: { include: { recipient: true } }, treasury: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getReconciliationSummary(orgId: string) {
    const entries = await prisma.ledgerEntry.findMany({
      where: { organizationId: orgId, entryType: 'PAYOUT_CONFIRMED' },
    });

    let totalVolumeBaseUnits = 0n;
    for (const e of entries) {
      if (e.amountBaseUnits) {
        totalVolumeBaseUnits += BigInt(e.amountBaseUnits);
      }
    }

    const totalVolumeDisplay = formatBaseUnitsToDisplay(totalVolumeBaseUnits.toString(), 6);

    return {
      assetSymbol: 'USDC',
      network: 'DEVNET',
      confirmedPayoutsCount: entries.length,
      totalVolumeBaseUnits: totalVolumeBaseUnits.toString(),
      totalVolumeDisplay,
    };
  }

  async exportReconciliationCsv(orgId: string, requestedByUserId?: string): Promise<string> {
    // Fire off a durable background reconciliation-export job so every export is recorded as an
    // audit event, without making the interactive CSV download wait on it.
    this.queueService
      .enqueueReconciliationExport({ organizationId: orgId, requestedByUserId })
      .catch((err) => console.error('Failed to enqueue reconciliation-export audit job:', err));

    const entries = await prisma.ledgerEntry.findMany({
      where: { organizationId: orgId },
      include: { payout: { include: { recipient: true } }, treasury: true },
      orderBy: { createdAt: 'asc' },
    });

    const headers = [
      'LedgerEntryId',
      'CreatedAt',
      'TreasuryName',
      'EntryType',
      'Direction',
      'AmountUSDC',
      'AmountBaseUnits',
      'RecipientName',
      'RecipientWallet',
      'InvoiceReference',
      'ExternalReference',
      'TransactionSignature',
    ];

    const rows = entries.map((e) => {
      const amountUsdc = e.amountBaseUnits ? formatBaseUnitsToDisplay(e.amountBaseUnits, 6) : '0.000000';
      const sig = (e.metadata as any)?.signature || e.payout?.transactionSignature || '';
      return [
        e.id,
        e.createdAt.toISOString(),
        `"${e.treasury.name}"`,
        e.entryType,
        e.direction,
        amountUsdc,
        e.amountBaseUnits || '0',
        `"${e.payout?.recipient?.displayName || ''}"`,
        e.payout?.recipient?.walletAddress || '',
        `"${e.payout?.invoiceReference || ''}"`,
        `"${e.payout?.externalReference || ''}"`,
        sig,
      ].join(',');
    });

    return [headers.join(','), ...rows].join('\n');
  }
}
