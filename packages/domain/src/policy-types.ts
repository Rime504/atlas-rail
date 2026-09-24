import { z } from 'zod';

export const policyRulesSchema = z.object({
  version: z.number().default(1),
  approval: z.object({
    requiredApprovals: z.number().min(0).default(2),
    eligibleRoles: z.array(z.string()).default(['OWNER', 'ADMIN', 'APPROVER']),
    preventCreatorApproval: z.boolean().default(true),
  }),
  limits: z.object({
    maxSinglePayoutBaseUnits: z.string().default('5000000000'), // 5,000 USDC
    dailyLimitBaseUnits: z.string().default('25000000000'), // 25,000 USDC
    monthlyLimitBaseUnits: z.string().default('100000000000'), // 100,000 USDC
  }),
  recipients: z.object({
    requireVerifiedRecipient: z.boolean().default(true),
    allowedRecipientIds: z.array(z.string()).default([]),
    blockedRecipientIds: z.array(z.string()).default([]),
  }),
  assets: z.object({
    allowedMintAddresses: z.array(z.string()).min(1),
  }),
  transaction: z.object({
    requireSuccessfulSimulation: z.boolean().default(true),
    blockUnknownProgramIds: z.boolean().default(true),
    allowProgramIds: z.array(z.string()).default([
      '11111111111111111111111111111111',
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
      'ComputeBudget111111111111111111111111111111',
      'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
    ]),
    blockMemoRequired: z.boolean().default(false),
    minimumConfirmations: z.string().default('confirmed'),
  }),
  risk: z.object({
    blockHighRiskRecipients: z.boolean().default(true),
    manualReviewAboveRiskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('HIGH'),
  }),
});

export type PolicyRules = z.infer<typeof policyRulesSchema>;

export type PolicyDecision = 'ALLOW' | 'REQUIRE_APPROVAL' | 'BLOCK';

export interface PolicyEvaluationReason {
  code: string;
  message: string;
  severity: 'INFO' | 'WARNING' | 'BLOCK';
  details?: Record<string, unknown>;
}

export interface PolicyEvaluationOutput {
  decision: PolicyDecision;
  requiredApprovals: number;
  reasons: PolicyEvaluationReason[];
  evaluatedPolicyVersion: number;
  evaluationHash: string;
}
