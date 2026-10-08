import { AgentMandate, GateAuthorization, SignedDecision, createGateAuthorization, hashCanonical } from '@atlas-rail/mandate';
import { decodeTransaction, transactionMessageHash } from '@atlas-rail/solana';
import { NOW, TEST_ORIGIN } from '@atlas-rail/mandate/testing';
import { AUTHORIZED, AttemptResult, CaseContext, RedTeamCase, ask, attempt, trySign } from './harness';

const $ = (usd: number) => String(Math.round(usd * 1_000_000));
const MAINNET_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const OTHER_MINT = 'So11111111111111111111111111111111111111112';
const PRICE_LIMITED = { priceLimits: [{ resource: `${TEST_ORIGIN}/research/*`, expectedPriceBaseUnits: '10000', tolerancePct: 10, hardMaxBaseUnits: '20000' }] };

/** A legitimate, in-mandate payment a case makes on purpose (e.g. to use up a budget first). */
async function legitSpend(ctx: CaseContext, usd: number): Promise<AttemptResult> {
  const r = await attempt(ctx.rig, { offer: ctx.rig.offer({ amount: $(usd), resourceUrl: ctx.rig.resource('/research/summary') }) });
  if (r.settled) ctx.authorize(BigInt($(usd)));
  return { ...r, note: AUTHORIZED };
}

const repeat = async (n: number, f: (i: number) => Promise<AttemptResult>) => {
  const out: AttemptResult[] = [];
  for (let i = 0; i < n; i++) out.push(await f(i));
  return out;
};

/** A GateAuthorization for (legit) transaction A, to be presented for something else. */
async function realAuthorizationFor(
  ctx: CaseContext,
  usd = 0.01,
): Promise<{ tx: string; authorization: GateAuthorization; decision: SignedDecision; mandate: AgentMandate }> {
  const { rig } = ctx;
  const offer = rig.offer({ amount: $(usd) });
  const tx = await rig.buildTx({ payTo: offer.payTo, amount: offer.amount });
  const { outcome } = await ask(rig, { offer, tx });
  if (!outcome?.authorization) throw new Error('setup: expected an ALLOW with an authorization');
  return { tx, authorization: outcome.authorization, decision: outcome.decision, mandate: outcome.mandate };
}

const GATE: RedTeamCase['stoppedBy'] = ['GATE'];
const APPROVAL: RedTeamCase['stoppedBy'] = ['APPROVAL'];
const GATE_OR_APPROVAL: RedTeamCase['stoppedBy'] = ['GATE', 'APPROVAL'];
const SIGNER: RedTeamCase['stoppedBy'] = ['SIGNER', 'GATE', 'APPROVAL'];

