import { describe, expect, it } from 'vitest';
import {
  GateAuthorizationBody,
  buildDecisionRecord,
  contextToSnapshot,
  createGateAuthorization,
  hashDecisionRecord,
  signDecision,
  signGateRequest,
  snapshotToContext,
  verifyDecisionMatchesScope,
  verifyDecisionSignature,
  verifyGateAuthorization,
  verifyGateRequestSignature,
} from './decision';
import { evaluateGate } from './gate';
import { hashMandate } from './mandate';
import { hashOffer } from './offer';
import { NOW, signedTestMandate, signers, testContext, testOffer } from './testing';

async function makeSignedDecision(offerOverrides: Parameters<typeof testOffer>[0] = {}) {
  const mandate = await signedTestMandate();
  const offer = testOffer(offerOverrides);
  const context = testContext();
  const result = evaluateGate(mandate, offer, context);
  const record = buildDecisionRecord({
    id: 'dec_TEST',
    organizationId: 'org_test',
    mandate,
    offer,
    result,
    context,
    request: { nonce: 'n1', requestedAt: NOW, requestHash: 'a'.repeat(64), agentPublicKey: signers.agent.publicKey },
  });
  return { mandate, offer, context, result, signed: await signDecision(record, signers.instance) };
}

describe('decision records', () => {
  it('sign and verify, and bind the mandate and offer hashes', async () => {
    const { mandate, offer, signed } = await makeSignedDecision();
    expect(verifyDecisionSignature(signed).ok).toBe(true);
    expect(signed.record.mandateHash).toBe(hashMandate(mandate));
    expect(signed.record.offerHash).toBe(hashOffer(offer));
    expect(signed.decisionHash).toBe(hashDecisionRecord(signed.record));
  });

  it('detects tampering with any recorded field', async () => {
    const { signed } = await makeSignedDecision();
    const mutations: Array<(r: typeof signed.record) => void> = [
      (r) => {
        r.decision = 'DENY';
      },
      (r) => {
        r.offer.amount = '1';
      },
      (r) => {
        r.reason = 'edited';
      },
      (r) => {
        r.context.spend.totalBaseUnits = '999';
      },
      (r) => {
        r.rulesEvaluated[0].status = 'FAIL';
      },
    ];
    for (const mutate of mutations) {
      const copy = JSON.parse(JSON.stringify(signed)) as typeof signed;
      mutate(copy.record);
      expect(verifyDecisionSignature(copy).ok).toBe(false);
    }
  });

  it('rejects a decision signed by a different key than the one it claims', async () => {
    const { signed } = await makeSignedDecision();
    const forged = { ...signed, instance: { ...signed.instance, publicKey: signers.attacker.publicKey } };
    expect(verifyDecisionSignature(forged).ok).toBe(false);
  });

  it('re-evaluating the mandate on the recorded inputs reproduces the decision', async () => {
    const { mandate, signed } = await makeSignedDecision();
    const check = verifyDecisionMatchesScope(mandate, signed);
    expect(check.ok).toBe(true);
  });

  it('catches an instance that signed a decision the scope does not support', async () => {
    const { mandate, offer, context, result } = await makeSignedDecision({ payTo: signers.attacker.publicKey });
    expect(result.decision).toBe('DENY');
    // A compromised or dishonest instance flips the outcome and re-signs it: the signature is valid...
    const record = buildDecisionRecord({ id: 'dec_LIE', organizationId: 'org_test', mandate, offer, result: { ...result, decision: 'ALLOW', kind: 'AUTONOMOUS' }, context, request: null });
    const lie = await signDecision(record, signers.instance);
    expect(verifyDecisionSignature(lie).ok).toBe(true);
    // ...but the scope replay exposes it.
    const check = verifyDecisionMatchesScope(mandate, lie);
    expect(check.ok).toBe(false);
    expect(check.message).toContain('DENY');
  });

  it('rejects a decision presented against a different mandate', async () => {
    const { signed } = await makeSignedDecision();
    const other = await signedTestMandate({ id: 'mnd_TESTMANDATE0000000003', nonce: '11111111111111111111111111111111' });
    expect(verifyDecisionMatchesScope(other, signed).ok).toBe(false);
  });

  it('context snapshots round-trip', () => {
    const context = testContext({ revoked: { revokedAt: 5, reason: 'x' } });
    expect(snapshotToContext(contextToSnapshot(context))).toEqual({ ...context, revoked: { revokedAt: 5, reason: 'x' } });
  });
});

