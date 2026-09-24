import { addBaseUnits, compareBaseUnits } from '@atlas-rail/domain';
import { verifyMandateChain, hashMandate } from './mandate';
import { X402Offer, hashOffer, x402OfferSchema } from './offer';
import { matchesAnyResourcePattern } from './resource';
import { AgentMandate, BASE_UNITS_PATTERN, SUPPORTED_NETWORKS, agentMandateSchema } from './schema';

/**
 * The Policy Gate: a pure, deterministic function from (mandate, x402 offer, context) to
 * ALLOW / DENY / ESCALATE. Everything that varies between calls (the clock, spend counters,
 * revocation state, simulation output, human approval) is injected through {@link GateContext}, so
 * the same inputs always give the same answer and an auditor can re-run a recorded decision.
 *
 * Rule order follows ADR 0005. Each rule either PASSes, FAILs (hard: the decision is DENY),
 * ESCALATEs (approvable: a human may override it) or is SKIPPED (not meaningful after an integrity
 * failure, or not worth running once a hard rule failed).
 */

export const RULE_IDS = [
  'OFFER_WELL_FORMED',
  'MANDATE_SIGNATURES',
  'MANDATE_VALIDITY',
  'MANDATE_NOT_REVOKED',
  'NETWORK_ALLOWED',
  'ASSET_ALLOWED',
  'RESOURCE_ALLOWED',
  'PAYTO_ALLOWED',
  'MAX_PER_PAYMENT',
  'WINDOW_BUDGET',
  'MAX_TOTAL',
  'TRANSACTION_SIMULATION',
  'ESCALATION_THRESHOLD',
  'ESCALATION_APPROVAL',
] as const;

export type RuleId = (typeof RULE_IDS)[number];
export type RuleStatus = 'PASS' | 'FAIL' | 'ESCALATE' | 'OVERRIDDEN' | 'SKIPPED';
export type GateDecision = 'ALLOW' | 'DENY' | 'ESCALATE';
export type DecisionKind = 'AUTONOMOUS' | 'APPROVED';

export type RuleDetailValue = string | number | boolean | null | string[];

export interface RuleResult {
  id: RuleId;
  status: RuleStatus;
  /** Human-readable explanation. */
  message: string;
  /** Machine-readable values that explain the outcome (limits, amounts, offending value, ...). */
  details: Record<string, RuleDetailValue>;
}

/** Summary of pre-flight simulation of the exact transaction that would be signed. */
export interface GateSimulation {
  success: boolean;
  error: string | null;
  programIds: string[];
  unknownProgramIds: string[];
  /** Number of token transfers in the transaction (the exact scheme requires exactly one). */
  transferCount: number;
  /** True iff the single transfer pays exactly offer.amount of offer.asset to the payTo token account. */
  matchesOffer: boolean;
  mismatch: string | null;
  /** SHA-256 (hex) of the serialised transaction message; binds the decision to those bytes. */
  txMessageHash: string;
  unitsConsumed: number | null;
}

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED' | 'CONSUMED';

export interface GateApproval {
  id: string;
  /** Hash of the exact offer the human approved. */
  offerHash: string;
  status: ApprovalStatus;
  expiresAt: number;
  approver: { userId: string; role: string } | null;
}

export interface GateContext {
  /** Epoch seconds, supplied by the caller. The gate never reads a clock. */
  now: number;
  revoked: { revokedAt: number; reason?: string | null } | null;
  spend: {
    /** Autonomous spend (reserved + settled) inside the rolling window ending at `now`. */
    windowAutonomousBaseUnits: string;
    /** All spend, autonomous and approved (reserved + settled), over the mandate's lifetime. */
    totalBaseUnits: string;
  };
  simulation: GateSimulation | null;
  /** When false a missing simulation passes (unit tests, prelim evaluation). Production always sets true. */
  requireSimulation: boolean;
  approval: GateApproval | null;
}

