import { describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import {
  assertMandateActiveForPayment,
  assertPaymentAgainstOnChainMandate,
  type LoadMandateResult,
} from './mandate-onchain';
import type { MandateAccountOnChain } from '@atlas-rail/solana';
import { RECOVERY_CHANNEL } from './sdk-evidence';

function account(overrides: Partial<MandateAccountOnChain> = {}): MandateAccountOnChain {
  const now = 1_700_000_000;
  return {
    mandateHash: '00'.repeat(32),
    owner: Keypair.generate().publicKey.toBase58(),
    approver: Keypair.generate().publicKey.toBase58(),
    agent: Keypair.generate().publicKey.toBase58(),
    gateAuthority: Keypair.generate().publicKey.toBase58(),
    mint: Keypair.generate().publicKey.toBase58(),
    maxPerPayment: 1000n,
    maxPerWindow: 5000n,
    windowSeconds: 86_400n,
    maxTotal: 10_000n,
    escalationThreshold: 1000n,
    notBefore: BigInt(now - 60),
    expiresAt: BigInt(now + 3600),
    createdAt: BigInt(now),
    revoked: false,
    revokedAt: 0n,
    revokedBy: '11111111111111111111111111111111',
    nextRootSeq: 0n,
    bump: 255,
    ...overrides,
  };
}

function loaded(acct: MandateAccountOnChain, active = true): LoadMandateResult {
  return {
    address: Keypair.generate().publicKey.toBase58(),
    programId: 'CnGoTE5Bxc8MFGaeK5LDv5uAZ7pNiktMunYy8JZcLY4k',
    account: acct,
    active,
    export: {} as LoadMandateResult['export'],
  };
}

describe('assertMandateActiveForPayment', () => {
  it('rejects revoked and inactive accounts', () => {
    expect(() => assertMandateActiveForPayment(loaded(account({ revoked: true }), false))).toThrow(/revoked/);
    expect(() => assertMandateActiveForPayment(loaded(account(), false))).toThrow(/not active/);
  });
});

describe('assertPaymentAgainstOnChainMandate', () => {
  it('allows a matching agent/mint under the per-payment cap', () => {
    const acct = account();
    expect(() =>
      assertPaymentAgainstOnChainMandate(loaded(acct), {
        agentPublicKey: acct.agent,
        mint: acct.mint,
        deltaAmount: 500n,
      }),
    ).not.toThrow();
  });

  it('rejects wrong agent, mint, or over-cap delta', () => {
    const acct = account();
    const base = loaded(acct);
    expect(() =>
      assertPaymentAgainstOnChainMandate(base, {
        agentPublicKey: Keypair.generate().publicKey.toBase58(),
        mint: acct.mint,
        deltaAmount: 1n,
      }),
    ).toThrow(/agent/);
    expect(() =>
      assertPaymentAgainstOnChainMandate(base, {
        agentPublicKey: acct.agent,
        mint: Keypair.generate().publicKey.toBase58(),
        deltaAmount: 1n,
      }),
    ).toThrow(/mint/);
    expect(() =>
      assertPaymentAgainstOnChainMandate(base, {
        agentPublicKey: acct.agent,
        mint: acct.mint,
        deltaAmount: 2000n,
      }),
    ).toThrow(/maxPerPayment/);
  });
});

describe('loadMandate recovery guard', () => {
  it('documents that recovery channel is not a mandate PDA', () => {
    expect(RECOVERY_CHANNEL).toBe('GEMPoRi8Si9peeMnCg6jDp36mKjT1oQLeqwm3VaveFuz');
  });
});
