import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import { createRequire } from 'node:module';
import { encodeVoucherMessage } from '@atlas-rail/x402';

const { ed25519 } = createRequire(join(process.cwd(), 'packages/mandate/package.json'))('@noble/curves/ed25519');
import {
  E2E_PAYMENT,
  FORBIDDEN_CHANNEL,
  STATE_PATH,
  assertNotRecoveryChannel,
  loadPersistedVoucherPublicKey,
  persistVoucherSigner,
  verifySignerServicePublicKey,
} from '../../../scripts/devnet-e2e-new-channel.mjs';

const tmp = join(process.cwd(), '.tmp', 'e2e-signer-tests');
const priorState = (() => {
  try {
    return readFileSync(STATE_PATH, 'utf8');
  } catch {
    return null;
  }
})();

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  if (priorState == null) rmSync(STATE_PATH, { force: true });
  else writeFileSync(STATE_PATH, priorState);
});

describe('devnet e2e new channel helpers', () => {
  it('persists a voucher signer and matches the public key', () => {
    mkdirSync(tmp, { recursive: true });
    const path = join(tmp, 'voucher-sessions.json');
    const mandateId = 'mnd_ABCDEF1234';
    const keypair = Keypair.generate();
    const persisted = persistVoucherSigner({
      mandateId,
      secretKey: keypair.secretKey,
      path,
      secretPath: join(tmp, 'secret.json'),
    });
    expect(persisted.publicKey).toBe(keypair.publicKey.toBase58());
    expect(loadPersistedVoucherPublicKey(mandateId, path)).toBe(keypair.publicKey.toBase58());
    const file = JSON.parse(readFileSync(path, 'utf8'));
    expect(file.keys[`voucher:${mandateId}`].publicKey).toBe(keypair.publicKey.toBase58());
    expect(JSON.stringify(file)).not.toContain('seed phrase');
  });

  it('refuses a conflicting signer for the same mandate', () => {
    mkdirSync(tmp, { recursive: true });
    const path = join(tmp, 'voucher-sessions.json');
    const mandateId = 'mnd_ABCDEF1234';
    persistVoucherSigner({
      mandateId,
      secretKey: Keypair.generate().secretKey,
      path,
      secretPath: join(tmp, 'secret.json'),
    });
    expect(() => persistVoucherSigner({
      mandateId,
      secretKey: Keypair.generate().secretKey,
      path,
      secretPath: join(tmp, 'secret2.json'),
    })).toThrow('Signer configuration mismatch');
  });

  it('detects a signer-service public-key mismatch', async () => {
    const expected = Keypair.generate().publicKey.toBase58();
    await expect(
      verifySignerServicePublicKey({
        signerUrl: 'http://signer.test',
        mandateId: 'mnd_ABCDEF1234',
        expectedPublicKey: expected,
        fetchImpl: async () =>
          new Response(JSON.stringify({ publicKey: Keypair.generate().publicKey.toBase58() }), { status: 200 }),
      }),
    ).rejects.toThrow('Signer configuration mismatch');
  });

  it('forbids the recovery channel and requires per-action approval', async () => {
    expect(() => assertNotRecoveryChannel(FORBIDDEN_CHANNEL)).toThrow('Recovery channel is forbidden');
    const mod = await import('../../../scripts/devnet-e2e-new-channel.mjs');
    await expect(mod.phaseOpen({}, null)).rejects.toThrow('Explicit approval is required');
    await expect(mod.phaseOpen({}, 'settle')).rejects.toThrow('Explicit approval is required');
    mkdirSync(join(process.cwd(), '.tmp'), { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify({
      mandateId: 'mnd_TESTTEST12',
      authorizedSigner: Keypair.generate().publicKey.toBase58(),
      preparedOpen: { channel: FORBIDDEN_CHANNEL },
      channel: FORBIDDEN_CHANNEL,
    }));
    await expect(mod.phaseOpen({}, 'open')).rejects.toThrow('Recovery channel is forbidden');
  });

  it('checks canonical 50-byte vouchers and Ed25519 verification', () => {
    const channel = Keypair.generate().publicKey.toBase58();
    const signer = Keypair.generate();
    const message = encodeVoucherMessage({
      channelId: channel,
      cumulativeAmount: E2E_PAYMENT,
      expiresAt: 1_800_000_000n,
    });
    expect(message).toHaveLength(50);
    expect(message[0]).toBe(0x56);
    expect(message[1]).toBe(0x01);
    const signature = ed25519.sign(message, signer.secretKey.slice(0, 32));
    expect(ed25519.verify(signature, message, signer.publicKey.toBytes())).toBe(true);
    expect(ed25519.verify(signature, message, Keypair.generate().publicKey.toBytes())).toBe(false);
    const wrongChannel = encodeVoucherMessage({
      channelId: Keypair.generate().publicKey.toBase58(),
      cumulativeAmount: E2E_PAYMENT,
      expiresAt: 1_800_000_000n,
    });
    expect(Buffer.compare(Buffer.from(message), Buffer.from(wrongChannel))).not.toBe(0);
    expect(new PublicKey(channel).toBase58()).toBe(channel);
  });
});
