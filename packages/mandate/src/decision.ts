import {
  MessageSigner,
  SIGNATURE_DOMAIN,
  hashCanonical,
  isSha256Hex,
  signDomainHash,
  verifyDomainHash,
} from './crypto';
import { JsonValue } from './jcs';
import {
  DecisionKind,
  GateApproval,
  GateContext,
  GateDecision,
  GateResult,
  GateSimulation,
  RuleId,
  RuleResult,
  evaluateGate,
} from './gate';
import { VerificationCheck, hashMandate } from './mandate';
import { X402Offer, hashOffer } from './offer';
import { AgentMandate } from './schema';

/* -------------------------------------------------------------------------------------------------
 * Agent gate request: proof that the agent key itself is asking
 * -----------------------------------------------------------------------------------------------*/

export interface AgentGateRequestBody {
  type: 'atlasrail.gate-request';
  version: '0.1';
  mandateId: string;
  offer: X402Offer;
  /** Base64 transaction the agent intends to sign (fee-payer signature slot empty). */
  transactionBase64: string | null;
  approvalId: string | null;
  /** Client-chosen, unique per request. Makes the gate idempotent and defeats replay. */
  nonce: string;
  requestedAt: number;
}

export interface SignedAgentGateRequest extends AgentGateRequestBody {
  agentPublicKey: string;
  signature: string;
}

export function hashGateRequest(body: AgentGateRequestBody): string {
  return hashCanonical(body as unknown as JsonValue);
}

export async function signGateRequest(
  body: AgentGateRequestBody,
  agent: MessageSigner,
): Promise<SignedAgentGateRequest> {
  const signature = await signDomainHash(agent, SIGNATURE_DOMAIN.agentRequest, hashGateRequest(body));
  return { ...body, agentPublicKey: agent.publicKey, signature };
}

export function verifyGateRequestSignature(request: SignedAgentGateRequest): boolean {
  const { agentPublicKey, signature, ...body } = request;
  return verifyDomainHash(
    agentPublicKey,
    SIGNATURE_DOMAIN.agentRequest,
    hashGateRequest(body as AgentGateRequestBody),
    signature,
  );
}

/* -------------------------------------------------------------------------------------------------
 * Decision record: everything needed to re-run and audit a gate decision
 * -----------------------------------------------------------------------------------------------*/

export interface DecisionContextSnapshot {
  evaluatedAt: number;
  revoked: { revokedAt: number; reason: string | null } | null;
  spend: { windowAutonomousBaseUnits: string; totalBaseUnits: string };
  simulation: GateSimulation | null;
  requireSimulation: boolean;
  approval: GateApproval | null;
}

export interface DecisionRecord {
  type: 'atlasrail.decision';
  version: '0.1';
  id: string;
  organizationId: string;
  mandateId: string;
  mandateHash: string;
  offer: X402Offer;
  offerHash: string;
  decision: GateDecision;
  kind: DecisionKind | null;
  rulesEvaluated: RuleResult[];
  failedRule: RuleId | null;
  failedRules: RuleId[];
  escalationRules: RuleId[];
  reason: string;
  context: DecisionContextSnapshot;
  request: { nonce: string; requestedAt: number; requestHash: string; agentPublicKey: string } | null;
}

export interface SignedDecision {
  record: DecisionRecord;
  decisionHash: string;
  instance: { publicKey: string; signature: string };
}

export function contextToSnapshot(context: GateContext): DecisionContextSnapshot {
  return {
    evaluatedAt: context.now,
    revoked: context.revoked ? { revokedAt: context.revoked.revokedAt, reason: context.revoked.reason ?? null } : null,
    spend: { ...context.spend },
    simulation: context.simulation,
    requireSimulation: context.requireSimulation,
    approval: context.approval,
  };
}

export function snapshotToContext(snapshot: DecisionContextSnapshot): GateContext {
  return {
    now: snapshot.evaluatedAt,
    revoked: snapshot.revoked,
    spend: { ...snapshot.spend },
    simulation: snapshot.simulation,
    requireSimulation: snapshot.requireSimulation,
    approval: snapshot.approval,
  };
}

export interface BuildDecisionRecordInput {
  id: string;
  organizationId: string;
  mandate: AgentMandate;
  offer: X402Offer;
  result: GateResult;
  context: GateContext;
  request: DecisionRecord['request'];
}

export function buildDecisionRecord(input: BuildDecisionRecordInput): DecisionRecord {
  const { result } = input;
  return {
    type: 'atlasrail.decision',
    version: '0.1',
    id: input.id,
    organizationId: input.organizationId,
    mandateId: input.mandate.id,
    mandateHash: hashMandate(input.mandate),
    offer: input.offer,
    offerHash: hashOffer(input.offer),
    decision: result.decision,
    kind: result.kind,
    rulesEvaluated: result.rulesEvaluated,
    failedRule: result.failedRule,
    failedRules: result.failedRules,
    escalationRules: result.escalationRules,
    reason: result.reason,
    context: contextToSnapshot(input.context),
    request: input.request,
  };
}

export function hashDecisionRecord(record: DecisionRecord): string {
  return hashCanonical(record as unknown as JsonValue);
}

