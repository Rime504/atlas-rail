import IORedis from 'ioredis';

let connection: IORedis | null = null;

/**
 * BullMQ Workers require maxRetriesPerRequest: null on their Redis connection
 * so blocking commands aren't interrupted by ioredis's own retry policy.
 */
export function getRedisConnection(): IORedis {
  if (!connection) {
    connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    });
  }
  return connection;
}
