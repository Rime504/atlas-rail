/**
 * Worst-case red team. The agent is modelled as FULLY COMPROMISED on every attempt: the attacker
 * controls the agent process completely (any offer, any transaction bytes, any gate request, any
 * replay or tampering) except for one thing it never has — the agent's private key, which lives in
 * the gated signer and only signs a transaction the gate authorised byte for byte. Every attack goes
 * through the real gate service and the real GatedSignerAdapter; "money moved" is read from token
 * balances before and after, never from what the gate or the signer report.
 */
import {
  AgentMandate,
  GateAuthorization,
  GateOutcome,
  MessageSigner,
  SignedDecision,
  X402Offer,
  signGateRequest,
} from '@atlas-rail/mandate';
import { DevnetKeypairSigner, buildExactPaymentTransaction } from '@atlas-rail/solana';
import { GatedSignerAdapter } from '@atlas-rail/x402';

export type Stage = 'GATE' | 'SIGNER' | 'APPROVAL' | 'CHAIN' | 'NONE';

/** What one malicious attempt achieved. */
export interface AttemptResult {
  /** The gate's answer, or REJECTED when it refused to even evaluate the request. */
  decision: 'ALLOW' | 'DENY' | 'ESCALATE' | 'REJECTED' | 'NOT_ASKED';
  failedRules: string[];
  signed: boolean;
  settled: boolean;
  /** Which layer stopped it (NONE = it went through). */
  stoppedBy: Stage;
  note?: string;
}

export interface Rig {
  label: 'in-memory' | 'devnet';
  mint: string;
  merchant: string;
  attacker: string;
  agent: string;
  facilitatorKey: string;
  attackerSigner: DevnetKeypairSigner;
  agentRawSigner: DevnetKeypairSigner;
  resource: (path: string) => string;
  signer: GatedSignerAdapter;
  offer(overrides?: Partial<X402Offer>): X402Offer;
  buildTx(p: { payTo: string; amount: string; mint?: string; memo?: string | null; feePayer?: string }): Promise<string>;
  evaluate(request: Awaited<ReturnType<typeof signGateRequest>>): Promise<GateOutcome>;
  mandateId: string;
  now(): number;
  /** In-memory only: moves the shared clock (gate, approvals and gated signer all read it). */
  advance?(seconds: number): void;
  balance(owner: string): Promise<bigint>;
  submit(agentSignedBase64: string): Promise<string>;
  revoke(): Promise<void>;
  decideApproval(approvalId: string, approve: boolean): Promise<void>;
}

let nonceCounter = 0;
export const nonce = () => `rt-${Date.now()}-${++nonceCounter}`;

export async function signedRequest(
  rig: Rig,
  p: { offer: X402Offer; tx: string; approvalId?: string | null; nonce?: string; signer?: MessageSigner & { publicKey: string } },
) {
  return signGateRequest(
    {
      type: 'atlasrail.gate-request',
      version: '0.1',
      mandateId: rig.mandateId,
      offer: p.offer,
      transactionBase64: p.tx,
      approvalId: p.approvalId ?? null,
      nonce: p.nonce ?? nonce(),
      requestedAt: rig.now(),
    },
    p.signer ?? rig.agentRawSigner,
  );
}

