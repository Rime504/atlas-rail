import { describe, expect, it } from 'vitest';
import { assertProductionConfig, deploymentOf, missingProductionConfig } from './devnet-env';

const ALL = {
  PLAYGROUND_DEVNET_OWNER_SECRET_KEY: 'x',
  PLAYGROUND_DEVNET_APPROVER_SECRET_KEY: 'x',
  PLAYGROUND_DEVNET_AGENT_SECRET_KEY: 'x',
  PLAYGROUND_DEVNET_INSTANCE_SECRET_KEY: 'x',
  PLAYGROUND_SESSION_SECRET: 'x',
};

describe('playground configuration by deployment', () => {
  it('knows where it runs', () => {
    expect(deploymentOf({})).toBe('local');
    expect(deploymentOf({ VERCEL: '1', VERCEL_ENV: 'preview' })).toBe('preview');
    expect(deploymentOf({ VERCEL: '1', VERCEL_ENV: 'production' })).toBe('production');
  });

  it('production with every key and the session secret starts', () => {
    expect(() => assertProductionConfig({ VERCEL: '1', VERCEL_ENV: 'production', ...ALL })).not.toThrow();
  });

  it('production missing the approver or instance key refuses to start, naming the variables only', () => {
    const secretValue = 'super-secret-value';
    const env = { VERCEL: '1', VERCEL_ENV: 'production', ...ALL, PLAYGROUND_DEVNET_OWNER_SECRET_KEY: secretValue, PLAYGROUND_DEVNET_APPROVER_SECRET_KEY: undefined, PLAYGROUND_DEVNET_INSTANCE_SECRET_KEY: '' };
    expect(missingProductionConfig(env)).toEqual(['PLAYGROUND_DEVNET_APPROVER_SECRET_KEY', 'PLAYGROUND_DEVNET_INSTANCE_SECRET_KEY']);
    expect(() => assertProductionConfig(env)).toThrow(/PLAYGROUND_DEVNET_APPROVER_SECRET_KEY, PLAYGROUND_DEVNET_INSTANCE_SECRET_KEY/);
    try {
      assertProductionConfig(env);
    } catch (err) {
      expect(String(err)).not.toContain(secretValue);
    }
  });

  it('local development and previews never refuse to start', () => {
    expect(missingProductionConfig({})).toEqual([]);
    expect(missingProductionConfig({ VERCEL: '1', VERCEL_ENV: 'preview' })).toEqual([]);
  });
});
