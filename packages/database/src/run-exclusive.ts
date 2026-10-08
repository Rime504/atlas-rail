import type { PrismaClient } from '@prisma/client';

type DbLike = Pick<PrismaClient, '$transaction'>;

const inProcess = new Map<string, Promise<unknown>>();

/**
 * Serialises work on one key across API instances with a Postgres advisory lock held for the
 * duration of an interactive transaction. The lock is a mutex: the guarded work may use its own
 * connections, which is fine because every writer takes the same lock first.
 *
 * Waiters are queued in-process first, so at most one request per key per process is ever parked
 * on the advisory lock. Without that, a burst on one mandate (100 simultaneous payments) parks every
 * request on the lock while holding a pool connection, the lock holder can't get a connection for
 * its own queries, and everything times out (failing closed, but failing).
 */
export function runExclusive<T>(db: DbLike, key: string, fn: () => Promise<T>): Promise<T> {
  const previous = inProcess.get(key) ?? Promise.resolve();
  const run = previous
    .catch(() => undefined)
    .then(() =>
      db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
          return fn();
        },
        { timeout: 60_000, maxWait: 15_000 },
      ),
    );
  const tail = run.catch(() => undefined);
  inProcess.set(key, tail);
  void tail.then(() => {
    if (inProcess.get(key) === tail) inProcess.delete(key);
  });
  return run;
}