export interface GateResult {
  decision: GateDecision;
  kind: DecisionKind | null;
  rulesEvaluated: RuleResult[];
  /** First hard failure for DENY, or the first approvable rule for ESCALATE. */
  failedRule: RuleId | null;
  failedRules: RuleId[];
  escalationRules: RuleId[];
  reason: string;
  requiredApproverRoles: string[];
  offerHash: string | null;
  mandateHash: string | null;
}

function pass(id: RuleId, message: string, details: Record<string, RuleDetailValue> = {}): RuleResult {
  return { id, status: 'PASS', message, details };
}
function fail(id: RuleId, message: string, details: Record<string, RuleDetailValue> = {}): RuleResult {
  return { id, status: 'FAIL', message, details };
}
function escalate(id: RuleId, message: string, details: Record<string, RuleDetailValue> = {}): RuleResult {
  return { id, status: 'ESCALATE', message, details };
}
function skipped(id: RuleId, why: string): RuleResult {
  return { id, status: 'SKIPPED', message: `Skipped: ${why}`, details: {} };
}

function assertBaseUnits(value: string, name: string): void {
  if (!BASE_UNITS_PATTERN.test(value)) {
    throw new TypeError(`GateContext.${name} must be a non-negative integer string, got "${value}"`);
  }
}

function assertContext(context: GateContext): void {
  if (!Number.isInteger(context.now) || context.now < 0) throw new TypeError('GateContext.now must be epoch seconds');
  assertBaseUnits(context.spend.windowAutonomousBaseUnits, 'spend.windowAutonomousBaseUnits');
  assertBaseUnits(context.spend.totalBaseUnits, 'spend.totalBaseUnits');
}

const HARD_STOP_RULES: RuleId[] = ['OFFER_WELL_FORMED', 'MANDATE_SIGNATURES', 'MANDATE_VALIDITY', 'MANDATE_NOT_REVOKED'];

function summarise(results: RuleResult[]): string {
  const parts = results.map((r) => `${r.id}: ${r.message}`);
  return parts.join(' | ');
}

