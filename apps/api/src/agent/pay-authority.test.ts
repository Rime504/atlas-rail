import { describe, expect, it } from 'vitest';
import { SIGNATURE_DOMAIN, hashCanonical, ownerApprovalMessage, toBase58, verifyDomainHash, type JsonValue } from '@atlas-rail/mandate';
import { NOW, TEST_MINT, TEST_ORIGIN, signedTestMandate, signers } from '@atlas-rail/mandate/testing';
import { InMemoryOwnerApprovalStore, InMemoryPayOperationStore, InMemoryVoucherSpendStore } from '@atlas-rail/database';
import { InMemoryDecisionReceiptStore, verifyDecisionReceipt } from '@atlas-rail/receipt';
import { OwnerApprovals } from './owner-approvals';
import { DEVNET_CAIP2, PayAuthority, type PayAnswer } from './pay-authority';

const OWNER_CHAT = '777';

async function setup(options: { telegram?: boolean; readMandate?: () => Promise<{ revoked: boolean; revokedAt: number } | null> } = {}) {
  let now = NOW;
  let n = 0;
  const mandate = await signedTestMandate();
  const receipts = new InMemoryDecisionReceiptStore();
  const approvals = new OwnerApprovals({
    store: new InMemoryOwnerApprovalStore(),
    telegram: options.telegram ? { token: 't', ownerChatId: OWNER_CHAT } : null,
    clock: () => now,
    newId: (p) => `${p}_${++n}`,
    fetch: async (input) => new Response(JSON.stringify({ ok: true, result: String(input).endsWith('sendMessage') ? { message_id: 1 } : true })),
  });
  const authority = new PayAuthority({
    callers: async (id) => (id === 'research-agent' ? { mandate } : null),
    instance: signers.instance,
    spends: new InMemoryVoucherSpendStore(),
    operations: new InMemoryPayOperationStore(),
    saveReceipt: (receipt) => receipts.insert(receipt),
    approvals,
    readMandate: options.readMandate ?? (async () => ({ revoked: false, revokedAt: 0 })),
    clock: () => now,
    newId: (p) => `${p}_${++n}`,
  });
  return { authority, receipts, approvals, mandate, advance: (s: number) => (now += s) };
}

function spend(overrides: Record<string, unknown> = {}, offer: Record<string, unknown> = {}) {
  const amount = (overrides.amount_atomic as string) ?? '10000';
  const recipient = (overrides.recipient as string) ?? signers.merchant.publicKey;
  return {
    operation_id: 'op-1',
    attempt_id: 'attempt-1',
    caller_id: 'research-agent',
    request: { method: 'GET', url: `${TEST_ORIGIN}/research/summary`, headers: [['accept', 'application/json']], body: null },
    amount_atomic: amount,
    asset: TEST_MINT,
    network: DEVNET_CAIP2,
    execution_network: 'devnet',
    recipient,
    accepted: { scheme: 'exact', network: DEVNET_CAIP2, amount, asset: TEST_MINT, payTo: recipient, maxTimeoutSeconds: 60, extra: { decimals: 6 }, ...offer },
    ...overrides,
  };
}

