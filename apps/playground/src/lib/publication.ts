import type { Publication, World } from './types';

export const DEVNET_LIMIT_REASON =
  "This run reached the playground's devnet limit (5 runs an hour), so nothing was put on-chain and there is no transaction to look up.";

/**
 * Why this run's receipt cannot be published at all, or null if publishing can be attempted.
 * Every answer here is final (`retryable: false`): trying again would not change it.
 */
export function publicationBlocker(world: World, env: { devnetConfigured: boolean; storeConfigured: boolean }): Publication | null {
  const blocked = (reason: string): Publication => ({ stored: false, retryable: false, reason, txSignature: null });
  if (world.mode !== 'devnet') return blocked('Instant mode: this payment is simulated, so there is nothing on-chain to look up.');
  if (!world.devnetAllowed) return blocked(DEVNET_LIMIT_REASON);
  if (!env.devnetConfigured) return blocked('Devnet mode is not configured on this deployment.');
  if (!env.storeConfigured) return blocked('The public receipt store is not configured on this deployment.');
  if (!world.mandateOnchain) return blocked('The mandate was not registered on-chain this run, so its receipt cannot be anchored.');
  return null;
}

/** Waits between automatic publish attempts, after the first one made by the proof step itself. */
export const PUBLISH_RETRY_DELAYS_MS = [1500, 3000, 6000];

/**
 * Retries publishing until it is stored, a final (non-retryable) answer comes back, or the delays
 * run out. Never throws: a failed attempt becomes a retryable publication with the error as reason.
 */
export async function publishWithRetry(
  attempt: () => Promise<Publication>,
  opts: { delays?: number[]; sleep?: (ms: number) => Promise<void>; onAttempt?: (n: number, total: number) => void } = {},
): Promise<Publication> {
  const delays = opts.delays ?? PUBLISH_RETRY_DELAYS_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let last: Publication = { stored: false, retryable: true, reason: 'Not attempted yet.', txSignature: null };
  for (let i = 0; i < delays.length; i++) {
    await sleep(delays[i]);
    opts.onAttempt?.(i + 1, delays.length);
    try {
      last = await attempt();
    } catch (err) {
      last = { stored: false, retryable: true, reason: err instanceof Error ? err.message : String(err), txSignature: last.txSignature };
    }
    if (last.stored || !last.retryable) return last;
  }
  return last;
}
