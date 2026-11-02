import { prisma, PayoutStatus } from '@atlas-rail/database';
import { addBaseUnits } from '@atlas-rail/domain';

/** Statuses that still count against daily/monthly limits (in-flight + confirmed). */
const ROLLING_SPEND_STATUSES: PayoutStatus[] = [
  PayoutStatus.PENDING_APPROVAL,
  PayoutStatus.APPROVED,
  PayoutStatus.QUEUED_FOR_EXECUTION,
  PayoutStatus.SIMULATING,
  PayoutStatus.READY_TO_SIGN,
  PayoutStatus.SUBMITTED,
  PayoutStatus.CONFIRMED,
];

/** Sums this treasury's day/month spend that still counts toward policy limits. */
export async function rollingSpendForTreasury(treasuryId: string): Promise<{
  dailyTotalBaseUnits: string;
  monthlyTotalBaseUnits: string;
}> {
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const rows = await prisma.payout.findMany({
    where: {
      treasuryId,
      status: { in: ROLLING_SPEND_STATUSES },
      createdAt: { gte: monthStart },
    },
    select: { amountBaseUnits: true, createdAt: true },
  });

  let dailyTotalBaseUnits = '0';
  let monthlyTotalBaseUnits = '0';
  for (const row of rows) {
    monthlyTotalBaseUnits = addBaseUnits(monthlyTotalBaseUnits, row.amountBaseUnits);
    if (row.createdAt >= dayStart) {
      dailyTotalBaseUnits = addBaseUnits(dailyTotalBaseUnits, row.amountBaseUnits);
    }
  }
  return { dailyTotalBaseUnits, monthlyTotalBaseUnits };
}