export function evaluateGate(mandateInput: unknown, offerInput: unknown, context: GateContext): GateResult {
  assertContext(context);
  const rules: RuleResult[] = [];

  const offerParsed = x402OfferSchema.safeParse(offerInput);
  const mandateParsed = agentMandateSchema.safeParse(mandateInput);

  // 0. The offer must be a well-formed exact/SVM offer for a positive amount.
  let offer: X402Offer | null = null;
  if (!offerParsed.success) {
    const issue = offerParsed.error.issues[0];
    rules.push(fail('OFFER_WELL_FORMED', `Offer is malformed: ${issue.path.join('.') || '<root>'}: ${issue.message}`));
  } else if (compareBaseUnits(offerParsed.data.amount, '0') <= 0) {
    rules.push(fail('OFFER_WELL_FORMED', 'Offer amount must be greater than zero', { amount: offerParsed.data.amount }));
  } else {
    offer = offerParsed.data;
    rules.push(pass('OFFER_WELL_FORMED', 'Offer is a well-formed x402 exact payment request'));
  }

  // 1. Mandate integrity: schema, delegation chain order, every signature, independent approvers.
  let mandate: AgentMandate | null = null;
  if (!mandateParsed.success) {
    const issue = mandateParsed.error.issues[0];
    rules.push(
      fail('MANDATE_SIGNATURES', `Mandate is malformed: ${issue.path.join('.') || '<root>'}: ${issue.message}`),
    );
  } else {
    const verification = verifyMandateChain(mandateParsed.data);
    if (verification.valid) {
      mandate = mandateParsed.data as AgentMandate;
      rules.push(
        pass('MANDATE_SIGNATURES', 'Delegation chain is complete and every signature verifies', {
          signers: mandate.delegationChain.length,
        }),
      );
    } else {
      rules.push(fail('MANDATE_SIGNATURES', verification.errors[0], { errors: verification.errors }));
    }
  }

  // 2 & 3. Validity window and revocation (evaluated whenever the mandate parsed, even if signatures failed).
  const parsedMandate = mandateParsed.success ? (mandateParsed.data as AgentMandate) : null;
  if (parsedMandate) {
    const started = context.now >= parsedMandate.notBefore;
    const notExpired = context.now < parsedMandate.expiresAt;
    rules.push(
      started && notExpired
        ? pass('MANDATE_VALIDITY', 'Mandate is inside its validity window', {
            notBefore: parsedMandate.notBefore,
            expiresAt: parsedMandate.expiresAt,
            now: context.now,
          })
        : fail(
            'MANDATE_VALIDITY',
            !started
              ? `Mandate is not valid until ${parsedMandate.notBefore}`
              : `Mandate expired at ${parsedMandate.expiresAt}`,
            { notBefore: parsedMandate.notBefore, expiresAt: parsedMandate.expiresAt, now: context.now },
          ),
    );
    rules.push(
      context.revoked
        ? fail('MANDATE_NOT_REVOKED', `Mandate was revoked at ${context.revoked.revokedAt}`, {
            revokedAt: context.revoked.revokedAt,
            reason: context.revoked.reason ?? null,
          })
        : pass('MANDATE_NOT_REVOKED', 'Mandate has not been revoked'),
    );
  } else {
    rules.push(skipped('MANDATE_VALIDITY', 'mandate document is malformed'));
    rules.push(skipped('MANDATE_NOT_REVOKED', 'mandate document is malformed'));
  }

  const hardStop = rules.some((r) => HARD_STOP_RULES.includes(r.id) && r.status === 'FAIL');
  const scopeRuleIds: RuleId[] = [
    'NETWORK_ALLOWED',
    'ASSET_ALLOWED',
    'RESOURCE_ALLOWED',
    'PAYTO_ALLOWED',
    'MAX_PER_PAYMENT',
    'WINDOW_BUDGET',
    'MAX_TOTAL',
    'TRANSACTION_SIMULATION',
    'ESCALATION_THRESHOLD',
  ];

  if (hardStop || !mandate || !offer) {
    for (const id of scopeRuleIds) rules.push(skipped(id, 'an integrity or validity rule failed'));
  } else {
    const { scope, escalation } = mandate;
    const { limits } = scope;

    // 4. Network (devnet only, twice: the mandate must allow it AND Atlas Rail v1 must support it).
    const networkOk =
      scope.allowedNetworks.includes(offer.network as (typeof SUPPORTED_NETWORKS)[number]) &&
      (SUPPORTED_NETWORKS as readonly string[]).includes(offer.network);
    rules.push(
      networkOk
        ? pass('NETWORK_ALLOWED', `Network ${offer.network} is allowed`, { network: offer.network })
        : fail('NETWORK_ALLOWED', `Network ${offer.network} is not allowed by this mandate (devnet only)`, {
            network: offer.network,
            allowed: [...scope.allowedNetworks],
          }),
    );

    // 5. Asset.
    rules.push(
      scope.allowedAssets.includes(offer.asset)
        ? pass('ASSET_ALLOWED', `Asset ${offer.asset} is allowed`, { asset: offer.asset })
        : fail('ASSET_ALLOWED', `Asset ${offer.asset} is not allowed by this mandate`, {
            asset: offer.asset,
            allowed: [...scope.allowedAssets],
          }),
    );

    // 6. Resource: allowed, approvable with a human, or denied.
    if (matchesAnyResourcePattern(offer.resourceUrl, scope.allowedResources)) {
      rules.push(pass('RESOURCE_ALLOWED', 'Resource is inside the mandate scope', { resource: offer.resourceUrl }));
    } else if (matchesAnyResourcePattern(offer.resourceUrl, escalation.resources)) {
      rules.push(
        escalate('RESOURCE_ALLOWED', 'Resource is outside autonomous scope but may be approved by a human', {
          resource: offer.resourceUrl,
        }),
      );
    } else {
      rules.push(
        fail('RESOURCE_ALLOWED', `Resource ${offer.resourceUrl} is not covered by this mandate`, {
          resource: offer.resourceUrl,
          allowed: [...scope.allowedResources],
        }),
      );
    }

    // 7. payTo.
    rules.push(
      scope.allowedPayTo.includes(offer.payTo)
        ? pass('PAYTO_ALLOWED', 'Recipient is on the mandate allowlist', { payTo: offer.payTo })
        : fail('PAYTO_ALLOWED', `Recipient ${offer.payTo} is not on the mandate allowlist`, {
            payTo: offer.payTo,
            allowed: [...scope.allowedPayTo],
          }),
    );

    // 8. Hard per-payment ceiling (also requires the offer to be in the limits' denomination).
    const sameMint = offer.asset === limits.mint;
    if (!sameMint) {
      rules.push(
        fail('MAX_PER_PAYMENT', 'Offer asset differs from the asset the mandate limits are denominated in', {
          asset: offer.asset,
          limitsMint: limits.mint,
        }),
      );
    } else if (compareBaseUnits(offer.amount, limits.maxPerPayment) > 0) {
      rules.push(
        fail('MAX_PER_PAYMENT', `Amount ${offer.amount} exceeds the per-payment ceiling ${limits.maxPerPayment}`, {
          amount: offer.amount,
          maxPerPayment: limits.maxPerPayment,
        }),
      );
    } else {
      rules.push(
        pass('MAX_PER_PAYMENT', 'Amount is within the per-payment ceiling', {
          amount: offer.amount,
          maxPerPayment: limits.maxPerPayment,
        }),
      );
    }

    // 9. Rolling-window autonomous budget (approvable).
    const projectedWindow = addBaseUnits(context.spend.windowAutonomousBaseUnits, offer.amount);
    rules.push(
      compareBaseUnits(projectedWindow, limits.maxPerWindow) <= 0
        ? pass('WINDOW_BUDGET', 'Amount fits the rolling-window autonomous budget', {
            spentInWindow: context.spend.windowAutonomousBaseUnits,
            projected: projectedWindow,
            maxPerWindow: limits.maxPerWindow,
            windowSeconds: limits.windowSeconds,
          })
        : escalate('WINDOW_BUDGET', `Amount would take autonomous spend to ${projectedWindow}, above the window budget ${limits.maxPerWindow}`, {
            spentInWindow: context.spend.windowAutonomousBaseUnits,
            projected: projectedWindow,
            maxPerWindow: limits.maxPerWindow,
            windowSeconds: limits.windowSeconds,
          }),
    );

    // 10. Hard lifetime cap.
    const projectedTotal = addBaseUnits(context.spend.totalBaseUnits, offer.amount);
    rules.push(
      compareBaseUnits(projectedTotal, limits.maxTotal) <= 0
        ? pass('MAX_TOTAL', 'Amount fits the lifetime cap', {
            spentTotal: context.spend.totalBaseUnits,
            projected: projectedTotal,
            maxTotal: limits.maxTotal,
          })
        : fail('MAX_TOTAL', `Amount would take lifetime spend to ${projectedTotal}, above the cap ${limits.maxTotal}`, {
            spentTotal: context.spend.totalBaseUnits,
            projected: projectedTotal,
            maxTotal: limits.maxTotal,
          }),
    );

    // 11. Pre-flight simulation of the exact transaction (skipped once a hard rule already failed).
    const hardFailedSoFar = rules.some((r) => r.status === 'FAIL');
    if (hardFailedSoFar && !context.simulation) {
      rules.push(skipped('TRANSACTION_SIMULATION', 'a scope rule already failed, no transaction was simulated'));
    } else if (!context.simulation) {
      rules.push(
        context.requireSimulation
          ? fail('TRANSACTION_SIMULATION', 'No pre-flight simulation was provided for this payment')
          : pass('TRANSACTION_SIMULATION', 'Simulation not required for this evaluation'),
      );
    } else {
      const sim = context.simulation;
      const problems: string[] = [];
      if (!sim.success) problems.push(`simulation failed${sim.error ? `: ${sim.error}` : ''}`);
      if (sim.unknownProgramIds.length > 0) problems.push(`unknown program ids: ${sim.unknownProgramIds.join(', ')}`);
      if (sim.transferCount !== 1) problems.push(`expected exactly one token transfer, found ${sim.transferCount}`);
      if (!sim.matchesOffer) problems.push(sim.mismatch ?? 'transaction does not pay exactly the offer');
      rules.push(
        problems.length === 0
          ? pass('TRANSACTION_SIMULATION', 'Simulation succeeded and the transaction pays exactly the offer', {
              txMessageHash: sim.txMessageHash,
              programIds: sim.programIds,
              unitsConsumed: sim.unitsConsumed,
            })
          : fail('TRANSACTION_SIMULATION', problems.join('; '), {
              txMessageHash: sim.txMessageHash,
              programIds: sim.programIds,
              unknownProgramIds: sim.unknownProgramIds,
              transferCount: sim.transferCount,
              matchesOffer: sim.matchesOffer,
            }),
      );
    }

    // 12. Escalation threshold (approvable).
    rules.push(
      compareBaseUnits(offer.amount, escalation.thresholdBaseUnits) > 0
        ? escalate('ESCALATION_THRESHOLD', `Amount ${offer.amount} is above the human-approval threshold ${escalation.thresholdBaseUnits}`, {
            amount: offer.amount,
            threshold: escalation.thresholdBaseUnits,
          })
        : pass('ESCALATION_THRESHOLD', 'Amount is at or below the human-approval threshold', {
            amount: offer.amount,
            threshold: escalation.thresholdBaseUnits,
          }),
    );
  }

  // Human approval: may only override approvable (ESCALATE) rules; never hard failures.
  const offerHash = offer ? hashOffer(offer) : null;
  const mandateHash = parsedMandate ? hashMandate(parsedMandate) : null;
  const anyHardFail = rules.some((r) => r.status === 'FAIL');
  const anyEscalate = rules.some((r) => r.status === 'ESCALATE');

  if (context.approval && mandate && offerHash) {
    const approval = context.approval;
    const problems: string[] = [];
    if (approval.status !== 'APPROVED') problems.push(`approval is ${approval.status}`);
    if (approval.offerHash !== offerHash) problems.push('approval was granted for a different offer');
    if (context.now >= approval.expiresAt) problems.push('approval has expired');
    if (!approval.approver || !mandate.escalation.approverRoles.includes(approval.approver.role as never)) {
      problems.push('approver role is not permitted by the mandate');
    }
    if (problems.length > 0) {
      rules.push(fail('ESCALATION_APPROVAL', `Approval rejected: ${problems.join('; ')}`, { approvalId: approval.id }));
    } else if (anyEscalate && !anyHardFail) {
      for (const rule of rules) if (rule.status === 'ESCALATE') rule.status = 'OVERRIDDEN';
      rules.push(
        pass('ESCALATION_APPROVAL', 'A permitted approver approved this exact offer', {
          approvalId: approval.id,
          approverRole: approval.approver?.role ?? null,
        }),
      );
    } else {
      rules.push(pass('ESCALATION_APPROVAL', 'Approval presented but no approvable rule needed it', { approvalId: approval.id }));
    }
  }

  const failed = rules.filter((r) => r.status === 'FAIL');
  const escalations = rules.filter((r) => r.status === 'ESCALATE');
  const overridden = rules.some((r) => r.status === 'OVERRIDDEN');

  let decision: GateDecision;
  let kind: DecisionKind | null = null;
  let reason: string;
  if (failed.length > 0) {
    decision = 'DENY';
    reason = `Denied — ${summarise(failed)}`;
  } else if (escalations.length > 0) {
    decision = 'ESCALATE';
    reason = `Human approval required — ${summarise(escalations)}`;
  } else {
    decision = 'ALLOW';
    kind = overridden ? 'APPROVED' : 'AUTONOMOUS';
    reason = overridden
      ? 'Allowed with human approval; all hard rules passed'
      : 'Allowed — all rules passed within autonomous authority';
  }

  return {
    decision,
    kind,
    rulesEvaluated: rules,
    failedRule: failed[0]?.id ?? escalations[0]?.id ?? null,
    failedRules: failed.map((r) => r.id),
    escalationRules: escalations.map((r) => r.id),
    reason,
    requiredApproverRoles: decision === 'ESCALATE' && mandate ? [...mandate.escalation.approverRoles] : [],
    offerHash,
    mandateHash,
  };
}
