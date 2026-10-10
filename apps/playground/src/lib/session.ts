import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { SESSION_SECRET_VAR, deploymentOf } from './devnet-env';
import type { World } from './types';

/**
 * The playground is stateless: each response hands the session state (spend totals, receipts, keys)
 * to the browser, which sends it back with the next request. The server signs that state and
 * refuses any that comes back changed, so a visitor cannot edit their totals, receipts or keys.
 *
 * It does not stop replaying an earlier state the server itself signed in the same session (the
 * Back button does exactly that). The hosted playground has no server-side ledger; the full gate
 * service with its Postgres ledger runs with `pnpm demo`.
 */

export class SessionTamperedError extends Error {
  constructor() {
    super('This session was changed in the browser, so it was refused. Start again from step 1.');
    this.name = 'SessionTamperedError';
  }
}

let processKey: Buffer | null = null;

function sessionKey(): Buffer {
  const secret = process.env[SESSION_SECRET_VAR];
  if (secret) return createHash('sha256').update('atlas-rail-playground/session/v1/').update(secret).digest();
  if (deploymentOf() === 'production') throw new Error(`${SESSION_SECRET_VAR} is not set`);
  // Local development and previews: a key for this process only.
  processKey ??= randomBytes(32);
  return processKey;
}

/** JSON with sorted keys and undefined fields dropped: the same bytes before and after a JSON round trip. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

function mac(world: Omit<World, 'sessionMac'>): string {
  return createHmac('sha256', sessionKey()).update(canonicalJson(world)).digest('base64url');
}

/** The world as handed to the browser, with the server's signature over everything else in it. */
export function sealWorld(world: World): World {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { sessionMac, ...rest } = world;
  return { ...rest, sessionMac: mac(rest) };
}

/** The world as sent back by the browser, only if it is exactly what the server signed. */
export function openWorld(input: unknown): World {
  if (!input || typeof input !== 'object') throw new SessionTamperedError();
  const { sessionMac, ...rest } = input as World;
  if (typeof sessionMac !== 'string') throw new SessionTamperedError();
  const expected = Buffer.from(mac(rest));
  const given = Buffer.from(sessionMac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new SessionTamperedError();
  return rest as World;
}
