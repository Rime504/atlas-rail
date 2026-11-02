import { describe, expect, it } from 'vitest';
import { toBase58 } from './crypto';
import { buildDecisionRecord, signDecision, verifyDecisionSignature } from './decision';
import { evaluateGate } from './gate';
import { hashMandate, verifyMandateChain } from './mandate';
import { hashOffer } from './offer';
import { approvalSigners, ownerApprovalMessage, ownerApprovalText, verifyOwnerApproval, type OwnerApprovalTerms } from './owner-approval';
import { NOW, signedTestMandate, signers, testContext, testOffer } from './testing';

async function setup() {
  const mandate = await signedTestMandate();
  const terms: OwnerApprovalTerms = {
    approvalId: 'own_1',
    mandateHash: 'a'.repeat(64),
    kind: 'voucher',
    amount: '2000000',
    recipient: signers.merchant.publicKey,
    requestHash: 'b'.repeat(64),
    offerHash: 'c'.repeat(64),
    expiresAt: NOW + 600,
  };
  const sign = async (key: typeof signers.owner, t = terms) => ({ scheme: 'ed25519' as const, signer: key.publicKey, signature: toBase58(await key.signMessage(ownerApprovalMessage(t))) });
  const options = { signers: approvalSigners(mandate), agentPublicKey: mandate.agent.publicKey, now: NOW };
  return { mandate, terms, sign, options };
}

describe('owner-signed approval', () => {
  it('the signed text names the payment in plain words', async () => {
    const { terms } = await setup();
    const text = ownerApprovalText(terms);
    expect(text.split('\n')[0]).toBe('atlasrail/v0.1/owner-approval');
    expect(text).toContain('Amount: 2000000 base units');
    expect(text).toContain(`Recipient: ${signers.merchant.publicKey}`);
    expect(text).toContain('Scheme: ed25519');
  });

  it('only the owner and approver keys may sign, never the agent', async () => {
    const { mandate } = await setup();
    expect(approvalSigners(mandate)).toEqual([
      { publicKey: signers.owner.publicKey, role: 'OWNER' },
      { publicKey: signers.approver.publicKey, role: 'APPROVER' },
    ]);
    expect(approvalSigners({ ...mandate, escalation: { ...mandate.escalation, approverRoles: ['APPROVER'] } })).toEqual([
      { publicKey: signers.approver.publicKey, role: 'APPROVER' },
    ]);
  });

  it('a valid signature passes', async () => {
    const { terms, sign, options } = await setup();
    expect(verifyOwnerApproval(terms, await sign(signers.owner), options)).toEqual({ ok: true, signer: { publicKey: signers.owner.publicKey, role: 'OWNER' } });
  });

  it("the agent's key fails", async () => {
    const { terms, sign, options } = await setup();
    expect(verifyOwnerApproval(terms, await sign(signers.agent), options)).toEqual({ ok: false, reason: 'the agent cannot approve its own payment' });
  });

  it('a changed amount, recipient or request fails', async () => {
    const { terms, sign, options } = await setup();
    const signature = await sign(signers.owner);
    for (const changed of [{ amount: '2000001' }, { recipient: signers.attacker.publicKey }, { requestHash: 'd'.repeat(64) }]) {
      expect(verifyOwnerApproval({ ...terms, ...changed }, signature, options)).toEqual({ ok: false, reason: 'signature does not match this exact payment' });
    }
  });

  it('an expired approval fails', async () => {
    const { terms, sign, options } = await setup();
    expect(verifyOwnerApproval(terms, await sign(signers.owner), { ...options, now: terms.expiresAt })).toEqual({ ok: false, reason: 'approval has expired' });
  });

  it('a stranger key and an unknown scheme fail', async () => {
    const { terms, sign, options } = await setup();
    expect(verifyOwnerApproval(terms, await sign(signers.attacker), options)).toMatchObject({ ok: false });
    const signature = { ...(await sign(signers.owner)), scheme: 'falcon-512' as never };
    expect(verifyOwnerApproval(terms, signature, options)).toEqual({ ok: false, reason: 'signature scheme falcon-512 is not supported' });
  });

  it('the gate passes a signed approval and refuses a reused-for-another-offer one', async () => {
    const mandate = await signedTestMandate();
    const offer = testOffer({ amount: '2000000' });
    const terms: OwnerApprovalTerms = {
      approvalId: 'own_1', mandateHash: hashMandate(mandate), kind: 'voucher', amount: '2000000',
      recipient: offer.payTo, requestHash: 'b'.repeat(64), offerHash: hashOffer(offer), expiresAt: NOW + 600,
    };
    const ownerSignature = { scheme: 'ed25519' as const, signer: signers.owner.publicKey, signature: toBase58(await signers.owner.signMessage(ownerApprovalMessage(terms))) };
    const approval = { id: 'own_1', offerHash: terms.offerHash, status: 'APPROVED' as const, expiresAt: terms.expiresAt, approver: { userId: 'wallet', role: 'OWNER' }, terms, ownerSignature };
    const allowed = evaluateGate(mandate, offer, testContext({ approval }));
    expect(allowed.decision).toBe('ALLOW');
    const other = testOffer({ amount: '2000001' });
    const refused = evaluateGate(mandate, other, testContext({ approval }));
    expect(refused.decision).toBe('DENY');
    expect(refused.rulesEvaluated.find((r) => r.id === 'ESCALATION_APPROVAL')?.status).toBe('FAIL');
  });
});

describe('signature scheme is recorded', () => {
  it('mandate links, decisions and gate signatures say ed25519', async () => {
    const mandate = await signedTestMandate();
    expect(mandate.delegationChain.every((link) => link.scheme === 'ed25519')).toBe(true);
    const offer = testOffer();
    const context = testContext();
    const decision = await signDecision(buildDecisionRecord({ id: 'dec_1', organizationId: 'org', mandate, offer, result: evaluateGate(mandate, offer, context), context, request: null }), signers.instance);
    expect(decision.instance.scheme).toBe('ed25519');
    expect(verifyDecisionSignature(decision).ok).toBe(true);
  });

  it('a missing scheme still means ed25519; any other scheme is rejected', async () => {
    const mandate = await signedTestMandate();
    const legacy = { ...mandate, delegationChain: mandate.delegationChain.map(({ scheme: _scheme, ...link }) => link) };
    expect(verifyMandateChain(legacy).valid).toBe(true);
    const other = { ...mandate, delegationChain: mandate.delegationChain.map((link) => ({ ...link, scheme: 'falcon-512' })) };
    expect(verifyMandateChain(other).valid).toBe(false);
    const offer = testOffer();
    const context = testContext();
    const decision = await signDecision(buildDecisionRecord({ id: 'dec_1', organizationId: 'org', mandate, offer, result: evaluateGate(mandate, offer, context), context, request: null }), signers.instance);
    expect(verifyDecisionSignature({ ...decision, instance: { ...decision.instance, scheme: 'falcon-512' as never } }).ok).toBe(false);
  });
});
