import { describe, expect, it } from 'vitest';
import { PUBLISHED_RECEIPT_KEYS, trustedVerifyKeys } from './verify-keys';

describe('/verify trusted instance keys', () => {
  it('always trusts the key that signed the receipts already published', () => {
    expect(trustedVerifyKeys({})).toEqual(expect.arrayContaining([...PUBLISHED_RECEIPT_KEYS]));
  });

  it('adds keys listed in PLAYGROUND_TRUSTED_INSTANCE_KEYS, once each', () => {
    const extra = '11111111111111111111111111111111';
    const keys = trustedVerifyKeys({ PLAYGROUND_TRUSTED_INSTANCE_KEYS: ` ${extra}, ${extra} ,` });
    expect(keys.filter((k) => k === extra)).toHaveLength(1);
  });
});
