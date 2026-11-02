import { resolveDevnetCoreKeys } from './devnet';

/** Public key that signed the receipts already published by this playground. */
export const PUBLISHED_RECEIPT_KEYS = ['3tDjoLJaTAhCwxQf6veR636MLEwpukaNu9gQc48ZQer3'] as const;

/**
 * Instance keys /verify trusts: the keys that signed receipts already published, this deployment's
 * own instance key, and any listed in PLAYGROUND_TRUSTED_INSTANCE_KEYS (comma-separated public keys).
 * A receipt signed by any other key is reported as not proven.
 */
export function trustedVerifyKeys(env: Record<string, string | undefined> = process.env): string[] {
  const keys = new Set<string>(PUBLISHED_RECEIPT_KEYS);
  try {
    const own = resolveDevnetCoreKeys()?.instance.publicKey;
    if (own) keys.add(own);
  } catch {
    // No devnet keys on this deployment: the published keys still verify.
  }
  for (const key of (env.PLAYGROUND_TRUSTED_INSTANCE_KEYS ?? '').split(',')) {
    if (key.trim()) keys.add(key.trim());
  }
  return [...keys];
}
