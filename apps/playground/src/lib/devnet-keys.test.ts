import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { toBase58 } from '@atlas-rail/mandate';

const ENV = ['PLAYGROUND_DEVNET_OWNER_SECRET_KEY', 'PLAYGROUND_DEVNET_APPROVER_SECRET_KEY', 'PLAYGROUND_DEVNET_AGENT_SECRET_KEY', 'PLAYGROUND_DEVNET_INSTANCE_SECRET_KEY'];
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
afterEach(() => {
  vi.unstubAllEnvs();
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function devnetFrom(load: typeof newServerInstance) {
  return (await load()).resolveDevnetCoreKeys();
}

/** A fresh import of devnet.ts is a fresh serverless instance: no module state carries over. */
async function newServerInstance() {
  vi.resetModules();
  return import('./devnet');
}

describe('devnet core keys', () => {
  it('deployed: a preview without its own approver and instance keys has no devnet mode (no derivation)', async () => {
    for (const k of ENV) delete process.env[k];
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('VERCEL_ENV', 'preview');
    process.env.PLAYGROUND_DEVNET_OWNER_SECRET_KEY = toBase58(randomBytes(32));
    process.env.PLAYGROUND_DEVNET_AGENT_SECRET_KEY = toBase58(randomBytes(32));
    expect((await newServerInstance()).resolveDevnetCoreKeys()).toBeNull();
  });

  it('deployed: production without its own approver and instance keys refuses', async () => {
    for (const k of ENV) delete process.env[k];
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('VERCEL_ENV', 'production');
    process.env.PLAYGROUND_DEVNET_OWNER_SECRET_KEY = toBase58(randomBytes(32));
    process.env.PLAYGROUND_DEVNET_AGENT_SECRET_KEY = toBase58(randomBytes(32));
    await expect(devnetFrom(newServerInstance)).rejects.toThrow(/PLAYGROUND_DEVNET_APPROVER_SECRET_KEY/);
  });

  it('deployed: production with independent keys uses exactly those', async () => {
    for (const k of ENV) delete process.env[k];
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('PLAYGROUND_SESSION_SECRET', 'test');
    for (const k of ENV) process.env[k] = toBase58(randomBytes(32));
    const keys = (await newServerInstance()).resolveDevnetCoreKeys()!;
    expect(new Set([keys.owner.publicKey, keys.approver.publicKey, keys.agent.publicKey, keys.instance.publicKey]).size).toBe(4);
  });

  it('local development: every process agrees on derived keys', async () => {
    for (const k of ENV) delete process.env[k];
    process.env.PLAYGROUND_DEVNET_OWNER_SECRET_KEY = toBase58(randomBytes(32));
    expect((await newServerInstance()).resolveDevnetCoreKeys()!.instance.publicKey).toBe((await newServerInstance()).resolveDevnetCoreKeys()!.instance.publicKey);
  });

  it('every server instance agrees on the instance (gate authority) and approver keys', async () => {
    for (const k of ENV) delete process.env[k];
    process.env.PLAYGROUND_DEVNET_OWNER_SECRET_KEY = toBase58(randomBytes(32));
    const a = (await newServerInstance()).resolveDevnetCoreKeys()!;
    const b = (await newServerInstance()).resolveDevnetCoreKeys()!;
    expect(b.instance.publicKey).toBe(a.instance.publicKey);
    expect(b.approver.publicKey).toBe(a.approver.publicKey);
    expect(b.agent.publicKey).toBe(a.agent.publicKey);
    expect(new Set([a.owner.publicKey, a.approver.publicKey, a.agent.publicKey, a.instance.publicKey]).size).toBe(4);
  });

  it('a different owner key gives different derived keys', async () => {
    for (const k of ENV) delete process.env[k];
    process.env.PLAYGROUND_DEVNET_OWNER_SECRET_KEY = toBase58(randomBytes(32));
    const a = (await newServerInstance()).resolveDevnetCoreKeys()!;
    process.env.PLAYGROUND_DEVNET_OWNER_SECRET_KEY = toBase58(randomBytes(32));
    const b = (await newServerInstance()).resolveDevnetCoreKeys()!;
    expect(b.instance.publicKey).not.toBe(a.instance.publicKey);
  });

  it('an explicitly configured key still wins', async () => {
    for (const k of ENV) delete process.env[k];
    process.env.PLAYGROUND_DEVNET_OWNER_SECRET_KEY = toBase58(randomBytes(32));
    const derived = (await newServerInstance()).resolveDevnetCoreKeys()!;
    process.env.PLAYGROUND_DEVNET_INSTANCE_SECRET_KEY = toBase58(randomBytes(32));
    const configured = (await newServerInstance()).resolveDevnetCoreKeys()!;
    expect(configured.instance.publicKey).not.toBe(derived.instance.publicKey);
    expect(configured.approver.publicKey).toBe(derived.approver.publicKey);
  });

  it('devnet mode stays off without an owner key', async () => {
    for (const k of ENV) delete process.env[k];
    expect((await newServerInstance()).resolveDevnetCoreKeys()).toBeNull();
  });
});
