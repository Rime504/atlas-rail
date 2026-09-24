import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LocalEd25519Signer, hashCanonical, verifyEd25519 } from './crypto';
import {
  MandateSigningError,
  createMandate,
  hashMandate,
  linkHash,
  signMandate,
  verifyMandate,
  verifyMandateChain,
} from './mandate';
import { AgentMandate, baseUnitsSchema } from './schema';
import { NOW, signedTestMandate, signers, unsignedTestMandate } from './testing';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('createMandate', () => {
  it('produces an unsigned mandate with a stable, chain-independent hash', async () => {
    const unsigned = unsignedTestMandate();
    const signed = await signedTestMandate();
    expect(unsigned.delegationChain).toEqual([]);
    expect(hashMandate(unsigned)).toBe(hashMandate(signed));
    expect(hashMandate(unsigned)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates a random id and nonce when none are supplied, and they differ per call', () => {
    const base = unsignedTestMandate();
    const a = createMandate({ ...base, id: undefined, nonce: undefined });
    const b = createMandate({ ...base, id: undefined, nonce: undefined });
    expect(a.id).toMatch(/^mnd_[0-9A-Z]{20}$/);
    expect(a.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(a.id).not.toBe(b.id);
    expect(a.nonce).not.toBe(b.nonce);
  });

  it('rejects mainnet and unknown networks (devnet only)', () => {
    const base = unsignedTestMandate();
    expect(() =>
      createMandate({
        ...base,
        scope: { ...base.scope, allowedNetworks: ['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as never] },
      }),
    ).toThrow();
  });

  it('rejects inconsistent limits and windows', () => {
    const base = unsignedTestMandate();
    const limits = base.scope.limits;
    expect(() => createMandate({ ...base, scope: { ...base.scope, limits: { ...limits, maxPerPayment: '200000000' } } })).toThrow(/maxPerPayment/);
    expect(() => createMandate({ ...base, escalation: { ...base.escalation, thresholdBaseUnits: '60000000' } })).toThrow(/threshold/);
    expect(() => createMandate({ ...base, expiresAt: base.notBefore })).toThrow(/expiresAt/);
    expect(() => createMandate({ ...base, scope: { ...base.scope, limits: { ...limits, mint: signers.attacker.publicKey } } })).toThrow(/allowedAssets/);
  });

  it('rejects malformed resource patterns and non-integer amounts', () => {
    const base = unsignedTestMandate();
    expect(() => createMandate({ ...base, scope: { ...base.scope, allowedResources: ['http://x/a*b'] } })).toThrow();
    expect(() => createMandate({ ...base, scope: { ...base.scope, limits: { ...base.scope.limits, maxPerWindow: '5.5' } } })).toThrow();
  });
});

describe('base-unit strings', () => {
  it('accept only canonical non-negative integers up to u64', () => {
    for (const ok of ['0', '1', '10', '18446744073709551615']) expect(baseUnitsSchema.safeParse(ok).success).toBe(true);
    for (const bad of ['', '01', '-1', '1.5', ' 1', '1 ', '1e3', '0x10', '+1', 'NaN', '18446744073709551616', '１２']) {
      expect(baseUnitsSchema.safeParse(bad).success, `"${bad}" must be rejected`).toBe(false);
    }
  });

  it('property: any non-negative bigint up to u64 round-trips through the schema', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 18446744073709551615n }), (n) => {
        expect(baseUnitsSchema.safeParse(n.toString()).success).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});

describe('signMandate', () => {
  it('builds the OWNER → APPROVER → AGENT chain and verifies', async () => {
    const mandate = await signedTestMandate();
    expect(mandate.delegationChain.map((l) => l.role)).toEqual(['OWNER', 'APPROVER', 'AGENT']);
    const result = verifyMandateChain(mandate);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('does not mutate its input', async () => {
    const unsigned = unsignedTestMandate();
    await signMandate(unsigned, { role: 'OWNER', signer: signers.owner });
    expect(unsigned.delegationChain).toEqual([]);
  });

  it('enforces signing order', async () => {
    const unsigned = unsignedTestMandate();
    await expect(signMandate(unsigned, { role: 'APPROVER', signer: signers.approver })).rejects.toThrow(MandateSigningError);
    await expect(signMandate(unsigned, { role: 'AGENT', signer: signers.agent })).rejects.toThrow(MandateSigningError);
    const owned = await signMandate(unsigned, { role: 'OWNER', signer: signers.owner });
    await expect(signMandate(owned, { role: 'AGENT', signer: signers.agent })).rejects.toThrow(MandateSigningError);
  });

  it('rejects the same key signing twice (independent approver rule)', async () => {
    const owned = await signMandate(unsignedTestMandate(), { role: 'OWNER', signer: signers.owner });
    await expect(signMandate(owned, { role: 'APPROVER', signer: signers.owner })).rejects.toThrow(/already signed/);
  });

  it('requires the agent link to come from the named agent key', async () => {
    let mandate = await signMandate(unsignedTestMandate(), { role: 'OWNER', signer: signers.owner });
    mandate = await signMandate(mandate, { role: 'APPROVER', signer: signers.approver });
    await expect(signMandate(mandate, { role: 'AGENT', signer: signers.attacker })).rejects.toThrow(/named in mandate.agent/);
  });

  it('requires the configured number of approvers before the agent accepts', async () => {
    let mandate = unsignedTestMandate({ requiredApprovals: 2 });
    mandate = await signMandate(mandate, { role: 'OWNER', signer: signers.owner });
    mandate = await signMandate(mandate, { role: 'APPROVER', signer: signers.approver });
    await expect(signMandate(mandate, { role: 'AGENT', signer: signers.agent })).rejects.toThrow(/2 independent approver/);
    const full = await signedTestMandate({ requiredApprovals: 2 });
    expect(verifyMandateChain(full).valid).toBe(true);
  });
});

describe('verifyMandateChain', () => {
  it('fails an incomplete chain', async () => {
    const owned = await signMandate(unsignedTestMandate(), { role: 'OWNER', signer: signers.owner });
    const result = verifyMandateChain(owned);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/incomplete/);
  });

  it('fails when the delegation chain is reordered', async () => {
    const mandate = await signedTestMandate({ requiredApprovals: 2 });
    const reordered = clone(mandate);
    // Swap the two approvers. Roles remain valid (OWNER, APPROVER, APPROVER, AGENT) so only the signature chain can catch it.
    [reordered.delegationChain[1], reordered.delegationChain[2]] = [reordered.delegationChain[2], reordered.delegationChain[1]];
    const result = verifyMandateChain(reordered);
    expect(result.valid).toBe(false);
    expect(result.checks.find((c) => c.id === 'CHAIN_SIGNATURES')?.ok).toBe(false);
  });

  it('fails when a link is dropped or the owner is replaced', async () => {
    const mandate = await signedTestMandate();
    const dropped = clone(mandate);
    dropped.delegationChain.splice(1, 1);
    expect(verifyMandateChain(dropped).valid).toBe(false);

    const swappedOwner = clone(mandate);
    swappedOwner.delegationChain[0] = { ...swappedOwner.delegationChain[0], publicKey: signers.attacker.publicKey };
    expect(verifyMandateChain(swappedOwner).valid).toBe(false);
  });

  it('fails on a bad or corrupted signature', async () => {
    const mandate = await signedTestMandate();
    const other = await signedTestMandate({ id: 'mnd_TESTMANDATE0000000002' });
    const forged = clone(mandate);
    forged.delegationChain[1] = { ...forged.delegationChain[1], signature: other.delegationChain[1].signature };
    expect(verifyMandateChain(forged).checks.find((c) => c.id === 'CHAIN_SIGNATURES')?.ok).toBe(false);

    const flipped = clone(mandate);
    const sig = flipped.delegationChain[0].signature;
    flipped.delegationChain[0].signature = (sig[0] === '1' ? '2' : '1') + sig.slice(1);
    expect(verifyMandateChain(flipped).valid).toBe(false);
  });

  it('fails if any scope value is changed after signing', async () => {
    const mandate = await signedTestMandate();
    const widened = clone(mandate);
    widened.scope.limits.maxPerWindow = '5000001';
    expect(verifyMandateChain(widened).valid).toBe(false);

    const rerouted = clone(mandate);
    rerouted.scope.allowedPayTo = [signers.attacker.publicKey];
    expect(verifyMandateChain(rerouted).valid).toBe(false);

    const extended = clone(mandate);
    extended.expiresAt += 1;
    expect(verifyMandateChain(extended).valid).toBe(false);
  });

  it('fails when the same key appears twice or the owner also approved', async () => {
    const mandate = await signedTestMandate();
    // Forge a chain where the owner key also signs as approver by re-signing with valid links.
    let forged = await signMandate(unsignedTestMandate(), { role: 'OWNER', signer: signers.owner });
    const link = forged.delegationChain[0];
    const hash = linkHash(hashMandate(forged), 1, 'APPROVER', signers.owner.publicKey, link.signature);
    const sig = await signers.owner.signMessage(new TextEncoder().encode(`atlasrail/v0.1/mandate-link\n${hash}`));
    const { toBase58 } = await import('./crypto');
    forged = {
      ...forged,
      delegationChain: [...forged.delegationChain, { role: 'APPROVER', publicKey: signers.owner.publicKey, signature: toBase58(sig) }],
    };
    const agentHash = linkHash(hashMandate(forged), 2, 'AGENT', signers.agent.publicKey, forged.delegationChain[1].signature);
    const agentSig = await signers.agent.signMessage(new TextEncoder().encode(`atlasrail/v0.1/mandate-link\n${agentHash}`));
    forged.delegationChain.push({ role: 'AGENT', publicKey: signers.agent.publicKey, signature: toBase58(agentSig) });

    const result = verifyMandateChain(forged);
    expect(result.checks.find((c) => c.id === 'CHAIN_SIGNATURES')?.ok).toBe(true);
    expect(result.checks.find((c) => c.id === 'DISTINCT_SIGNERS')?.ok).toBe(false);
    expect(result.checks.find((c) => c.id === 'INDEPENDENT_APPROVERS')?.ok).toBe(false);
    expect(result.valid).toBe(false);
    expect(verifyMandateChain(mandate).valid).toBe(true);
  });

  it('cannot reuse a signature from one mandate on another (mandate hash is committed)', async () => {
    const a = await signedTestMandate();
    const b = await signedTestMandate({ id: 'mnd_TESTMANDATE0000000009', nonce: 'ffeeddccbbaa99887766554433221100' });
    const graft: AgentMandate = { ...b, delegationChain: a.delegationChain };
    expect(verifyMandateChain(graft).valid).toBe(false);
  });

  it('domain-separates signatures: a receipt-domain signature is not a mandate-link signature', async () => {
    const unsigned = unsignedTestMandate();
    const hash = linkHash(hashMandate(unsigned), 0, 'OWNER', signers.owner.publicKey, null);
    const wrongDomain = await signers.owner.signMessage(new TextEncoder().encode(`atlasrail/v0.1/receipt\n${hash}`));
    const { toBase58 } = await import('./crypto');
    const forged: AgentMandate = {
      ...unsigned,
      delegationChain: [{ role: 'OWNER', publicKey: signers.owner.publicKey, signature: toBase58(wrongDomain) }],
    };
    expect(verifyMandateChain(forged).checks.find((c) => c.id === 'CHAIN_SIGNATURES')?.ok).not.toBe(true);
  });

  it('enforces trusted signer keys when supplied', async () => {
    const mandate = await signedTestMandate();
    const trusted = new Map<string, readonly ('OWNER' | 'APPROVER' | 'AGENT')[]>([
      [signers.owner.publicKey, ['OWNER']],
      [signers.approver.publicKey, ['APPROVER']],
      [signers.agent.publicKey, ['AGENT']],
    ]);
    expect(verifyMandateChain(mandate, { trustedKeys: trusted }).valid).toBe(true);
    trusted.set(signers.approver.publicKey, ['OWNER']);
    expect(verifyMandateChain(mandate, { trustedKeys: trusted }).valid).toBe(false);
  });

  it('rejects non-mandate input without throwing', () => {
    for (const junk of [null, undefined, 42, 'x', [], {}, { type: 'atlasrail.agent-mandate' }]) {
      expect(verifyMandateChain(junk).valid).toBe(false);
    }
  });
});

describe('verifyMandate (time, revocation, replay)', () => {
  it('accepts a live mandate', async () => {
    const mandate = await signedTestMandate();
    expect(verifyMandate(mandate, { now: NOW }).valid).toBe(true);
  });

  it('expiry boundary: valid at expiresAt-1, invalid at expiresAt', async () => {
    const mandate = await signedTestMandate();
    expect(verifyMandate(mandate, { now: mandate.expiresAt - 1 }).valid).toBe(true);
    const atExpiry = verifyMandate(mandate, { now: mandate.expiresAt });
    expect(atExpiry.valid).toBe(false);
    expect(atExpiry.checks.find((c) => c.id === 'VALIDITY_WINDOW')?.ok).toBe(false);
  });

  it('notBefore boundary: invalid at notBefore-1, valid at notBefore', async () => {
    const mandate = await signedTestMandate();
    expect(verifyMandate(mandate, { now: mandate.notBefore - 1 }).valid).toBe(false);
    expect(verifyMandate(mandate, { now: mandate.notBefore }).valid).toBe(true);
  });

  it('honours revocation immediately', async () => {
    const mandate = await signedTestMandate();
    const revoked = verifyMandate(mandate, {
      now: NOW,
      revocation: (id) => (id === mandate.id ? { revokedAt: NOW - 1, reason: 'compromised' } : null),
    });
    expect(revoked.valid).toBe(false);
    expect(revoked.checks.find((c) => c.id === 'NOT_REVOKED')?.ok).toBe(false);
  });

  it('rejects a replayed nonce registered under another mandate id', async () => {
    const mandate = await signedTestMandate();
    const seen = verifyMandate(mandate, { now: NOW, nonceSeen: () => true });
    expect(seen.valid).toBe(false);
    expect(seen.checks.find((c) => c.id === 'NONCE_FRESH')?.ok).toBe(false);
    expect(verifyMandate(mandate, { now: NOW, nonceSeen: () => false }).valid).toBe(true);
  });
});

describe('crypto primitives', () => {
  it('verifyEd25519 never throws on garbage', () => {
    expect(verifyEd25519('nope', new Uint8Array([1]), 'nope')).toBe(false);
    expect(verifyEd25519(signers.owner.publicKey, new Uint8Array([1]), '1'.repeat(88))).toBe(false);
  });

  it('property: a signature verifies for its message and fails for any other', async () => {
    const signer = LocalEd25519Signer.generate();
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 1, maxLength: 64 }), fc.uint8Array({ minLength: 1, maxLength: 64 }), async (m1, m2) => {
        const { toBase58 } = await import('./crypto');
        const sig = toBase58(await signer.signMessage(m1));
        expect(verifyEd25519(signer.publicKey, m1, sig)).toBe(true);
        const same = m1.length === m2.length && m1.every((b, i) => b === m2[i]);
        if (!same) expect(verifyEd25519(signer.publicKey, m2, sig)).toBe(false);
      }),
      { numRuns: 50 },
    );
  });

  it('hashCanonical is stable across key order', () => {
    expect(hashCanonical({ a: 1, b: 2 })).toBe(hashCanonical({ b: 2, a: 1 }));
  });
});
