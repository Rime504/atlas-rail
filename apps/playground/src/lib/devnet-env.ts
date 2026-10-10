/**
 * Which configuration the playground needs, by where it runs. Only names are ever reported, never values.
 *  - local (not on Vercel): missing devnet keys may be derived from the owner key, for convenience;
 *  - preview: no derivation; without its own keys, devnet mode is simply unavailable;
 *  - production: every key and the session secret must be set, or the server refuses to start.
 */

export const DEVNET_KEY_VARS = {
  owner: 'PLAYGROUND_DEVNET_OWNER_SECRET_KEY',
  approver: 'PLAYGROUND_DEVNET_APPROVER_SECRET_KEY',
  agent: 'PLAYGROUND_DEVNET_AGENT_SECRET_KEY',
  instance: 'PLAYGROUND_DEVNET_INSTANCE_SECRET_KEY',
} as const;

export const SESSION_SECRET_VAR = 'PLAYGROUND_SESSION_SECRET';

export type Deployment = 'local' | 'preview' | 'production';

type Env = Record<string, string | undefined>;

export function deploymentOf(env: Env = process.env): Deployment {
  if (!env.VERCEL) return 'local';
  return env.VERCEL_ENV === 'production' ? 'production' : 'preview';
}

/** Names of required variables that are missing in production; always empty elsewhere. */
export function missingProductionConfig(env: Env = process.env): string[] {
  if (deploymentOf(env) !== 'production') return [];
  return [...Object.values(DEVNET_KEY_VARS), SESSION_SECRET_VAR].filter((name) => !env[name]);
}

/** Called at server start (src/instrumentation.ts): production without its keys must not serve. */
export function assertProductionConfig(env: Env = process.env): void {
  const missing = missingProductionConfig(env);
  if (missing.length > 0) {
    throw new Error(`Playground production configuration is incomplete; set: ${missing.join(', ')}`);
  }
}
