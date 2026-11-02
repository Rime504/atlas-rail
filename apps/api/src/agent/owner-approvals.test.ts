import { afterEach, describe, expect, it } from 'vitest';
import {
  LocalEd25519Signer,
  SOLANA_DEVNET_CAIP2,
  evaluateGate,
  ownerApprovalMessage,
  snapshotToContext,
  toBase58,
  verifyDecisionMatchesScope,
  type AgentMandate,
  type OwnerApprovalTerms,
} from '@atlas-rail/mandate';
import { NOW, TEST_MINT, TEST_ORIGIN, signedTestMandate, signers } from '@atlas-rail/mandate/testing';
import { InMemoryOwnerApprovalStore, InMemoryVoucherSpendStore } from '@atlas-rail/database';
import { GatedSignerAdapter, RunningSignerService, startSignerService } from '@atlas-rail/x402';
import { askChannelVoucher } from './channel-voucher';
import { OwnerApprovals } from './owner-approvals';

const OWNER_CHAT = '424242';
let signer: RunningSignerService | undefined;

afterEach(async () => {
  await signer?.close();
  signer = undefined;
});

/** A stand-in for api.telegram.org that records every call. */
function fakeTelegram() {
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  const doFetch: typeof fetch = async (input, init) => {
    const method = String(input).split('/').pop()!;
    calls.push({ method, body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response(JSON.stringify({ ok: true, result: method === 'sendMessage' ? { message_id: 7 } : true }), { status: 200 });
  };
  return { calls, doFetch };
}

async function setup(options: { telegram?: boolean } = {}) {
  let now = NOW;
  const tg = fakeTelegram();
  const approvals = new OwnerApprovals({
    store: new InMemoryOwnerApprovalStore(),
    telegram: options.telegram === false ? null : { token: 'test-token', ownerChatId: OWNER_CHAT },
    clock: () => now,
    newId: (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 12)}`,
    fetch: tg.doFetch,
  });
  const gated = new GatedSignerAdapter({
    inner: {
      name: 'test-agent',
      publicKey: signers.agent.publicKey,
      signMessage: (message) => signers.agent.signMessage(message),
      signTransaction: async () => {
        throw new Error('the test signer does not sign transactions');
      },
    },
    trustedInstanceKeys: [signers.instance.publicKey],
    clock: () => now,
  });
  signer = await startSignerService({ signer: gated, host: '127.0.0.1', port: 0 });
  const deps = {
    signerUrl: signer.url,
    instance: signers.instance,
    clock: () => now,
    spends: new InMemoryVoucherSpendStore(),
    approvals,
    readChannel: async () => ({ payer: signers.facilitator.publicKey, payee: signers.merchant.publicKey, mint: TEST_MINT, settled: 0n }),
    readMandate: async () => ({ agent: signers.agent.publicKey, mint: TEST_MINT, revoked: false, revokedAt: 0 }),
  };
  return { deps, approvals, tg, advance: (seconds: number) => (now += seconds) };
}

async function ask(cumulativeAmount: string, extra: Record<string, unknown> = {}) {
  return {
    mandate: await signedTestMandate(),
    channelId: signers.facilitator.publicKey,
    cumulativeAmount,
    expiresAt: NOW + 600,
    recipient: signers.merchant.publicKey,
    resourceUrl: `${TEST_ORIGIN}/research/summary`,
    asset: TEST_MINT,
    network: SOLANA_DEVNET_CAIP2,
    ...extra,
  };
}

/** What a wallet does: sign the exact text the API hands out. */
async function walletSign(key: LocalEd25519Signer, terms: OwnerApprovalTerms) {
  return { scheme: 'ed25519' as const, signer: key.publicKey, signature: toBase58(await key.signMessage(ownerApprovalMessage(terms))) };
}

async function signWith(approvals: OwnerApprovals, id: string, key: LocalEd25519Signer) {
  const found = (await approvals.toSign(id))!;
  return approvals.submitSignature(id, await walletSign(key, found.terms));
}

async function overLimit(context: Awaited<ReturnType<typeof setup>>) {
  // 2_000_000 is above the 1_000_000 escalation threshold of the test mandate.
  const first = await askChannelVoucher(await ask('2000000'), context.deps);
  if (first.signed || !first.approvalId) throw new Error('expected an approval request');
  return first.approvalId;
}

describe("owner approvals signed by the owner's wallet", () => {
  it('a valid owner signature approves that exact voucher once, and the signed decision carries it', async () => {
    const context = await setup();
    const id = await overLimit(context);
    const sent = context.tg.calls.find((call) => call.method === 'sendMessage')!;
    // Telegram only notifies: no Approve button, and it says what to sign.
    expect(sent.body.reply_markup).toBeUndefined();
    expect(String(sent.body.text)).toContain('Sign it with your wallet');
    expect(String(sent.body.text)).toContain('Amount: 2000000');

    const signed = await signWith(context.approvals, id, signers.owner);
    expect(signed).toMatchObject({ ok: true });
    const allowed = await askChannelVoucher(await ask('2000000', { approvalId: id }), context.deps);
    expect(allowed.signed).toBe(true);
    if (!allowed.signed) throw new Error('unreachable');
    expect(allowed.decision.record.kind).toBe('APPROVED');
    const approval = allowed.decision.record.context.approval!;
    expect(approval.ownerSignature).toMatchObject({ scheme: 'ed25519', signer: signers.owner.publicKey });
    expect(approval.terms).toMatchObject({ approvalId: id, amount: '2000000', recipient: signers.merchant.publicKey });
    expect(allowed.decision.record.rulesEvaluated.find((r) => r.id === 'ESCALATION_APPROVAL')?.status).toBe('PASS');
    expect(allowed.decision.record.context.review?.approvedBy).toBe(`wallet:${signers.owner.publicKey}`);
    expect(allowed.decision.instance.scheme).toBe('ed25519');
    // Anyone can replay the gate on the recorded inputs, signature included.
    expect(verifyDecisionMatchesScope(await signedTestMandate(), allowed.decision).ok).toBe(true);
  });

  it('an approver key from the mandate can sign too', async () => {
    const context = await setup();
    const id = await overLimit(context);
    expect(await signWith(context.approvals, id, signers.approver)).toMatchObject({ ok: true });
    const allowed = await askChannelVoucher(await ask('2000000', { approvalId: id }), context.deps);
    expect(allowed.signed).toBe(true);
  });

  it("the agent's key cannot approve its own payment", async () => {
    const context = await setup();
    const id = await overLimit(context);
    const result = await signWith(context.approvals, id, signers.agent);
    expect(result).toEqual({ ok: false, reason: 'Signature not accepted: the agent cannot approve its own payment.' });
    expect((await context.approvals.get(id))!.status).toBe('PENDING');
    const blocked = await askChannelVoucher(await ask('2000000', { approvalId: id }), context.deps);
    expect(blocked).toMatchObject({ signed: false, message: 'OwnerApprovalNotValid' });
  });

  it('a key outside the mandate cannot approve', async () => {
    const context = await setup();
    const id = await overLimit(context);
    expect(await signWith(context.approvals, id, signers.attacker)).toEqual({ ok: false, reason: 'Signature not accepted: signer is not an owner or approver of this mandate.' });
  });

  it('a reused approval fails', async () => {
    const context = await setup();
    const id = await overLimit(context);
    await signWith(context.approvals, id, signers.owner);
    expect((await askChannelVoucher(await ask('2000000', { approvalId: id }), context.deps)).signed).toBe(true);
    const reused = await askChannelVoucher(await ask('2000000', { approvalId: id }), context.deps);
    expect(reused).toMatchObject({ signed: false, message: 'OwnerApprovalNotValid' });
    // And the same signature cannot be submitted again.
    expect(await signWith(context.approvals, id, signers.owner)).toEqual({ ok: false, reason: 'This request is already consumed.' });
  });

  it('a changed amount fails: a signature over another amount, and a voucher for another amount', async () => {
    const context = await setup();
    const id = await overLimit(context);
    const found = (await context.approvals.toSign(id))!;
    const tampered = await walletSign(signers.owner, { ...found.terms, amount: '1' });
    expect(await context.approvals.submitSignature(id, tampered)).toEqual({ ok: false, reason: 'Signature not accepted: signature does not match this exact payment.' });

    await signWith(context.approvals, id, signers.owner);
    const other = await askChannelVoucher(await ask('3000000', { approvalId: id }), context.deps);
    expect(other).toMatchObject({ signed: false, message: 'OwnerApprovalNotValid' });
  });

  it('an expired request fails, signed or not', async () => {
    const context = await setup();
    const id = await overLimit(context);
    const found = (await context.approvals.toSign(id))!;
    const signature = await walletSign(signers.owner, found.terms);
    context.advance(901);
    expect((await context.approvals.get(id))!.status).toBe('REJECTED');
    expect(await context.approvals.submitSignature(id, signature)).toEqual({ ok: false, reason: 'Signature not accepted: approval has expired.' });
    const late = await askChannelVoucher(await ask('2000000', { approvalId: id }), context.deps);
    expect(late.signed).toBe(false);
  });

  it('the gate refuses an approval whose signature was swapped after the fact', async () => {
    const context = await setup();
    const id = await overLimit(context);
    await signWith(context.approvals, id, signers.owner);
    const allowed = await askChannelVoucher(await ask('2000000', { approvalId: id }), context.deps);
    if (!allowed.signed) throw new Error('expected a signed voucher');
    const mandate: AgentMandate = await signedTestMandate();
    const ctx = snapshotToContext(allowed.decision.record.context);
    const forged = { ...ctx, approval: { ...ctx.approval!, terms: { ...ctx.approval!.terms!, amount: '1' } } };
    const replay = evaluateGate(mandate, allowed.decision.record.offer, forged);
    expect(replay.decision).toBe('DENY');
    expect(replay.rulesEvaluated.find((r) => r.id === 'ESCALATION_APPROVAL')?.message).toContain('signature does not match this exact payment');
  });

  it('sends an unusual payment inside the mandate to the owner, and records the reason on the signed decision', async () => {
    const context = await setup();
    for (const total of ['10000', '20000', '30000']) {
      expect((await askChannelVoucher(await ask(total), context.deps)).signed).toBe(true);
    }
    // 90_000 above the last voucher: 9x the usual 10_000, still far inside every mandate limit.
    const flagged = await askChannelVoucher(await ask('120000'), context.deps);
    expect(flagged).toMatchObject({ signed: false, message: 'OwnerApprovalRequested', reason: "9x higher than this agent's usual payment." });
    if (flagged.signed) throw new Error('unreachable');
    await signWith(context.approvals, flagged.approvalId!, signers.owner);
    const paid = await askChannelVoucher(await ask('120000', { approvalId: flagged.approvalId }), context.deps);
    expect(paid.signed).toBe(true);
    if (!paid.signed) throw new Error('unreachable');
    expect(paid.decision.record.context.review).toEqual({
      reason: "9x higher than this agent's usual payment.",
      approvalId: flagged.approvalId,
      approvedBy: `wallet:${signers.owner.publicKey}`,
    });
  });

  it('blocks an unusual payment with the reason when Telegram is not configured', async () => {
    const { deps } = await setup({ telegram: false });
    for (const total of ['10000', '20000', '30000']) await askChannelVoucher(await ask(total), deps);
    const blocked = await askChannelVoucher(await ask('120000'), deps);
    expect(blocked).toMatchObject({ signed: false, message: 'BehaviourCheckBlocked', reason: "9x higher than this agent's usual payment." });
  });

  it('keeps over-limit vouchers blocked, with the reason, when Telegram is not configured', async () => {
    const { deps, tg } = await setup({ telegram: false });
    const blocked = await askChannelVoucher(await ask('2000000'), deps);
    expect(blocked).toMatchObject({ signed: false, message: 'EscalationRequiredError', reason: 'It is above the amount the agent may pay alone.' });
    expect(tg.calls).toHaveLength(0);
  });
});
