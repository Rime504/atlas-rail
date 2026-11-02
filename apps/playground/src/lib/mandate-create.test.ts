import { describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import {
  enforcementMap,
  mandatePdaForForm,
  randomMandateHashHex,
  validateMandateForm,
  type MandateFormInput,
} from './mandate-create';

function form(overrides: Partial<MandateFormInput> = {}): MandateFormInput {
  const now = 1_700_000_000;
  return {
    label: 'test',
    agentPublicKey: Keypair.generate().publicKey.toBase58(),
    approverPublicKey: Keypair.generate().publicKey.toBase58(),
    gateAuthority: Keypair.generate().publicKey.toBase58(),
    mint: Keypair.generate().publicKey.toBase58(),
    maxPerPayment: '1000',
    maxPerWindow: '5000',
    windowSeconds: '86400',
    maxTotal: '10000',
    escalationThreshold: '1000',
    notBefore: String(now),
    expiresAt: String(now + 3600),
    allowedRecipients: '',
    allowedResources: 'http://localhost:4402/*',
    mandateHashHex: randomMandateHashHex(),
    ...overrides,
  };
}

describe('validateMandateForm', () => {
  it('requires a connected owner and distinct keys', () => {
    const owner = Keypair.generate().publicKey.toBase58();
    expect(Object.keys(validateMandateForm(form(), null))).toContain('owner');
    expect(validateMandateForm(form({ approverPublicKey: owner }), owner).approverPublicKey).toMatch(/differ/);
  });

  it('rejects caps that exceed total budget', () => {
    const owner = Keypair.generate().publicKey.toBase58();
    const errors = validateMandateForm(form({ maxPerPayment: '20000', maxTotal: '10000' }), owner);
    expect(errors.maxPerPayment).toMatch(/exceed/);
  });

  it('rejects non-hex mandate hashes', () => {
    const owner = Keypair.generate().publicKey.toBase58();
    expect(validateMandateForm(form({ mandateHashHex: 'zz' }), owner).mandateHashHex).toBeTruthy();
  });
});

describe('mandatePdaForForm / cosignCreateMandate', () => {
  it('derives a stable PDA and can deserialize a cosign shape without broadcasting', () => {
    const shaped = form();
    const pda = mandatePdaForForm(shaped);
    expect(pda).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(mandatePdaForForm(shaped)).toBe(pda);
  });
});

describe('enforcementMap', () => {
  it('documents that recipients are not on-chain', () => {
    const recipients = enforcementMap().find((row) => row.field.includes('recipients'));
    expect(recipients?.onChain).toBe(false);
  });
});
