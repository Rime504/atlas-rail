import { dirname, join, resolve } from 'node:path';
import { DevnetKeyring } from '@atlas-rail/solana';
import { GatedSignerAdapter, type VoucherKeys } from '@atlas-rail/x402';

const MANDATE_ID = /^mnd_[A-Za-z0-9]{10,40}$/;

/** Session file only. Not the long-lived keyring. scripts/channel-voucher-devnet.mjs uses the same rule. */
export function voucherSessionPath(): string {
  if (process.env.ATLAS_VOUCHER_SESSION_PATH) return resolve(process.env.ATLAS_VOUCHER_SESSION_PATH);
  if (process.env.ATLAS_KEYRING_PATH) return join(dirname(resolve(process.env.ATLAS_KEYRING_PATH)), 'voucher-sessions.json');
  return resolve('.demo/voucher-sessions.json');
}

/** One fresh devnet key per mandate id, for this session. The same id returns the same key until it is removed. */
export function mandateVoucherKeys(keyring: DevnetKeyring, trustedInstanceKeys: readonly string[]): VoucherKeys {
  const wrap = (mandateId: string, create: boolean): GatedSignerAdapter | null => {
    if (!MANDATE_ID.test(mandateId)) throw new Error('mandate id is required');
    const label = `voucher:${mandateId}`;
    if (!create && keyring.publicKey(label) === null) return null;
    return new GatedSignerAdapter({ inner: keyring.signer(label), trustedInstanceKeys });
  };
  return {
    get: (mandateId) => wrap(mandateId, false),
    mint: (mandateId) => {
      const key = wrap(mandateId, true);
      if (!key) throw new Error('mandate id is required');
      return key;
    },
    drop: (mandateId) => {
      if (!MANDATE_ID.test(mandateId)) throw new Error('mandate id is required');
      keyring.remove(`voucher:${mandateId}`);
    },
  };
}