describe('pay.sh spending authority', () => {
  it('allows a payment the mandate allows, signs the answer, and issues a verifiable decision receipt', async () => {
    const { authority, receipts } = await setup();
    const answer = (await authority.authorize(spend())) as PayAnswer;
    expect(answer).toMatchObject({ decision: 'allow', unavailable: false, reason: 'Allowed by the mandate.', operation_id: 'op-1' });
    const { atlas, ...body } = answer;
    expect(verifyDomainHash(atlas!.key, SIGNATURE_DOMAIN.authorityAnswer, hashCanonical(body as unknown as JsonValue), atlas!.signature)).toBe(true);
    const receipt = (await receipts.get(answer.receipt_id!))!;
    const verified = await verifyDecisionReceipt(receipt, { trustedInstanceKeys: [signers.instance.publicKey] });
    expect(verified.checks.filter((c) => c.status === 'FAIL')).toEqual([]);
  });

  it('gives the same attempt the same answer, never allows an operation twice, and refuses a changed request', async () => {
    const { authority } = await setup();
    const first = (await authority.authorize(spend())) as PayAnswer;
    expect(await authority.authorize(spend())).toEqual(first);
    const retry = (await authority.authorize(spend({ attempt_id: 'attempt-2' }))) as PayAnswer;
    expect(retry).toMatchObject({ decision: 'deny', reason: 'This operation was already allowed once. A new attempt is never allowed again.' });
    const changed = (await authority.authorize(spend({ amount_atomic: '20000' }))) as PayAnswer;
    expect(changed).toMatchObject({ decision: 'deny', reason: 'This operation id was already used for a different payment.' });
  });

  it('lets only one of two identical requests at the same time through', async () => {
    const { authority } = await setup();
    const [a, b] = await Promise.all([authority.authorize(spend()), authority.authorize(spend({ attempt_id: 'attempt-other' }))]);
    expect([a.decision, b.decision].filter((d) => d === 'allow')).toHaveLength(1);
  });

  it('denies mainnet, unknown callers, unknown fields, an offer that does not match, and an unlisted recipient', async () => {
    const { authority } = await setup();
    expect(await authority.authorize(spend({ network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' }))).toMatchObject({ decision: 'deny', reason: 'Atlas Rail is devnet-only until its external audit.' });
    expect(await authority.authorize(spend({ execution_network: 'mainnet' }))).toMatchObject({ decision: 'deny', reason: 'Atlas Rail is devnet-only until its external audit.' });
    expect(await authority.authorize(spend({ caller_id: 'stranger' }))).toMatchObject({ decision: 'deny', reason: 'Unknown caller: no mandate is set up for it.' });
    expect(await authority.authorize({ ...spend(), extra_field: 1 })).toMatchObject({ decision: 'deny', unavailable: false });
    expect(await authority.authorize(spend({}, { amount: '1' }))).toMatchObject({ decision: 'deny', reason: 'The request and its offer do not match.' });
    expect(await authority.authorize(spend({ operation_id: 'op-x', recipient: signers.attacker.publicKey }))).toMatchObject({ decision: 'deny', reason: "This recipient is not on the mandate's list." });
  });

  it('denies a revoked or missing mandate, and answers unavailable when Solana cannot be read', async () => {
    expect(await (await setup({ readMandate: async () => ({ revoked: true, revokedAt: NOW - 5 }) })).authority.authorize(spend())).toMatchObject({ decision: 'deny', reason: 'The owner revoked this mandate.' });
    expect(await (await setup({ readMandate: async () => null })).authority.authorize(spend())).toMatchObject({ decision: 'deny', reason: 'The mandate is not on Solana.' });
    const down = await (await setup({ readMandate: async () => { throw new Error('rpc down'); } })).authority.authorize(spend());
    expect(down).toEqual({ decision: 'deny', unavailable: true, reason: 'Atlas Rail could not decide. Nothing was approved.' });
  });

  it('over the limit without Telegram: deny with a plain reason', async () => {
    const { authority } = await setup();
    const answer = await authority.authorize(spend({ amount_atomic: '2000000' }));
    expect(answer).toMatchObject({ decision: 'deny', reason: 'Needs owner approval. Owner approvals are off.' });
  });

  it('over the limit with Telegram: waits for the owner, then allows that exact operation once on its retry', async () => {
    const { authority, approvals } = await setup({ telegram: true });
    const waiting = (await authority.authorize(spend({ amount_atomic: '2000000' }))) as PayAnswer;
    expect(waiting).toMatchObject({ decision: 'reject_before_execution', reason: 'Needs owner approval.' });
    // Still waiting: same answer, nothing reserved.
    expect((await authority.authorize(spend({ amount_atomic: '2000000', attempt_id: 'attempt-2' }))).decision).toBe('reject_before_execution');
    const found = (await approvals.toSign(waiting.approval_id!))!;
    const signature = toBase58(await signers.owner.signMessage(ownerApprovalMessage(found.terms)));
    expect(await approvals.submitSignature(waiting.approval_id!, { scheme: 'ed25519', signer: signers.owner.publicKey, signature })).toMatchObject({ ok: true });
    const allowed = await authority.authorize(spend({ amount_atomic: '2000000', attempt_id: 'attempt-3' }));
    expect(allowed).toMatchObject({ decision: 'allow', reason: "Allowed once with the owner's approval." });
    const again = await authority.authorize(spend({ amount_atomic: '2000000', attempt_id: 'attempt-4' }));
    expect(again).toMatchObject({ decision: 'deny', reason: 'This operation was already allowed once. A new attempt is never allowed again.' });
  });

  it('treats no owner answer as a deny once the approval expires', async () => {
    const { authority, advance } = await setup({ telegram: true });
    expect((await authority.authorize(spend({ amount_atomic: '2000000' }))).decision).toBe('reject_before_execution');
    advance(901);
    expect(await authority.authorize(spend({ amount_atomic: '2000000', attempt_id: 'attempt-2' }))).toMatchObject({ decision: 'deny', reason: 'The owner did not approve this payment.' });
  });

  it('counts allowed payments against the window: an operation that no longer fits is not allowed', async () => {
    const { authority } = await setup({ telegram: false });
    // Test mandate window budget is 5_000_000; five 900_000 payments fit, the sixth does not.
    for (let i = 0; i < 5; i += 1) {
      expect((await authority.authorize(spend({ operation_id: `w-${i}`, amount_atomic: '900000' }))).decision).toBe('allow');
    }
    expect((await authority.authorize(spend({ operation_id: 'w-5', amount_atomic: '900000' }))).decision).toBe('deny');
  });
});
