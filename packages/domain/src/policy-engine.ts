import { createHash } from 'crypto';
import { PolicyRules, PolicyEvaluationOutput, PolicyEvaluationReason, PolicyDecision } from './policy-types';
import { compareBaseUnits, addBaseUnits } from './money';

export interface PayoutEvaluationInput {
  policy: {
    version: number;
    rules: PolicyRules;
  };
  treasury: {
    status: 'ACTIVE' | 'FROZEN';
    network: string;
  };
  recipient: {
    id: string;
    status: 'PENDING' | 'VERIFIED' | 'BLOCKED' | 'ARCHIVED';
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  };
  payout: {
    amountBaseUnits: string;
    mintAddress: string;
    memo?: string | null;
    createdByUserId: string;
  };
  rollingSpend: {
    dailyTotalBaseUnits: string;
    monthlyTotalBaseUnits: string;
  };
  simulation?: {
    success: boolean;
    programIds: string[];
    unknownProgramIds?: string[];
  } | null;
}

export function evaluatePolicy(input: PayoutEvaluationInput): PolicyEvaluationOutput {
  const { policy, treasury, recipient, payout, rollingSpend, simulation } = input;
  const rules = policy.rules;
  const reasons: PolicyEvaluationReason[] = [];

  let isBlocked = false;
  let requiresApproval = false;

  // 1. Treasury Active Status Check
  if (treasury.status !== 'ACTIVE') {
    isBlocked = true;
    reasons.push({
      code: 'TREASURY_FROZEN',
      message: 'Treasury is currently frozen or inactive.',
      severity: 'BLOCK',
    });
  }

  // 2. Devnet Network Check
  if (treasury.network !== 'DEVNET') {
    isBlocked = true;
    reasons.push({
      code: 'PROHIBITED_NETWORK',
      message: 'Atlas Rail v1 strictly enforces DEVNET network execution only.',
      severity: 'BLOCK',
    });
  }

  // 3. Asset Mint Allowlist Check
  if (!rules.assets.allowedMintAddresses.includes(payout.mintAddress)) {
    isBlocked = true;
    reasons.push({
      code: 'MINT_NOT_ALLOWED',
      message: `Mint address ${payout.mintAddress} is not permitted by active policy.`,
      severity: 'BLOCK',
    });
  }

  // 4. Recipient Status & Allow/Block List Checks
  if (rules.recipients.requireVerifiedRecipient && recipient.status !== 'VERIFIED') {
    isBlocked = true;
    reasons.push({
      code: 'RECIPIENT_NOT_VERIFIED',
      message: 'Policy requires recipient status to be VERIFIED.',
      severity: 'BLOCK',
    });
  }

  if (recipient.status === 'BLOCKED' || rules.recipients.blockedRecipientIds.includes(recipient.id)) {
    isBlocked = true;
    reasons.push({
      code: 'RECIPIENT_BLOCKED',
      message: 'Recipient is blocked by organizational policy or risk assessment.',
      severity: 'BLOCK',
    });
  }

  // 5. Amount & Spend Limits Checks
  if (compareBaseUnits(payout.amountBaseUnits, '0') <= 0) {
    isBlocked = true;
    reasons.push({
      code: 'INVALID_AMOUNT',
      message: 'Payout amount must be greater than 0 base units.',
      severity: 'BLOCK',
    });
  }

  if (compareBaseUnits(payout.amountBaseUnits, rules.limits.maxSinglePayoutBaseUnits) > 0) {
    isBlocked = true;
    reasons.push({
      code: 'EXCEEDS_SINGLE_PAYOUT_LIMIT',
      message: `Payout amount exceeds single payout limit of ${rules.limits.maxSinglePayoutBaseUnits} base units.`,
      severity: 'BLOCK',
    });
  }

  const projectedDailyTotal = addBaseUnits(rollingSpend.dailyTotalBaseUnits, payout.amountBaseUnits);
  if (compareBaseUnits(projectedDailyTotal, rules.limits.dailyLimitBaseUnits) > 0) {
    isBlocked = true;
    reasons.push({
      code: 'EXCEEDS_DAILY_LIMIT',
      message: `Projected daily spend exceeds daily limit of ${rules.limits.dailyLimitBaseUnits} base units.`,
      severity: 'BLOCK',
    });
  }

  const projectedMonthlyTotal = addBaseUnits(rollingSpend.monthlyTotalBaseUnits, payout.amountBaseUnits);
  if (compareBaseUnits(projectedMonthlyTotal, rules.limits.monthlyLimitBaseUnits) > 0) {
    isBlocked = true;
    reasons.push({
      code: 'EXCEEDS_MONTHLY_LIMIT',
      message: `Projected monthly spend exceeds monthly limit of ${rules.limits.monthlyLimitBaseUnits} base units.`,
      severity: 'BLOCK',
    });
  }

  // 6. Risk Checks
  if (rules.risk.blockHighRiskRecipients && (recipient.riskLevel === 'HIGH' || recipient.riskLevel === 'CRITICAL')) {
    isBlocked = true;
    reasons.push({
      code: 'HIGH_RISK_RECIPIENT',
      message: `Recipient risk level (${recipient.riskLevel}) is blocked by policy.`,
      severity: 'BLOCK',
    });
  }

  // 7. Simulation Checks (If simulation result provided)
  if (simulation) {
    if (rules.transaction.requireSuccessfulSimulation && !simulation.success) {
      isBlocked = true;
      reasons.push({
        code: 'SIMULATION_FAILED',
        message: 'Transaction simulation failed on devnet RPC node.',
        severity: 'BLOCK',
      });
    }

    if (rules.transaction.blockUnknownProgramIds) {
      const unknownIds = simulation.programIds.filter((pid) => !rules.transaction.allowProgramIds.includes(pid));
      if (unknownIds.length > 0) {
        isBlocked = true;
        reasons.push({
          code: 'UNKNOWN_PROGRAM_ID_DETECTED',
          message: `Transaction contains program IDs not present in allowlist: ${unknownIds.join(', ')}`,
          severity: 'BLOCK',
          details: { unknownIds },
        });
      }
    }
  }

  // 8. Memo Requirement Check
  if (rules.transaction.blockMemoRequired && (!payout.memo || payout.memo.trim() === '')) {
    isBlocked = true;
    reasons.push({
      code: 'MEMO_REQUIRED',
      message: 'Policy mandates a non-empty memo string for payout requests.',
      severity: 'BLOCK',
    });
  }

  // 9. Determine Approval Requirement
  if (!isBlocked && rules.approval.requiredApprovals > 0) {
    requiresApproval = true;
    reasons.push({
      code: 'APPROVAL_REQUIRED',
      message: `Payout requires ${rules.approval.requiredApprovals} approval(s) before execution.`,
      severity: 'INFO',
    });
  }

  const decision: PolicyDecision = isBlocked
    ? 'BLOCK'
    : requiresApproval
      ? 'REQUIRE_APPROVAL'
      : 'ALLOW';

  const evaluationPayload = {
    policyVersion: policy.version,
    decision,
    reasons,
    requiredApprovals: rules.approval.requiredApprovals,
  };

  const evaluationHash = createHash('sha256')
    .update(JSON.stringify(evaluationPayload))
    .digest('hex');

  return {
    decision,
    requiredApprovals: isBlocked ? 0 : rules.approval.requiredApprovals,
    reasons,
    evaluatedPolicyVersion: policy.version,
    evaluationHash,
  };
}
