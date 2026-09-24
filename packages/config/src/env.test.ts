import { describe, expect, it } from 'vitest';
import { ALLOWED_SOLANA_PROGRAM_IDS, validateEnv } from './index';

const baseEnv = {
  DATABASE_URL: 'postgresql://atlas:atlas@localhost:5432/atlas_rail?schema=public',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  ENCRYPTION_KEY_BASE64: 'c29tZV9zZWNyZXRfMzJfYnl0ZV9rZXlfZm9yX2RldnZ2',
  SOLANA_RPC_URL: 'https://api.devnet.solana.com',
  SOLANA_USDC_MINT: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
};

describe('validateEnv', () => {
  it('accepts the string "false" for ATLAS_MAINNET_ENABLED (docker-compose and .env.example set it this way)', () => {
    const env = validateEnv({ ...baseEnv, ATLAS_MAINNET_ENABLED: 'false' });
    expect(env.ATLAS_MAINNET_ENABLED).toBe(false);
  });

  it('refuses to boot when mainnet is enabled', () => {
    expect(() => validateEnv({ ...baseEnv, ATLAS_MAINNET_ENABLED: 'true' })).toThrow(/ATLAS_MAINNET_ENABLED/);
  });

  it('parses "false"/"0" as false rather than coercing any non-empty string to true', () => {
    expect(validateEnv({ ...baseEnv, ATLAS_ALLOW_MOCK_SIGNER: 'false' }).ATLAS_ALLOW_MOCK_SIGNER).toBe(false);
    expect(validateEnv({ ...baseEnv, ATLAS_ALLOW_MOCK_SIGNER: '0' }).ATLAS_ALLOW_MOCK_SIGNER).toBe(false);
    expect(validateEnv({ ...baseEnv, ATLAS_ALLOW_MOCK_SIGNER: 'true' }).ATLAS_ALLOW_MOCK_SIGNER).toBe(true);
  });

  it('rejects unrecognised boolean strings instead of guessing', () => {
    expect(() => validateEnv({ ...baseEnv, ATLAS_ALLOW_MOCK_SIGNER: 'maybe' })).toThrow();
  });

  it('refuses the mock signer in production', () => {
    expect(() => validateEnv({ ...baseEnv, NODE_ENV: 'production', ATLAS_ALLOW_MOCK_SIGNER: 'true' })).toThrow(/Mock signer/);
    expect(() => validateEnv({ ...baseEnv, NODE_ENV: 'production', ATLAS_ALLOW_MOCK_SIGNER: 'false' })).not.toThrow();
  });

  it('refuses a mainnet RPC URL', () => {
    expect(() => validateEnv({ ...baseEnv, SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com' })).toThrow(/mainnet/);
  });
});

describe('ALLOWED_SOLANA_PROGRAM_IDS', () => {
  it('uses the real SPL Memo v2 program id (the previous constant did not exist on-chain)', () => {
    expect(ALLOWED_SOLANA_PROGRAM_IDS.MEMO_PROGRAM).toBe('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
  });
});
