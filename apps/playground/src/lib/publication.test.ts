import { describe, expect, it } from 'vitest';
import { DEVNET_LIMIT_REASON, publicationBlocker, publishWithRetry } from './publication';
import { initWorld, payNormal, signMandateStep } from './scenario';
import type { Publication, World } from './types';
import { anchorProveAndPublish, publishStep } from './step-proof';

const ok: Publication = { stored: true, retryable: false, reason: 'Published.', txSignature: 'tx' };
const lag: Publication = { stored: false, retryable: true, reason: 'Not every check passed: ANCHOR_ONCHAIN FAIL', txSignature: 'tx' };
const final: Publication = { stored: false, retryable: false, reason: 'not configured', txSignature: null };
const noSleep = async () => {};

describe('publicationBlocker: reasons retrying cannot fix', () => {
  const devnet = (over: Partial<World> = {}): World => ({ ...initWorld('devnet', null, true).world, mandateOnchain: { txSignature: 's', explorerUrl: 'e' }, ...over });
  const env = { devnetConfigured: true, storeConfigured: true };

  it('explains the hourly devnet limit instead of staying silent', () => {
    expect(publicationBlocker(devnet({ devnetAllowed: false }), env)).toEqual({ stored: false, retryable: false, reason: DEVNET_LIMIT_REASON, txSignature: null });
  });

  it('explains instant mode, a missing devnet setup, a missing store, and an unregistered mandate', () => {
    expect(publicationBlocker(initWorld('instant', null).world, env)?.reason).toMatch(/Instant mode/);
    expect(publicationBlocker(devnet(), { ...env, devnetConfigured: false })?.reason).toMatch(/not configured/);
    expect(publicationBlocker(devnet(), { ...env, storeConfigured: false })?.reason).toMatch(/receipt store is not configured/);
    expect(publicationBlocker(devnet({ mandateOnchain: null }), env)?.reason).toMatch(/not registered on-chain/);
  });

  it('lets a real devnet run publish', () => {
    expect(publicationBlocker(devnet(), env)).toBeNull();
  });
});

describe('publishWithRetry', () => {
  it('retries a lagging publish and stops as soon as it is stored', async () => {
    const answers = [lag, ok, ok];
    const seen: number[] = [];
    const result = await publishWithRetry(async () => answers.shift()!, { sleep: noSleep, onAttempt: (n) => seen.push(n) });
    expect(result).toEqual(ok);
    expect(seen).toEqual([1, 2]);
  });

  it('gives up after three attempts with the last reason, still retryable for the Try again button', async () => {
    let calls = 0;
    const result = await publishWithRetry(async () => (calls++, lag), { sleep: noSleep });
    expect(calls).toBe(3);
    expect(result).toEqual(lag);
  });

  it('stops at once on an answer retrying cannot change', async () => {
    let calls = 0;
    expect(await publishWithRetry(async () => (calls++, final), { sleep: noSleep })).toEqual(final);
    expect(calls).toBe(1);
  });

  it('turns a network error into a retryable failure instead of throwing', async () => {
    const result = await publishWithRetry(async () => { throw new Error('fetch failed'); }, { sleep: noSleep, delays: [0] });
    expect(result).toMatchObject({ stored: false, retryable: true, reason: 'fetch failed' });
  });

  it('waits the configured delays before each attempt', async () => {
    const waited: number[] = [];
    await publishWithRetry(async () => lag, { sleep: async (ms) => void waited.push(ms) });
    expect(waited).toEqual([1500, 3000, 6000]);
  });
});

describe('step 7 over the devnet limit (the cause of the missing link)', () => {
  async function rateLimitedWorldWithReceipt(): Promise<World> {
    let world = await signMandateStep(initWorld('devnet', null, false).world);
    world = (await payNormal(world)).world;
    return world;
  }
  it('prove says why nothing was published, as a final answer', async () => {
    const world = await rateLimitedWorldWithReceipt();
    const data = await anchorProveAndPublish(world, world.receipts[0].id);
    expect(data.publication).toMatchObject({ stored: false, retryable: false });
    expect(data.publication?.reason).toBe(DEVNET_LIMIT_REASON);
  });

  it('publish (the retry) gives the same explicit answer instead of trying again', async () => {
    const world = await rateLimitedWorldWithReceipt();
    const data = await publishStep(world, world.receipts[0].id);
    expect(data.publication).toEqual({ stored: false, retryable: false, reason: DEVNET_LIMIT_REASON, txSignature: null });
  });
});
