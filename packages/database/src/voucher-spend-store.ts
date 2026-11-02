import type { PrismaClient } from '@prisma/client';
import { runExclusive } from './run-exclusive';

/** One signed channel voucher, as the voucher ask records it. Amounts are base-unit strings. */
export interface VoucherSpendEntry {
  id: string;
  mandateHash: string;
  channelId: string;
  /** The voucher's cumulative total: the most the payee can settle with it. */
  cumulative: string;
  /** The slice above the previous watermark that the gate scored. */
  delta: string;
  autonomous: boolean;
  recipient: string;
  messageHash: string;
  /** Epoch seconds. */
  createdAt: number;
}

/**
 * Spend memory for the voucher ask, so a restart or a second API process sees every voucher
 * already signed. `runExclusive` holds a Postgres advisory lock per key, so check and record
 * happen together across processes.
 */
export class PrismaVoucherSpendStore {
  constructor(private readonly db: PrismaClient) {}

  runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    return runExclusive(this.db, key, fn);
  }

  async totals(mandateHash: string, now: number, windowSeconds: number) {
    const rows = await this.db.voucherSpend.findMany({ where: { mandateHash }, select: { delta: true, autonomous: true, createdAt: true } });
    const windowStart = (now - windowSeconds) * 1000;
    let total = 0n;
    let window = 0n;
    for (const row of rows) {
      total += BigInt(row.delta);
      if (row.autonomous && row.createdAt.getTime() > windowStart) window += BigInt(row.delta);
    }
    return { windowAutonomousBaseUnits: window.toString(), totalBaseUnits: total.toString() };
  }

  /** Highest cumulative signed for this channel, or null when none was. */
  async channelWatermark(mandateHash: string, channelId: string): Promise<bigint | null> {
    const rows = await this.db.voucherSpend.findMany({ where: { mandateHash, channelId }, select: { cumulative: true } });
    return rows.reduce<bigint | null>((max, row) => (max === null || BigInt(row.cumulative) > max ? BigInt(row.cumulative) : max), null);
  }

  async record(entry: VoucherSpendEntry): Promise<void> {
    await this.db.voucherSpend.create({ data: { ...entry, createdAt: new Date(entry.createdAt * 1000) } });
  }

  /** Every voucher signed for this mandate, oldest first. */
  async list(mandateHash: string): Promise<VoucherSpendEntry[]> {
    const rows = await this.db.voucherSpend.findMany({ where: { mandateHash }, orderBy: { createdAt: 'asc' } });
    return rows.map((row) => ({ ...row, createdAt: Math.floor(row.createdAt.getTime() / 1000) }));
  }
}

/** Same contract as {@link PrismaVoucherSpendStore}, in memory. Tests and the local demo. */
export class InMemoryVoucherSpendStore {
  private readonly rows: VoucherSpendEntry[] = [];
  private readonly locks = new Map<string, Promise<unknown>>();

  runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(fn);
    this.locks.set(key, run.catch(() => undefined));
    return run;
  }

  async totals(mandateHash: string, now: number, windowSeconds: number) {
    let total = 0n;
    let window = 0n;
    for (const row of this.rows.filter((r) => r.mandateHash === mandateHash)) {
      total += BigInt(row.delta);
      if (row.autonomous && row.createdAt > now - windowSeconds) window += BigInt(row.delta);
    }
    return { windowAutonomousBaseUnits: window.toString(), totalBaseUnits: total.toString() };
  }

  async channelWatermark(mandateHash: string, channelId: string): Promise<bigint | null> {
    return this.rows
      .filter((r) => r.mandateHash === mandateHash && r.channelId === channelId)
      .reduce<bigint | null>((max, r) => (max === null || BigInt(r.cumulative) > max ? BigInt(r.cumulative) : max), null);
  }

  async record(entry: VoucherSpendEntry): Promise<void> {
    if (this.rows.some((r) => r.messageHash === entry.messageHash)) throw new Error('This voucher was already recorded');
    this.rows.push({ ...entry });
  }

  async list(mandateHash: string): Promise<VoucherSpendEntry[]> {
    return this.rows.filter((r) => r.mandateHash === mandateHash).map((r) => ({ ...r }));
  }
}

/** What the voucher ask needs from a spend store. */
export type VoucherSpendStore = Pick<PrismaVoucherSpendStore, 'runExclusive' | 'totals' | 'channelWatermark' | 'record' | 'list'>;
