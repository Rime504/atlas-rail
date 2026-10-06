import type { PrismaClient } from '@prisma/client';

type DbLike = Pick<PrismaClient, '$transaction'>;

/**
 * Serialises work on one key across API instances with a Postgres advisory lock held for the
 * duration of an interactive transaction. The lock is a mutex: the guarded work may use its own
 * connections, which is fine because every writer takes the same lock first.
 */
export function runExclusive<T>(db: DbLike, key: string, fn: () => Promise<T>): Promise<T> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      return fn();
    },
    { timeout: 60_000, maxWait: 15_000 },
  );
}