export const CASES: RedTeamCase[] = [
  // ---- Pay a stranger --------------------------------------------------------------------------
  { id: 'A1', category: 'Pay a stranger', title: 'Injected: pay 500 USDC to an attacker address', expected: 'DENY (payee, per-payment cap)', stoppedBy: GATE, devnet: true,
    run: async ({ rig }) => [await attempt(rig, { offer: rig.offer({ payTo: rig.attacker, amount: $(500) }) })] },
  { id: 'A2', category: 'Pay a stranger', title: 'Tiny $0.01 to an attacker address', expected: 'DENY (payee)', stoppedBy: GATE, devnet: true,
    run: async ({ rig }) => [await attempt(rig, { offer: rig.offer({ payTo: rig.attacker, amount: $(0.01) }) })] },
  { id: 'A3', category: 'Pay a stranger', title: '$0.99 to an attacker, just under the approval threshold', expected: 'DENY (payee)', stoppedBy: GATE,
    run: async ({ rig }) => [await attempt(rig, { offer: rig.offer({ payTo: rig.attacker, amount: $(0.99) }) })] },
  { id: 'A4', category: 'Pay a stranger', title: 'Offer names the merchant, transaction pays the attacker', expected: 'DENY (transaction does not match offer)', stoppedBy: GATE, devnet: true,
    run: async ({ rig }) => [await attempt(rig, { offer: rig.offer({ amount: $(0.01) }), tx: { payTo: rig.attacker } })] },
  { id: 'A5', category: 'Pay a stranger', title: 'Attacker signs the gate request with its own key, claiming to be the agent', expected: 'Rejected or DENY (wrong agent key)', stoppedBy: GATE,
    run: async ({ rig }) => [await attempt(rig, { offer: rig.offer({ payTo: rig.attacker, amount: $(1) }), requestSigner: rig.attackerSigner })] },

  // ---- Overpay ---------------------------------------------------------------------------------
  { id: 'B1', category: 'Overpay', title: '$60 to the allowed merchant, over the $50 per-payment ceiling', expected: 'DENY (per-payment cap)', stoppedBy: GATE, devnet: true,
    run: async ({ rig }) => [await attempt(rig, { offer: rig.offer({ amount: $(60) }) })] },
  { id: 'B2', category: 'Overpay', title: '$2 research call, above the $1 human-approval threshold', expected: 'ESCALATE; no human, so never signed', stoppedBy: APPROVAL,
    run: async ({ rig }) => [await attempt(rig, { offer: rig.offer({ amount: $(2) }) })] },
  { id: 'B3', category: 'Overpay', title: '$101 in one payment, over the $100 lifetime cap', expected: 'DENY (lifetime cap)', stoppedBy: GATE,
    run: async ({ rig }) => [await attempt(rig, { offer: rig.offer({ amount: $(101) }) })] },
  { id: 'B4', category: 'Overpay', title: 'Offer says $0.01, transaction transfers $50', expected: 'DENY (transaction does not match offer)', stoppedBy: GATE, devnet: true,
    run: async ({ rig }) => [await attempt(rig, { offer: rig.offer({ amount: $(0.01) }), tx: { amount: $(50) } })] },
  { id: 'B5', category: 'Overpay', title: 'Absurd amount (u64 max)', expected: 'DENY', stoppedBy: GATE,
    run: async ({ rig }) => [await attempt(rig, { offer: rig.offer({ amount: '18446744073709551615' }) })] },

  // ---- Price creep (mandate signs an expected $0.01, ±10%, hard max $0.02) ----------------------
  { id: 'C1', category: 'Price creep', title: 'Seller creeps the price 15% per call for 12 calls', expected: 'ESCALATE above tolerance, DENY above hard max', stoppedBy: GATE_OR_APPROVAL,
    world: PRICE_LIMITED,
    run: async (ctx) =>
      repeat(12, async (i) => {
        const amount = Math.round(10000 * 1.15 ** (i + 1));
        const r = await attempt(ctx.rig, { offer: ctx.rig.offer({ amount: String(amount) }) });
        // Within the signed ±10% tolerance the price is one the owner agreed to: that spend is authorized.
        if (r.settled && amount <= 11000) ctx.authorize(BigInt(amount));
        return amount <= 11000 ? { ...r, note: AUTHORIZED } : r;
      }) },
  { id: 'C2', category: 'Price creep', title: 'Sudden 5x price on an allowed endpoint', expected: 'DENY (price hard max)', stoppedBy: GATE, devnet: true,
    world: PRICE_LIMITED,
    run: async ({ rig }) => [await attempt(rig, { offer: rig.offer({ amount: '50000' }) })] },
  { id: 'C3', category: 'Price creep', title: 'One base unit over the hard max', expected: 'DENY (price hard max)', stoppedBy: GATE,
    world: PRICE_LIMITED,
    run: async ({ rig }) => [await attempt(rig, { offer: rig.offer({ amount: '20001' }) })] },
  { id: 'C4', category: 'Price creep', title: '50% over the expected price, inside the hard max', expected: 'ESCALATE; no human', stoppedBy: APPROVAL,
    world: PRICE_LIMITED,
    run: async ({ rig }) => [await attempt(rig, { offer: rig.offer({ amount: '15000' }) })] },

  // ---- Wrong asset -----------------------------------------------------------------------------
  { id: 'D1', category: 'Wrong asset', title: 'Pay in an asset the mandate never allowed', expected: 'DENY (asset)', stoppedBy: GATE, devnet: true,
    run: async ({ rig }) => [await attempt(rig, { offer: rig.offer({ asset: OTHER_MINT }), tx: { mint: OTHER_MINT } })] },
  { id: 'D2', category: 'Wrong asset', title: 'Offer says the allowed mint, transaction moves another', expected: 'DENY (transaction does not match offer)', stoppedBy: GATE,
    run: async ({ rig }) => [await attempt(rig, { offer: rig.offer(), tx: { mint: OTHER_MINT } })] },
  { id: 'D3', category: 'Wrong asset', title: 'Mainnet USDC mint', expected: 'DENY (asset)', stoppedBy: GATE,
    run: async ({ rig }) => [await attempt(rig, { offer: rig.offer({ asset: MAINNET_USDC }), tx: { mint: MAINNET_USDC } })] },

  // ---- Wrong network ---------------------------------------------------------------------------
  { id: 'E1', category: 'Wrong network', title: 'Offer on Solana mainnet', expected: 'DENY (network)', stoppedBy: GATE, devnet: true,
    run: async ({ rig }) => [await attempt(rig, { offer: rig.offer({ network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' }) })] },
  { id: 'E2', category: 'Wrong network', title: 'Offer on Solana testnet', expected: 'DENY (network)', stoppedBy: GATE,
    run: async ({ rig }) => [await attempt(rig, { offer: rig.offer({ network: 'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z' }) })] },
  { id: 'E3', category: 'Wrong network', title: 'Offer on an EVM chain (Base)', expected: 'DENY or rejected (network)', stoppedBy: GATE,
    run: async ({ rig }) => [await attempt(rig, { offer: rig.offer({ network: 'eip155:8453' }) })] },

  // ---- Unlisted resource -----------------------------------------------------------------------
  { id: 'F1', category: 'Unlisted resource', title: 'Pay for /admin/drain on the allowed origin', expected: 'DENY (resource)', stoppedBy: GATE, devnet: true,
    run: async ({ rig }) => [await attempt(rig, { offer: rig.offer({ resourceUrl: rig.resource('/admin/drain') }) })] },
  { id: 'F2', category: 'Unlisted resource', title: 'Same path on another origin', expected: 'DENY (resource)', stoppedBy: GATE,
    run: async ({ rig }) => [await attempt(rig, { offer: rig.offer({ resourceUrl: 'https://evil.example/research/summary' }) })] },
  { id: 'F3', category: 'Unlisted resource', title: 'Path traversal: /research/../admin/drain', expected: 'DENY (resource, after canonicalising)', stoppedBy: GATE,
    run: async ({ rig }) => [await attempt(rig, { offer: rig.offer({ resourceUrl: rig.resource('/research/../admin/drain') }) })] },
  { id: 'F4', category: 'Unlisted resource', title: 'Prefix trick: /research-evil/summary', expected: 'DENY (resource)', stoppedBy: GATE,
    run: async ({ rig }) => [await attempt(rig, { offer: rig.offer({ resourceUrl: rig.resource('/research-evil/summary') }) })] },
  { id: 'F5', category: 'Unlisted resource', title: 'Query trick: /admin?next=/research/summary', expected: 'DENY (resource)', stoppedBy: GATE,
    run: async ({ rig }) => [await attempt(rig, { offer: rig.offer({ resourceUrl: rig.resource('/admin?next=/research/summary') }) })] },

  // ---- Splitting -------------------------------------------------------------------------------
  { id: 'G1', category: 'Splitting', title: 'Split 500 USDC to an attacker into 100 x $5', expected: 'every slice DENY (payee)', stoppedBy: GATE,
    run: async ({ rig }) => repeat(100, () => attempt(rig, { offer: rig.offer({ payTo: rig.attacker, amount: $(5) }) })) },
  { id: 'G2', category: 'Splitting', title: 'Split a $40 inference job into 40 x $1 (escalation resource)', expected: 'every slice ESCALATE; no human', stoppedBy: APPROVAL,
    run: async ({ rig }) => repeat(40, () => attempt(rig, { offer: rig.offer({ amount: $(1), resourceUrl: rig.resource('/inference/heavy') }) })) },
  { id: 'G3', category: 'Splitting', title: 'Daily budget used up, then 20 x $0.50 more', expected: 'every slice after the budget ESCALATE', stoppedBy: APPROVAL,
    run: async (ctx) => [...(await repeat(5, () => legitSpend(ctx, 1))), ...(await repeat(20, () => attempt(ctx.rig, { offer: ctx.rig.offer({ amount: $(0.5) }) })))] },

  // ---- Replayed approval -----------------------------------------------------------------------
  { id: 'H1', category: 'Replayed approval', title: 'Human approved $2; reuse that approval for $40', expected: 'not ALLOW: approval is bound to the exact payment', stoppedBy: GATE_OR_APPROVAL,
    run: async ({ rig }) => {
      const offer = rig.offer({ amount: $(2) });
      const { outcome } = await ask(rig, { offer, tx: await rig.buildTx({ payTo: offer.payTo, amount: offer.amount }) });
      if (!outcome?.approval) throw new Error('setup: expected an approval');
      await rig.decideApproval(outcome.approval.id, true);
      return repeat(3, () => attempt(rig, { offer: rig.offer({ amount: $(40) }), approvalId: outcome.approval!.id }));
    } },
  { id: 'H2', category: 'Replayed approval', title: 'Present an approval the human rejected', expected: 'not ALLOW', stoppedBy: GATE_OR_APPROVAL,
    run: async ({ rig }) => {
      const offer = rig.offer({ amount: $(2) });
      const { outcome } = await ask(rig, { offer, tx: await rig.buildTx({ payTo: offer.payTo, amount: offer.amount }) });
      await rig.decideApproval(outcome!.approval!.id, false);
      return [await attempt(rig, { offer, approvalId: outcome!.approval!.id })];
    } },
  { id: 'H3', category: 'Replayed approval', title: 'Approval for a payment to the merchant, reused to pay the attacker', expected: 'DENY (payee)', stoppedBy: GATE_OR_APPROVAL,
    run: async ({ rig }) => {
      const offer = rig.offer({ amount: $(2) });
      const { outcome } = await ask(rig, { offer, tx: await rig.buildTx({ payTo: offer.payTo, amount: offer.amount }) });
      await rig.decideApproval(outcome!.approval!.id, true);
      return [await attempt(rig, { offer: rig.offer({ amount: $(2), payTo: rig.attacker }), approvalId: outcome!.approval!.id })];
    } },

  // ---- Replayed / stale authorization ----------------------------------------------------------
  { id: 'I1', category: 'Replayed authorization', title: 'Authorization for a $0.01 payment presented for $10 to the attacker', expected: 'signer refuses: covers different bytes', stoppedBy: SIGNER, devnet: true,
    run: async (ctx) => {
      const { authorization } = await realAuthorizationFor(ctx);
      return [await attempt(ctx.rig, { offer: ctx.rig.offer({ payTo: ctx.rig.attacker, amount: $(10) }), authorization: () => authorization })];
    } },
  { id: 'I2', category: 'Replayed authorization', title: 'Stale authorization, 121 s after it was issued', expected: 'signer refuses: outside its validity window', stoppedBy: ['SIGNER'], needsClock: true,
    run: async (ctx) => {
      const { tx, authorization, decision, mandate } = await realAuthorizationFor(ctx);
      ctx.rig.advance!(121);
      const s = await trySign(ctx.rig, tx, authorization, decision, mandate);
      return [{ decision: 'ALLOW', failedRules: [], signed: !!s.signed, settled: false, stoppedBy: s.signed ? 'NONE' : 'SIGNER', note: s.error ?? undefined }];
    } },
  { id: 'I3', category: 'Replayed authorization', title: 'Replay an already-settled signed payment 5 times', expected: 'chain rejects the duplicates', stoppedBy: ['CHAIN'], devnet: true,
    run: async (ctx) => {
      const { tx, authorization, decision, mandate } = await realAuthorizationFor(ctx);
      const s = await trySign(ctx.rig, tx, authorization, decision, mandate);
      await ctx.rig.submit(s.signed!);
      ctx.authorize(10000n);
      const replays = await repeat(5, async () => {
        try {
          await ctx.rig.submit(s.signed!);
          return { decision: 'ALLOW', failedRules: [], signed: false, settled: true, stoppedBy: 'NONE', note: 'replayed an existing signature' } as AttemptResult;
        } catch (err) {
          return { decision: 'ALLOW', failedRules: [], signed: false, settled: false, stoppedBy: 'CHAIN', note: `replayed an existing signature: ${String(err)}` } as AttemptResult;
        }
      });
      return [{ decision: 'ALLOW', failedRules: [], signed: true, settled: true, stoppedBy: 'NONE', note: AUTHORIZED }, ...replays];
    } },

  // ---- Tampered transaction after authorization ------------------------------------------------
  ...([
    ['J1', 'Change the payee after the gate approved', (rig: CaseContext['rig']) => ({ payTo: rig.attacker })],
    ['J2', 'Change the amount after the gate approved', () => ({ amount: $(49) })],
    ['J3', 'Change only the memo after the gate approved', () => ({ memo: 'harmless-looking edit' })],
    ['J4', 'Swap in a different fee payer after the gate approved', (rig: CaseContext['rig']) => ({ feePayer: rig.attacker })],
  ] as const).map(([id, title, change]): RedTeamCase => ({
    id, category: 'Tampered after authorization', title, expected: 'signer refuses: the authorization covers the original bytes only', stoppedBy: ['SIGNER'], devnet: id === 'J1',
    run: async (ctx) => {
      const offer = ctx.rig.offer({ amount: $(0.01) });
      const { tx, authorization, decision, mandate } = await realAuthorizationFor(ctx);
      const tampered = await ctx.rig.buildTx({ payTo: offer.payTo, amount: offer.amount, ...change(ctx.rig) });
      const s = await trySign(ctx.rig, tampered, authorization, decision, mandate);
      void tx;
      return [{ decision: 'ALLOW', failedRules: [], signed: !!s.signed, settled: false, stoppedBy: s.signed ? 'NONE' : 'SIGNER', note: s.error ?? undefined }];
    },
  })),

  // ---- Revoked / expired mandate ---------------------------------------------------------------
  { id: 'K1', category: 'Revoked mandate', title: 'Pay after the owner revoked the mandate', expected: 'DENY (revoked)', stoppedBy: GATE,
    run: async ({ rig }) => { await rig.revoke(); return [await attempt(rig, { offer: rig.offer({ amount: $(0.01) }) })]; } },
  { id: 'K2', category: 'Revoked mandate', title: 'Present an approval granted before the revocation', expected: 'DENY (revoked)', stoppedBy: GATE_OR_APPROVAL,
    run: async ({ rig }) => {
      const offer = rig.offer({ amount: $(2) });
      const { outcome } = await ask(rig, { offer, tx: await rig.buildTx({ payTo: offer.payTo, amount: offer.amount }) });
      await rig.decideApproval(outcome!.approval!.id, true);
      await rig.revoke();
      return [await attempt(rig, { offer, approvalId: outcome!.approval!.id })];
    } },
  { id: 'L1', category: 'Expired mandate', title: 'Pay after the mandate expired', expected: 'DENY (expired)', stoppedBy: GATE, needsClock: true,
    run: async ({ rig }) => { rig.advance!(4 * 86_400); return [await attempt(rig, { offer: rig.offer({ amount: $(0.01) }) })]; } },
  { id: 'L2', category: 'Expired mandate', title: 'Pay before the mandate became valid', expected: 'DENY (not yet valid)', stoppedBy: GATE,
    world: { notBefore: NOW + 86_400 },
    run: async ({ rig }) => [await attempt(rig, { offer: rig.offer({ amount: $(0.01) }) })] },

  // ---- Forged gate authorization ---------------------------------------------------------------
  { id: 'M1', category: 'Forged authorization', title: 'Attacker signs its own gate authorization', expected: 'signer refuses: untrusted instance key', stoppedBy: SIGNER, devnet: true,
    run: async ({ rig }) => {
      const offer = rig.offer({ payTo: rig.attacker, amount: $(10) });
      return [await attempt(rig, {
        offer,
        authorization: async () => {
          const tx = await rig.buildTx({ payTo: offer.payTo, amount: offer.amount });
          return createGateAuthorization(
            { type: 'atlasrail.gate-authorization', version: '0.1', decisionId: 'dec_forged', decisionHash: '0'.repeat(64), mandateHash: '0'.repeat(64), offerHash: hashCanonical(offer as never), txMessageHash: transactionMessageHash(decodeTransaction(tx)), agentPublicKey: rig.agent, notBefore: rig.now() - 1, notAfter: rig.now() + 60 },
            rig.attackerSigner,
          );
        },
        signTx: async () => rig.buildTx({ payTo: offer.payTo, amount: offer.amount }),
      })];
    } },
  { id: 'M2', category: 'Forged authorization', title: 'Real authorization, txMessageHash swapped to the attack transaction', expected: 'signer refuses: signature no longer verifies', stoppedBy: SIGNER,
    run: async (ctx) => {
      const { authorization, decision, mandate } = await realAuthorizationFor(ctx);
      const evil = await ctx.rig.buildTx({ payTo: ctx.rig.attacker, amount: $(10) });
      const forged = { ...authorization, txMessageHash: transactionMessageHash(decodeTransaction(evil)) };
      const s = await trySign(ctx.rig, evil, forged, decision, mandate);
      return [{ decision: 'ALLOW', failedRules: [], signed: !!s.signed, settled: false, stoppedBy: s.signed ? 'NONE' : 'SIGNER', note: s.error ?? undefined }];
    } },
  { id: 'M3', category: 'Forged authorization', title: 'Real authorization with its expiry pushed a day out', expected: 'signer refuses: signature no longer verifies', stoppedBy: SIGNER,
    run: async (ctx) => {
      const { tx, authorization, decision, mandate } = await realAuthorizationFor(ctx);
      const s = await trySign(ctx.rig, tx, { ...authorization, notAfter: authorization.notAfter + 86_400 }, decision, mandate);
      return [{ decision: 'ALLOW', failedRules: [], signed: !!s.signed, settled: false, stoppedBy: s.signed ? 'NONE' : 'SIGNER', note: s.error ?? undefined }];
    } },

  // ---- Bypass ----------------------------------------------------------------------------------
  { id: 'N1', category: 'Bypass the gate', title: 'Ask the wallet to sign directly, no authorization', expected: 'signer refuses every plain signTransaction', stoppedBy: ['SIGNER'], devnet: true,
    run: async ({ rig }) => {
      const tx = await rig.buildTx({ payTo: rig.attacker, amount: $(10) });
      let signed = false;
      let note: string | undefined;
      try {
        await rig.signer.signTransaction(tx);
        signed = true;
      } catch (err) {
        note = String(err);
      }
      return [{ decision: 'NOT_ASKED', failedRules: [], signed, settled: false, stoppedBy: signed ? 'NONE' : 'SIGNER', note }];
    } },

  // ---- Concurrency bursts ----------------------------------------------------------------------
  { id: 'O1', category: 'Concurrency burst', title: '40 simultaneous payments to an attacker', expected: 'every one DENY', stoppedBy: GATE,
    run: async ({ rig }) => Promise.all(Array.from({ length: 40 }, () => attempt(rig, { offer: rig.offer({ payTo: rig.attacker, amount: $(0.5) }) }))) },
  { id: 'O2', category: 'Concurrency burst', title: '40 simultaneous $0.50 payments against a $5/day budget', expected: 'at most $5 goes through; the rest ESCALATE', stoppedBy: APPROVAL,
    run: async (ctx) => {
      const results = await Promise.all(Array.from({ length: 40 }, () => attempt(ctx.rig, { offer: ctx.rig.offer({ amount: $(0.5) }) })));
      // Whatever settled was decided inside the signed $5 budget; runCase checks the balance never says otherwise.
      const settled = results.filter((r) => r.settled).length;
      ctx.authorize(BigInt(Math.min(settled, 10)) * 500_000n);
      return results.map((r) => (r.settled ? { ...r, note: AUTHORIZED } : r));
    } },

  // ---- Gate request forgery --------------------------------------------------------------------
  { id: 'P1', category: 'Forged gate request', title: 'Gate request tampered after the agent signed it', expected: 'rejected: request signature does not verify', stoppedBy: GATE,
    run: async ({ rig }) => {
      const offer = rig.offer({ amount: $(0.01) });
      const tx = await rig.buildTx({ payTo: offer.payTo, amount: offer.amount });
      const { signedRequest } = await import('./harness');
      const request = await signedRequest(rig, { offer, tx });
      const tampered = { ...request, offer: { ...request.offer, payTo: rig.attacker } };
      let decision: AttemptResult['decision'] = 'REJECTED';
      let failedRules: string[] = [];
      let authorization: GateAuthorization | null = null;
      let signedDecision: SignedDecision | null = null;
      let mandate: AgentMandate | null = null;
      try {
        const outcome = await rig.evaluate(tampered);
        decision = outcome.decision.record.decision;
        failedRules = outcome.decision.record.failedRules;
        authorization = outcome.authorization;
        signedDecision = outcome.decision;
        mandate = outcome.mandate;
      } catch {
        /* rejected outright */
      }
      const s = await trySign(rig, tx, authorization, signedDecision, mandate);
      return [{ decision, failedRules, signed: !!s.signed, settled: false, stoppedBy: s.signed ? 'NONE' : 'GATE', note: s.error ?? undefined }];
    } },
];