/** Ask the gate; a thrown error means the gate refused to evaluate the request at all. */
export async function ask(
  rig: Rig,
  p: { offer: X402Offer; tx: string; approvalId?: string | null; signer?: MessageSigner & { publicKey: string } },
): Promise<{ outcome: GateOutcome | null; error: string | null }> {
  try {
    return { outcome: await rig.evaluate(await signedRequest(rig, p)), error: null };
  } catch (err) {
    return { outcome: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Try to get the gated signer to sign `tx`; a compromised agent always tries. */
export async function trySign(
  rig: Rig,
  tx: string,
  authorization: GateAuthorization | null,
  decision: SignedDecision | null,
  mandate: AgentMandate | null,
): Promise<{ signed: string | null; error: string | null }> {
  try {
    return { signed: (await rig.signer.signWithAuthorization(tx, authorization, decision, mandate)).signedBase64, error: null };
  } catch (err) {
    return { signed: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The full malicious attempt: build (possibly tampered) bytes, ask the gate, then try to sign and
 * settle no matter what the gate said. `signTx` lets a case present different bytes to the signer
 * than it showed the gate (tampering after authorisation).
 */
export async function attempt(
  rig: Rig,
  p: {
    offer: X402Offer;
    tx?: { payTo?: string; amount?: string; mint?: string; memo?: string | null; feePayer?: string };
    approvalId?: string | null;
    signTx?: (gateTx: string) => Promise<string>;
    authorization?: (real: GateAuthorization | null) => Promise<GateAuthorization | null> | GateAuthorization | null;
    requestSigner?: MessageSigner & { publicKey: string };
  },
): Promise<AttemptResult> {
  const gateTx = await rig.buildTx({
    payTo: p.tx?.payTo ?? p.offer.payTo,
    amount: p.tx?.amount ?? p.offer.amount,
    mint: p.tx?.mint ?? p.offer.asset,
    memo: p.tx?.memo,
    feePayer: p.tx?.feePayer,
  });
  const { outcome, error } = await ask(rig, { offer: p.offer, tx: gateTx, approvalId: p.approvalId, signer: p.requestSigner });
  const decision = outcome ? outcome.decision.record.decision : 'REJECTED';
  const failedRules = outcome ? outcome.decision.record.failedRules : [];
  const authorization = p.authorization ? await p.authorization(outcome?.authorization ?? null) : (outcome?.authorization ?? null);
  const signTx = p.signTx ? await p.signTx(gateTx) : gateTx;
  const sign = await trySign(rig, signTx, authorization, outcome?.decision ?? null, outcome?.mandate ?? null);
  if (!sign.signed) {
    // A case that hands the signer a substituted authorization is testing the signer, whatever the gate said.
    const stoppedBy: Stage = p.authorization ? 'SIGNER' : !outcome || decision === 'DENY' ? 'GATE' : decision === 'ESCALATE' ? 'APPROVAL' : 'SIGNER';
    return { decision, failedRules, signed: false, settled: false, stoppedBy, note: error ?? sign.error ?? undefined };
  }
  try {
    await rig.submit(sign.signed);
    return { decision, failedRules, signed: true, settled: true, stoppedBy: 'NONE' };
  } catch (err) {
    return { decision, failedRules, signed: true, settled: false, stoppedBy: 'CHAIN', note: err instanceof Error ? err.message : String(err) };
  }
}

export interface CaseContext {
  rig: Rig;
  /** Spend the case set up on purpose, legitimately, inside the mandate (e.g. to exhaust a budget). */
  authorize(amountBaseUnits: bigint): void;
}

export interface RedTeamCase {
  id: string;
  category: string;
  title: string;
  /** What should stop it, in words, for the report. */
  expected: string;
  /** Which layers may stop it; any attempt that goes through, or is stopped elsewhere, fails the case. */
  stoppedBy: Stage[];
  devnet?: boolean;
  needsClock?: boolean;
  world?: Record<string, unknown>;
  run(ctx: CaseContext): Promise<AttemptResult[]>;
}

export interface CaseOutcome {
  case: RedTeamCase;
  repetition: number;
  attempts: AttemptResult[];
  movedBaseUnits: bigint;
  authorizedBaseUnits: bigint;
  /** Value that left the agent's wallet beyond the spend the case authorised. Must be 0. */
  outsideMandateBaseUnits: bigint;
  pass: boolean;
  problems: string[];
}

export async function runCase(c: RedTeamCase, rig: Rig, repetition: number): Promise<CaseOutcome> {
  let authorized = 0n;
  const before = await rig.balance(rig.agent);
  const attempts = await c.run({ rig, authorize: (amount) => (authorized += amount) });
  const after = await rig.balance(rig.agent);
  const moved = before - after;
  const outside = moved > authorized ? moved - authorized : 0n;
  const problems: string[] = [];
  if (outside > 0n) problems.push(`${outside} base units left the wallet outside the mandate`);
  for (const a of attempts) {
    if (a.settled && a.stoppedBy === 'NONE' && !isAuthorizedAttempt(a)) problems.push('an attack attempt settled');
    if (!c.stoppedBy.includes(a.stoppedBy) && !isAuthorizedAttempt(a)) problems.push(`stopped by ${a.stoppedBy}, expected ${c.stoppedBy.join('/')}`);
  }
  return { case: c, repetition, attempts, movedBaseUnits: moved, authorizedBaseUnits: authorized, outsideMandateBaseUnits: outside, pass: problems.length === 0, problems: [...new Set(problems)] };
}

/** A case marks its own deliberate, in-mandate spend by tagging the attempt note. */
export const AUTHORIZED = 'authorized setup spend inside the mandate';
function isAuthorizedAttempt(a: AttemptResult): boolean {
  return a.note === AUTHORIZED;
}

const usd = (b: bigint) => `$${(Number(b) / 1e6).toFixed(2)}`;

export function renderReport(outcomes: CaseOutcome[], meta: { date: string; cluster: string; repetitions: number; extra?: string[] }): string {
  const attempts = outcomes.reduce((n, o) => n + o.attempts.length, 0);
  const signedAttacks = outcomes.reduce((n, o) => n + o.attempts.filter((a) => a.signed && a.note !== AUTHORIZED).length, 0);
  const outside = outcomes.reduce((n, o) => n + o.outsideMandateBaseUnits, 0n);
  const failed = outcomes.filter((o) => !o.pass);
  const byCase = new Map<string, CaseOutcome[]>();
  for (const o of outcomes) byCase.set(o.case.id, [...(byCase.get(o.case.id) ?? []), o]);

  const lines = [
    `# Red team (${meta.cluster}) — ${meta.date}`,
    '',
    'Assumes the agent is **fully compromised on every attempt**: it sends whatever offer, transaction bytes and gate request the attacker wants, replays and tampers freely, and always tries to sign. The one thing it never has is the private key, which only the gated signer holds. Every attempt goes through the real gate service and the real `GatedSignerAdapter`; money moved is read from token balances, not from what the gate reports.',
    '',
    `**Cases:** ${byCase.size} · **repetitions:** ${meta.repetitions} · **malicious attempts:** ${attempts} · **attack signatures obtained:** ${signedAttacks} · **money moved outside the mandate:** ${usd(outside)} · **result:** ${failed.length === 0 ? 'PASS' : `FAIL (${failed.length})`}`,
    '',
    '| # | Case | Category | Expected | Actual (gate decision → stopped by) | Failing rule(s) | Moved, all repetitions | Outside mandate |',
    '|---|---|---|---|---|---|---|---|',
  ];
  let i = 0;
  for (const [, runs] of byCase) {
    const c = runs[0].case;
    const all = runs.flatMap((r) => r.attempts).filter((a) => a.note !== AUTHORIZED);
    const decisions = [...new Set(all.map((a) => `${a.decision} → ${a.stoppedBy}`))].join(', ');
    const rules = [...new Set(all.flatMap((a) => a.failedRules))].join(', ') || '—';
    const moved = runs.reduce((n, r) => n + r.movedBaseUnits, 0n);
    const out = runs.reduce((n, r) => n + r.outsideMandateBaseUnits, 0n);
    const ok = runs.every((r) => r.pass);
    lines.push(`| ${++i} | ${c.title}${ok ? '' : ' **(FAIL)**'} | ${c.category} | ${c.expected} | ${decisions} | ${rules} | ${usd(moved)} | ${usd(out)} |`);
  }
  if (failed.length > 0) {
    lines.push('', '## Failures', '');
    for (const f of failed) lines.push(`- ${f.case.title} (rep ${f.repetition}): ${f.problems.join('; ')}`);
  }
  if (meta.extra) lines.push('', ...meta.extra);
  lines.push('', '"Money moved" includes spend a case set up deliberately inside the mandate (e.g. using up a daily budget before trying to exceed it); "outside mandate" is everything beyond that, and must be $0.00.');
  return lines.join('\n') + '\n';
}
