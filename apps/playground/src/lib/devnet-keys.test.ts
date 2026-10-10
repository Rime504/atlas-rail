import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { toBase58 } from '@atlas-rail/mandate';

const ENV = ['PLAYGROUND_DEVNET_OWNER_SECRET_KEY', 'PLAYGROUND_DEVNET_APPROVER_SECRET_KEY', 'PLAYGROUND_DEVNET_AGENT_SECRET_KEY', 'PLAYGROUND_DEVNET_INSTANCE_SECRET_KEY'];
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** A fresh import of devnet.ts is a fresh serverless instance: no module state carries over. */
async function newServerInstance() {
  vi.resetModules();
  return import('./devnet');
}

describe('devnet core keys', () => {
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