describe('agent gate requests', () => {
  const body = () => ({
    type: 'atlasrail.gate-request' as const,
    version: '0.1' as const,
    mandateId: 'mnd_TESTMANDATE0000000001',
    offer: testOffer(),
    transactionBase64: 'AAAA',
    approvalId: null,
    nonce: 'abc123',
    requestedAt: NOW,
  });

  it('are signed by the agent key and verify', async () => {
    const request = await signGateRequest(body(), signers.agent);
    expect(request.agentPublicKey).toBe(signers.agent.publicKey);
    expect(verifyGateRequestSignature(request)).toBe(true);
  });

  it('do not verify if the offer, nonce or transaction is altered', async () => {
    const request = await signGateRequest(body(), signers.agent);
    expect(verifyGateRequestSignature({ ...request, nonce: 'other' })).toBe(false);
    expect(verifyGateRequestSignature({ ...request, transactionBase64: 'BBBB' })).toBe(false);
    expect(verifyGateRequestSignature({ ...request, offer: testOffer({ amount: '1' }) })).toBe(false);
    expect(verifyGateRequestSignature({ ...request, agentPublicKey: signers.attacker.publicKey })).toBe(false);
  });
});

describe('gate authorizations (wallet-side check)', () => {
  const TX_HASH = 'b'.repeat(64);
  const body = (): GateAuthorizationBody => ({
    type: 'atlasrail.gate-authorization',
    version: '0.1',
    decisionId: 'dec_TEST',
    decisionHash: 'c'.repeat(64),
    mandateHash: 'd'.repeat(64),
    offerHash: 'e'.repeat(64),
    txMessageHash: TX_HASH,
    agentPublicKey: signers.agent.publicKey,
    notBefore: NOW,
    notAfter: NOW + 120,
  });
  const expected = (overrides = {}) => ({
    trustedInstanceKeys: [signers.instance.publicKey],
    now: NOW + 10,
    txMessageHash: TX_HASH,
    agentPublicKey: signers.agent.publicKey,
    ...overrides,
  });

  it('accepts a valid authorization for exactly this transaction and agent', async () => {
    const auth = await createGateAuthorization(body(), signers.instance);
    expect(verifyGateAuthorization(auth, expected())).toEqual({ ok: true, error: null });
  });

  it('refuses a different transaction (confused deputy: gate saw offer A, wallet asked to sign B)', async () => {
    const auth = await createGateAuthorization(body(), signers.instance);
    const result = verifyGateAuthorization(auth, expected({ txMessageHash: 'f'.repeat(64) }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('does not cover this transaction');
  });

  it('refuses a different agent, an untrusted issuer, and tampered content', async () => {
    const auth = await createGateAuthorization(body(), signers.instance);
    expect(verifyGateAuthorization(auth, expected({ agentPublicKey: signers.attacker.publicKey })).ok).toBe(false);
    expect(verifyGateAuthorization(auth, expected({ trustedInstanceKeys: [signers.attacker.publicKey] })).ok).toBe(false);
    expect(verifyGateAuthorization({ ...auth, decisionId: 'dec_OTHER' }, expected()).ok).toBe(false);
    const forged = await createGateAuthorization(body(), signers.attacker);
    expect(verifyGateAuthorization(forged, expected()).ok).toBe(false);
  });

  it('validity window boundaries: notBefore inclusive, notAfter exclusive', async () => {
    const auth = await createGateAuthorization(body(), signers.instance);
    expect(verifyGateAuthorization(auth, expected({ now: NOW - 1 })).ok).toBe(false);
    expect(verifyGateAuthorization(auth, expected({ now: NOW })).ok).toBe(true);
    expect(verifyGateAuthorization(auth, expected({ now: NOW + 119 })).ok).toBe(true);
    expect(verifyGateAuthorization(auth, expected({ now: NOW + 120 })).ok).toBe(false);
  });

  it('refuses malformed transaction hashes', async () => {
    const auth = await createGateAuthorization({ ...body(), txMessageHash: 'nothex' }, signers.instance);
    expect(verifyGateAuthorization(auth, expected({ txMessageHash: 'nothex' })).ok).toBe(false);
  });
});