export async function signDecision(record: DecisionRecord, instanceSigner: MessageSigner): Promise<SignedDecision> {
  const decisionHash = hashDecisionRecord(record);
  const signature = await signDomainHash(instanceSigner, SIGNATURE_DOMAIN.decision, decisionHash);
  return { record, decisionHash, instance: { publicKey: instanceSigner.publicKey, signature } };
}

export function verifyDecisionSignature(signed: SignedDecision): VerificationCheck {
  const recomputed = hashDecisionRecord(signed.record);
  if (recomputed !== signed.decisionHash) {
    return { id: 'DECISION_HASH', ok: false, message: 'Decision record does not match its recorded hash' };
  }
  const ok = verifyDomainHash(
    signed.instance.publicKey,
    SIGNATURE_DOMAIN.decision,
    signed.decisionHash,
    signed.instance.signature,
  );
  return {
    id: 'DECISION_SIGNATURE',
    ok,
    message: ok
      ? 'Decision record is signed by the Atlas Rail instance key'
      : 'Decision signature does not verify against the instance key',
  };
}

/**
 * Re-runs the gate on the recorded inputs and checks the recorded outcome is exactly what the
 * mandate's scope produces. This is what lets a third party confirm "the decision matches the scope"
 * without trusting the instance's judgement.
 */
export function verifyDecisionMatchesScope(mandate: AgentMandate, signed: SignedDecision): VerificationCheck {
  const { record } = signed;
  if (record.mandateHash !== hashMandate(mandate)) {
    return { id: 'DECISION_MATCHES_SCOPE', ok: false, message: 'Decision was made under a different mandate' };
  }
  if (record.offerHash !== hashOffer(record.offer)) {
    return { id: 'DECISION_MATCHES_SCOPE', ok: false, message: 'Recorded offer does not match its hash' };
  }
  const replay = evaluateGate(mandate, record.offer, snapshotToContext(record.context));
  const same =
    replay.decision === record.decision &&
    replay.kind === record.kind &&
    JSON.stringify(replay.rulesEvaluated) === JSON.stringify(record.rulesEvaluated);
  return {
    id: 'DECISION_MATCHES_SCOPE',
    ok: same,
    message: same
      ? `Re-evaluating the mandate scope on the recorded inputs reproduces the ${record.decision} decision and all ${record.rulesEvaluated.length} rule results`
      : `Re-evaluation yields ${replay.decision}${replay.failedRule ? ` (${replay.failedRule})` : ''}, but the record says ${record.decision}`,
  };
}

/* -------------------------------------------------------------------------------------------------
 * Gate authorization: what a wallet checks before it signs
 * -----------------------------------------------------------------------------------------------*/

export interface GateAuthorizationBody {
  type: 'atlasrail.gate-authorization';
  version: '0.1';
  decisionId: string;
  decisionHash: string;
  mandateHash: string;
  offerHash: string;
  /** SHA-256 (hex) of the serialised transaction message the authorisation covers. */
  txMessageHash: string;
  agentPublicKey: string;
  notBefore: number;
  notAfter: number;
}

export interface GateAuthorization extends GateAuthorizationBody {
  instance: { publicKey: string; signature: string };
}

export function hashGateAuthorization(body: GateAuthorizationBody): string {
  return hashCanonical(body as unknown as JsonValue);
}

export async function createGateAuthorization(
  body: GateAuthorizationBody,
  instanceSigner: MessageSigner,
): Promise<GateAuthorization> {
  const signature = await signDomainHash(instanceSigner, SIGNATURE_DOMAIN.gateAuthorization, hashGateAuthorization(body));
  return { ...body, instance: { publicKey: instanceSigner.publicKey, signature } };
}

export interface GateAuthorizationCheck {
  ok: boolean;
  error: string | null;
}

/** What a wallet-side signer runs before producing a signature. Fails closed on every mismatch. */
export function verifyGateAuthorization(
  authorization: GateAuthorization,
  expected: {
    trustedInstanceKeys: readonly string[];
    now: number;
    txMessageHash: string;
    agentPublicKey: string;
  },
): GateAuthorizationCheck {
  const { instance, ...body } = authorization;
  if (!expected.trustedInstanceKeys.includes(instance.publicKey)) {
    return { ok: false, error: 'Authorization was not issued by a trusted Atlas Rail instance key' };
  }
  if (!isSha256Hex(body.txMessageHash) || body.txMessageHash !== expected.txMessageHash) {
    return { ok: false, error: 'Authorization does not cover this transaction' };
  }
  if (body.agentPublicKey !== expected.agentPublicKey) {
    return { ok: false, error: 'Authorization was issued to a different agent key' };
  }
  if (expected.now < body.notBefore || expected.now >= body.notAfter) {
    return { ok: false, error: 'Authorization is outside its validity window' };
  }
  const valid = verifyDomainHash(
    instance.publicKey,
    SIGNATURE_DOMAIN.gateAuthorization,
    hashGateAuthorization(body),
    instance.signature,
  );
  return valid ? { ok: true, error: null } : { ok: false, error: 'Authorization signature does not verify' };
}
