import { describe, it, expect } from 'vitest';
import { evaluatePolicy } from './policy-engine';
import { PolicyRules } from './policy-types';

describe('Policy Engine', () => {
  const devnetUsdcMint = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

  const defaultRules: PolicyRules = {
    version: 1,
    approval: {
      requiredApprovals: 2,
      eligibleRoles: ['OWNER', 'ADMIN', 'APPROVER'],
      preventCreatorApproval: true,
    },
    limits: {
      maxSinglePayoutBaseUnits: '5000000000', // 5,000 USDC
      dailyLimitBaseUnits: '25000000000',
      monthlyLimitBaseUnits: '100000000000',
    },
    recipients: {
      requireVerifiedRecipient: true,
      allowedRecipientIds: [],
      blockedRecipientIds: [],
    },
    assets: {
      allowedMintAddresses: [devnetUsdcMint],
    },
    transaction: {
      requireSuccessfulSimulation: true,
      blockUnknownProgramIds: true,
      allowProgramIds: [
        '11111111111111111111111111111111',
        'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
      ],
      blockMemoRequired: false,
      minimumConfirmations: 'confirmed',
    },
    risk: {
      blockHighRiskRecipients: true,
      manualReviewAboveRiskLevel: 'HIGH',
    },
  };

  const baseInput = {
    policy: { version: 1, rules: defaultRules },
    treasury: { status: 'ACTIVE' as const, network: 'DEVNET' },
    recipient: { id: 'rec_1', status: 'VERIFIED' as const, riskLevel: 'LOW' as const },
    payout: {
      amountBaseUnits: '1000000000', // 1,000 USDC
      mintAddress: devnetUsdcMint,
      memo: 'Test Payout',
      createdByUserId: 'usr_creator',
    },
    rollingSpend: {
      dailyTotalBaseUnits: '0',
      monthlyTotalBaseUnits: '0',
    },
  };

  it('requires 2 approvals for a normal valid payout request', () => {
    const result = evaluatePolicy(baseInput);
    expect(result.decision).toBe('REQUIRE_APPROVAL');
    expect(result.requiredApprovals).toBe(2);
    expect(result.reasons[0].code).toBe('APPROVAL_REQUIRED');
  });

  it('blocks payout if treasury is frozen', () => {
    const result = evaluatePolicy({
      ...baseInput,
      treasury: { ...baseInput.treasury, status: 'FROZEN' },
    });
    expect(result.decision).toBe('BLOCK');
    expect(result.reasons.some((r) => r.code === 'TREASURY_FROZEN')).toBe(true);
  });

  it('blocks payout if recipient is unverified', () => {
    const result = evaluatePolicy({
      ...baseInput,
      recipient: { ...baseInput.recipient, status: 'PENDING' },
    });
    expect(result.decision).toBe('BLOCK');
    expect(result.reasons.some((r) => r.code === 'RECIPIENT_NOT_VERIFIED')).toBe(true);
  });

  it('blocks payout if amount exceeds single payout limit', () => {
    const result = evaluatePolicy({
      ...baseInput,
      payout: { ...baseInput.payout, amountBaseUnits: '6000000000' }, // 6,000 USDC > 5,000 limit
    });
    expect(result.decision).toBe('BLOCK');
    expect(result.reasons.some((r) => r.code === 'EXCEEDS_SINGLE_PAYOUT_LIMIT')).toBe(true);
  });

  it('blocks payout if transaction simulation contains unallowed program IDs', () => {
    const result = evaluatePolicy({
      ...baseInput,
      simulation: {
        success: true,
        programIds: ['11111111111111111111111111111111', 'MaliciousProgram1111111111111111111111'],
      },
    });
    expect(result.decision).toBe('BLOCK');
    expect(result.reasons.some((r) => r.code === 'UNKNOWN_PROGRAM_ID_DETECTED')).toBe(true);
  });
});
