import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalJson, openWorld, sealWorld, SessionTamperedError } from './session';
import { initWorld, payNormal, signMandateStep } from './scenario';
import type { World } from './types';

/** What the browser does: JSON over the wire, back unchanged. */
const roundTrip = (world: World): unknown => JSON.parse(JSON.stringify(world));

async function sealedWorldWithSpend(): Promise<World> {
  let world = await signMandateStep(initWorld('instant', null).world);
  world = (await payNormal(world)).world;
  return sealWorld(world);
}

describe('session state is tamper-evident', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('state the server signed comes back intact through JSON', async () => {
    const sealed = await sealedWorldWithSpend();
    const opened = openWorld(roundTrip(sealed));
    expect(opened.spend).toEqual(sealed.spend);
    expect(opened.receipts).toHaveLength(1);
    expect('sessionMac' in opened).toBe(false);
  });

  it('resetting the spend totals in the browser is refused', async () => {
    const sealed = await sealedWorldWithSpend();
    expect(sealed.spend.totalBaseUnits).not.toBe('0');
    const edited = { ...(roundTrip(sealed) as World), spend: { windowAutonomousBaseUnits: '0', totalBaseUnits: '0' } };
    expect(() => openWorld(edited)).toThrow(SessionTamperedError);
  });

  it('removing a receipt, swapping a key or dropping the signature is refused', async () => {
    const sealed = roundTrip(await sealedWorldWithSpend()) as World;
    expect(() => openWorld({ ...sealed, receipts: [] })).toThrow(SessionTamperedError);
    expect(() => openWorld({ ...sealed, keys: { ...sealed.keys, owner: sealed.keys.attacker } })).toThrow(SessionTamperedError);
    const { sessionMac: _drop, ...unsigned } = sealed;
    void _drop;
    expect(() => openWorld(unsigned)).toThrow(SessionTamperedError);
    expect(() => openWorld(null)).toThrow(SessionTamperedError);
  });

  it('key order does not matter, the content does', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { f: 2, e: 3 }], c: undefined } })).toBe('{"a":{"d":[1,{"e":3,"f":2}]},"b":1}');
  });

  it('production without the session secret refuses to sign', () => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('PLAYGROUND_SESSION_SECRET', '');
    expect(() => sealWorld(initWorld('instant', null).world)).toThrow(/PLAYGROUND_SESSION_SECRET is not set/);
  });
});
