import { z } from 'zod';
import { parseResourcePattern } from './resource';

/** CAIP-2 identifier of Solana devnet, as used by x402 v2. */
export const SOLANA_DEVNET_CAIP2 = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';

/** Atlas Rail v1 is devnet only (ADR 0004). Mandates for any other network are rejected at creation. */
export const SUPPORTED_NETWORKS = [SOLANA_DEVNET_CAIP2] as const;

export const MANDATE_TYPE = 'atlasrail.agent-mandate' as const;
export const MANDATE_VERSION = '0.1' as const;

/** Largest amount an SPL token account can hold (u64). Base-unit strings above this are rejected. */
export const MAX_BASE_UNITS = 18446744073709551615n;

export const BASE_UNITS_PATTERN = /^(0|[1-9][0-9]{0,19})$/;
const BASE58_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BASE58_SIGNATURE_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const MAX_EPOCH_SECONDS = 4_102_444_800; // 2100-01-01

/** Non-negative integer amount in token base units, as a decimal string. Never a float, never signed. */
export const baseUnitsSchema = z
  .string()
  .regex(BASE_UNITS_PATTERN, 'must be a non-negative integer string without leading zeros')
  .refine((value) => BASE_UNITS_PATTERN.test(value) && BigInt(value) <= MAX_BASE_UNITS, 'exceeds u64');

/** BigInt() throws on malformed input and zod refinements still run on invalid values, so parse defensively. */
function safeBigInt(value: string): bigint | null {
  return BASE_UNITS_PATTERN.test(value) ? BigInt(value) : null;
}

export const addressSchema = z.string().regex(BASE58_ADDRESS_PATTERN, 'must be a base58 Solana address');
export const signatureSchema = z.string().regex(BASE58_SIGNATURE_PATTERN, 'must be a base58 Ed25519 signature');
export const epochSecondsSchema = z.number().int().nonnegative().max(MAX_EPOCH_SECONDS);

const networkSchema = z.enum(SUPPORTED_NETWORKS);

const resourcePatternSchema = z
  .string()
  .refine((pattern) => parseResourcePattern(pattern) !== null, 'must be <origin><path> with an optional trailing /*');

export const delegationRoleSchema = z.enum(['OWNER', 'APPROVER', 'AGENT']);
export type DelegationRole = z.infer<typeof delegationRoleSchema>;

export const delegationLinkSchema = z
  .object({
    role: delegationRoleSchema,
    publicKey: addressSchema,
    signature: signatureSchema,
  })
  .strict();
export type DelegationLink = z.infer<typeof delegationLinkSchema>;

export const approverRoleSchema = z.enum(['OWNER', 'ADMIN', 'APPROVER']);

export const mandateLimitsSchema = z
  .object({
    /** Token mint the amounts below are denominated in. Must be listed in `allowedAssets`. */
    mint: addressSchema,
    /** HARD ceiling for a single payment. Never exceeded, even with human approval. */
    maxPerPayment: baseUnitsSchema,
    /** Autonomous budget per rolling window. Exceeding it requires human approval. */
    maxPerWindow: baseUnitsSchema,
    windowSeconds: z.number().int().min(60).max(31_536_000),
    /** HARD lifetime cap across autonomous and approved payments. */
    maxTotal: baseUnitsSchema,
  })
  .strict();

export const mandateScopeSchema = z
  .object({
    allowedNetworks: z.array(networkSchema).min(1).max(4),
    allowedAssets: z.array(addressSchema).min(1).max(16),
    allowedPayTo: z.array(addressSchema).min(1).max(256),
    allowedResources: z.array(resourcePatternSchema).min(1).max(256),
    limits: mandateLimitsSchema,
  })
  .strict();

export const mandateEscalationSchema = z
  .object({
    /** Payments strictly above this need a human approval. */
    thresholdBaseUnits: baseUnitsSchema,
    /** RBAC roles whose members may approve an escalation. */
    approverRoles: z.array(approverRoleSchema).min(1).max(3),
    /** Resources outside `allowedResources` that a human may still approve (otherwise they are denied). */
    resources: z.array(resourcePatternSchema).max(256),
    /** How long an issued approval stays valid before it must be requested again. */
    approvalTtlSeconds: z.number().int().min(30).max(86_400),
  })
  .strict();

export const mandateDelegationSchema = z
  .object({
    /** Independent approver signatures required in the chain (ADR 0005: minimum 1). */
    requiredApprovals: z.number().int().min(1).max(5),
    /** Mirrors `preventCreatorApproval` in the payout policy engine: the issuer key may not also approve. */
    preventIssuerApproval: z.literal(true),
  })
  .strict();

const bodyShape = {
  type: z.literal(MANDATE_TYPE),
  version: z.literal(MANDATE_VERSION),
  id: z.string().regex(/^mnd_[A-Za-z0-9]{10,40}$/),
  issuer: z.object({ organizationId: z.string().min(1).max(64), name: z.string().min(1).max(120) }).strict(),
  agent: z.object({ publicKey: addressSchema, label: z.string().min(1).max(120) }).strict(),
  delegation: mandateDelegationSchema,
  scope: mandateScopeSchema,
  escalation: mandateEscalationSchema,
  notBefore: epochSecondsSchema,
  expiresAt: epochSecondsSchema,
  /** 128-bit random value (hex). One mandate per (issuer, nonce): a replayed mandate is rejected. */
  nonce: z.string().regex(/^[0-9a-f]{32}$/),
  revocable: z.literal(true),
};

type BodyShape = z.infer<z.ZodObject<typeof bodyShape>>;

function refineBody(body: BodyShape, ctx: z.RefinementCtx): void {
  if (body.expiresAt <= body.notBefore) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expiresAt'], message: 'expiresAt must be after notBefore' });
  }
  const { limits } = body.scope;
  if (!body.scope.allowedAssets.includes(limits.mint)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['scope', 'limits', 'mint'],
      message: 'limits.mint must be listed in allowedAssets',
    });
  }
  const maxPerPayment = safeBigInt(limits.maxPerPayment);
  const maxTotal = safeBigInt(limits.maxTotal);
  const threshold = safeBigInt(body.escalation.thresholdBaseUnits);
  if (maxPerPayment !== null && maxTotal !== null && maxPerPayment > maxTotal) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['scope', 'limits', 'maxPerPayment'],
      message: 'maxPerPayment cannot exceed maxTotal',
    });
  }
  if (threshold !== null && maxPerPayment !== null && threshold > maxPerPayment) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['escalation', 'thresholdBaseUnits'],
      message: 'escalation threshold cannot exceed the hard per-payment ceiling',
    });
  }
}

/** The signed content of a mandate: everything except the delegation chain. */
export const mandateBodySchema = z.object(bodyShape).strict().superRefine(refineBody);

/** A mandate as stored and transmitted: body plus the ordered delegation chain. */
export const agentMandateSchema = z
  .object({ ...bodyShape, delegationChain: z.array(delegationLinkSchema).max(8) })
  .strict()
  .superRefine(refineBody);

export type AgentMandateBody = z.infer<typeof mandateBodySchema>;
export type AgentMandate = AgentMandateBody & { delegationChain: DelegationLink[] };

export type MandateScope = AgentMandateBody['scope'];
export type MandateEscalation = AgentMandateBody['escalation'];
export type ApproverRole = z.infer<typeof approverRoleSchema>;
