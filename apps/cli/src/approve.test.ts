import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { LocalEd25519Signer, fromBase58, ownerApprovalText, verifyOwnerApproval, type OwnerApprovalTerms } from '@atlas-rail/mandate';
import { runApprove } from './approve';

const seed = new Uint8Array(32).fill(7);
const ownerKey = new LocalEd25519Signer(seed).publicKey;
const terms: OwnerApprovalTerms = {
  approvalId: 'own_1', mandateHash: 'a'.repeat(64), kind: 'voucher', amount: '2000000',
  recipient: '4cbWfTKc7vEPHvi7tdTTsnbKgMEKQSaMNLEfZPyDHnXU', requestHash: 'b'.repeat(64), offerHash: 'c'.repeat(64), expiresAt: 1_800_000_600,
};

function keyFile(): string {
  const file = join(mkdtempSync(join(tmpdir(), 'atlas-approve-')), 'owner.json');
  writeFileSync(file, JSON.stringify([...seed, ...fromBase58(ownerKey)]));
  return file;
}

function api(message = ownerApprovalText(terms)) {
  const posted: Array<{ scheme: 'ed25519'; signer: string; signature: string }> = [];
  const doFetch = (async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posted.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ status: 'APPROVED' }), { status: 200 });
    }
    return new Response(JSON.stringify({ status: 'PENDING', reason: 'Over the limit.', terms, message, signers: [{ publicKey: ownerKey, role: 'OWNER' }] }), { status: 200 });
  }) as typeof fetch;
  return { posted, doFetch };
}

describe('atlas approve', () => {
  it('shows the exact text and signs nothing without --yes', async () => {
    const { posted, doFetch } = api();
    const lines: string[] = [];
    expect(await runApprove({ id: 'own_1', keypair: keyFile(), api: 'http://api', yes: false, fetch: doFetch, out: (l) => lines.push(l) })).toBe(0);
    expect(lines.join('\n')).toContain('Amount: 2000000 base units');
    expect(posted).toHaveLength(0);
  });

  it('with --yes, signs that exact text with the owner key', async () => {
    const { posted, doFetch } = api();
    expect(await runApprove({ id: 'own_1', keypair: keyFile(), api: 'http://api', yes: true, fetch: doFetch, out: () => {} })).toBe(0);
    expect(posted).toHaveLength(1);
    expect(verifyOwnerApproval(terms, posted[0], { signers: [{ publicKey: ownerKey, role: 'OWNER' }], agentPublicKey: 'agent', now: 1_800_000_000 })).toMatchObject({ ok: true });
  });

  it('refuses to sign when the API text differs from the terms', async () => {
    const { posted, doFetch } = api(ownerApprovalText({ ...terms, amount: '1' }));
    const lines: string[] = [];
    expect(await runApprove({ id: 'own_1', keypair: keyFile(), api: 'http://api', yes: true, fetch: doFetch, out: (l) => lines.push(l) })).toBe(1);
    expect(lines.join('\n')).toContain('does not match the payment terms');
    expect(posted).toHaveLength(0);
  });
});
