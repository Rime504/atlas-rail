import { PrismaClient, Role, RecipientStatus, RiskLevel, PayoutStatus, LedgerEntryType, LedgerDirection, ActorType, WebhookEndpointStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { generateUlid } from '../src/ulid';

const prisma = new PrismaClient();

async function main() {
  console.info('🌱 Seeding Atlas Rail database with demo financial infrastructure data...');

  const passwordHash = await argon2.hash('ChangeMe_AtlasRail_DevOnly');

  // 1. Create Demo Organization
  const orgId = generateUlid('org');
  const org = await prisma.organization.upsert({
    where: { slug: 'atlas-demo' },
    update: {},
    create: {
      id: orgId,
      name: 'Atlas Demo Imports',
      slug: 'atlas-demo',
      status: 'ACTIVE',
    },
  });

  // 2. Create Demo Users
  const userSpecs = [
    { email: 'owner@atlasrail.local', displayName: 'Elena Rostova (Owner)', role: Role.OWNER },
    { email: 'operator@atlasrail.local', displayName: 'Marcus Vance (Operator)', role: Role.OPERATOR },
    { email: 'approver1@atlasrail.local', displayName: 'Sarah Jenkins (VP Finance)', role: Role.APPROVER },
    { email: 'approver2@atlasrail.local', displayName: 'David Kim (Treasury Manager)', role: Role.APPROVER },
    { email: 'auditor@atlasrail.local', displayName: 'Audit Compliance Officer', role: Role.AUDITOR },
    { email: 'developer@atlasrail.local', displayName: 'Dev API Integrator', role: Role.DEVELOPER },
  ];

  const usersMap: Record<string, string> = {};

  for (const u of userSpecs) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        id: generateUlid('usr'),
        email: u.email,
        displayName: u.displayName,
        passwordHash,
        status: 'ACTIVE',
      },
    });

    usersMap[u.role] = user.id;
    if (u.email.includes('approver1')) usersMap['APPROVER1'] = user.id;
    if (u.email.includes('approver2')) usersMap['APPROVER2'] = user.id;

    await prisma.membership.upsert({
      where: {
        organizationId_userId: {
          organizationId: org.id,
          userId: user.id,
        },
      },
      update: { role: u.role },
      create: {
        id: generateUlid('mem'),
        organizationId: org.id,
        userId: user.id,
        role: u.role,
      },
    });
  }

  // 3. Create Devnet Treasury
  const treasuryId = generateUlid('trs');
  const devnetUsdcMint = process.env.SOLANA_USDC_MINT || '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  const settlementWallet = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';

  const treasury = await prisma.treasury.upsert({
    where: {
      organizationId_slug: {
        organizationId: org.id,
        slug: 'usdc-devnet-treasury',
      },
    },
    update: {},
    create: {
      id: treasuryId,
      organizationId: org.id,
      name: 'Atlas Main USDC Treasury',
      slug: 'usdc-devnet-treasury',
      network: 'DEVNET',
      assetSymbol: 'USDC',
      mintAddress: devnetUsdcMint,
      settlementWalletAddress: settlementWallet,
      status: 'ACTIVE',
    },
  });

  // 4. Create Active Spend Policy
  const policyRules = {
    version: 1,
    approval: {
      requiredApprovals: 2,
      eligibleRoles: ['OWNER', 'ADMIN', 'APPROVER'],
      preventCreatorApproval: true,
    },
    limits: {
      maxSinglePayoutBaseUnits: '5000000000', // 5,000 USDC
      dailyLimitBaseUnits: '25000000000', // 25,000 USDC
      monthlyLimitBaseUnits: '100000000000', // 100,000 USDC
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
        'ComputeBudget111111111111111111111111111111',
        'MemoSsq6gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcY',
      ],
      blockMemoRequired: false,
      minimumConfirmations: 'confirmed',
    },
    risk: {
      blockHighRiskRecipients: true,
      manualReviewAboveRiskLevel: 'HIGH',
    },
  };

  const policy = await prisma.policy.upsert({
    where: {
      treasuryId_version: {
        treasuryId: treasury.id,
        version: 1,
      },
    },
    update: {},
    create: {
      id: generateUlid('pol'),
      treasuryId: treasury.id,
      version: 1,
      name: 'Default Enterprise Treasury Policy v1',
      status: 'ACTIVE',
      rules: policyRules,
      createdByUserId: usersMap[Role.OWNER],
      activatedAt: new Date(),
    },
  });

  // 5. Create Recipients
  const recipientVerified = await prisma.recipient.upsert({
    where: {
      organizationId_walletAddress_expectedMintAddress: {
        organizationId: org.id,
        walletAddress: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
        expectedMintAddress: devnetUsdcMint,
      },
    },
    update: {},
    create: {
      id: generateUlid('rec'),
      organizationId: org.id,
      displayName: 'Acme Logistics Inc',
      recipientType: 'BUSINESS',
      status: RecipientStatus.VERIFIED,
      walletAddress: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
      expectedMintAddress: devnetUsdcMint,
      countryCode: 'US',
      email: 'billing@acmelogistics.local',
      referenceCode: 'VEN-8821',
      riskLevel: RiskLevel.LOW,
      verificationNotes: 'Verified via Corporate Tax ID and Bank Letter in Q1 2026',
    },
  });

  const recipientPending = await prisma.recipient.upsert({
    where: {
      organizationId_walletAddress_expectedMintAddress: {
        organizationId: org.id,
        walletAddress: '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q544fKrF',
        expectedMintAddress: devnetUsdcMint,
      },
    },
    update: {},
    create: {
      id: generateUlid('rec'),
      organizationId: org.id,
      displayName: 'Global Tech Contractors Ltd',
      recipientType: 'BUSINESS',
      status: RecipientStatus.PENDING,
      walletAddress: '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q544fKrF',
      expectedMintAddress: devnetUsdcMint,
      countryCode: 'GB',
      email: 'payouts@globaltech.local',
      referenceCode: 'VEN-9012',
      riskLevel: RiskLevel.MEDIUM,
      verificationNotes: 'Documentation submitted; awaiting compliance review',
    },
  });

  const recipientBlocked = await prisma.recipient.upsert({
    where: {
      organizationId_walletAddress_expectedMintAddress: {
        organizationId: org.id,
        walletAddress: '11111111111111111111111111111111',
        expectedMintAddress: devnetUsdcMint,
      },
    },
    update: {},
    create: {
      id: generateUlid('rec'),
      organizationId: org.id,
      displayName: 'Suspicious Entity Entity',
      recipientType: 'INDIVIDUAL',
      status: RecipientStatus.BLOCKED,
      walletAddress: '11111111111111111111111111111111',
      expectedMintAddress: devnetUsdcMint,
      countryCode: 'XX',
      email: 'flagged@unknown.local',
      referenceCode: 'BLK-001',
      riskLevel: RiskLevel.CRITICAL,
      verificationNotes: 'High risk flags detected. Blocked automatically.',
    },
  });

  // 6. Create Seed Payouts & Approvals & Ledger & Audit
  const payout1Id = generateUlid('pay');
  const payout1 = await prisma.payout.upsert({
    where: { organizationId_idempotencyKey: { organizationId: org.id, idempotencyKey: 'idem-seed-001' } },
    update: {},
    create: {
      id: payout1Id,
      organizationId: org.id,
      treasuryId: treasury.id,
      recipientId: recipientVerified.id,
      idempotencyKey: 'idem-seed-001',
      externalReference: 'INV-2026-0041',
      invoiceReference: 'PO-99120',
      amountBaseUnits: '1500000000', // 1,500 USDC
      decimals: 6,
      assetSymbol: 'USDC',
      mintAddress: devnetUsdcMint,
      memo: 'March Freight Invoice #41',
      status: PayoutStatus.CONFIRMED,
      riskLevel: RiskLevel.LOW,
      riskReasons: [],
      policyEvaluation: { decision: 'REQUIRE_APPROVAL', requiredApprovals: 2, policyVersion: 1 },
      simulationResult: { success: true, unitsConsumed: 12500, programIds: ['11111111111111111111111111111111', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'] },
      transactionBase64: 'AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
      transactionSignature: '5K7m1zX4vM9nL2kP8jQ3wE6rT1yU4iO9pS2aD5fG8hJ0kL3mN6bP9qR2sT5uV8wX',
      submittedAt: new Date(Date.now() - 3600000 * 2),
      confirmedAt: new Date(Date.now() - 3600000 * 1.9),
      createdByUserId: usersMap[Role.OPERATOR],
    },
  });

  // Approvals for Payout 1
  await prisma.payoutApproval.createMany({
    data: [
      { id: generateUlid('app'), payoutId: payout1.id, userId: usersMap['APPROVER1'], decision: 'APPROVED', comment: 'Verified invoice with freight receipt' },
      { id: generateUlid('app'), payoutId: payout1.id, userId: usersMap['APPROVER2'], decision: 'APPROVED', comment: 'Approved per Q1 treasury budget' },
    ],
    skipDuplicates: true,
  });

  // Payout 2: Pending Approval
  const payout2Id = generateUlid('pay');
  const payout2 = await prisma.payout.upsert({
    where: { organizationId_idempotencyKey: { organizationId: org.id, idempotencyKey: 'idem-seed-002' } },
    update: {},
    create: {
      id: payout2Id,
      organizationId: org.id,
      treasuryId: treasury.id,
      recipientId: recipientVerified.id,
      idempotencyKey: 'idem-seed-002',
      externalReference: 'INV-2026-0089',
      invoiceReference: 'PO-99185',
      amountBaseUnits: '3500000000', // 3,500 USDC
      decimals: 6,
      assetSymbol: 'USDC',
      mintAddress: devnetUsdcMint,
      memo: 'Q2 Server Infrastructure Vendor Payment',
      status: PayoutStatus.PENDING_APPROVAL,
      riskLevel: RiskLevel.LOW,
      riskReasons: [],
      policyEvaluation: { decision: 'REQUIRE_APPROVAL', requiredApprovals: 2, policyVersion: 1 },
      createdByUserId: usersMap[Role.OPERATOR],
    },
  });

  // Approvals for Payout 2 (1 of 2 collected)
  await prisma.payoutApproval.createMany({
    data: [
      { id: generateUlid('app'), payoutId: payout2.id, userId: usersMap['APPROVER1'], decision: 'APPROVED', comment: 'First approval granted' },
    ],
    skipDuplicates: true,
  });

  // 7. Seed Webhook Endpoint
  await prisma.webhookEndpoint.upsert({
    where: { id: 'wh_seed_001' },
    update: {},
    create: {
      id: 'wh_seed_001',
      organizationId: org.id,
      url: 'https://example-erp.local/webhooks/atlas',
      secretEncrypted: 'whsec_encrypted_dev_sample_secret',
      eventTypes: ['payout.created', 'payout.confirmed', 'payout.failed'],
      status: WebhookEndpointStatus.DISABLED,
    },
  });

  // 8. Seed Audit & Ledger Records
  await prisma.ledgerEntry.createMany({
    data: [
      {
        id: generateUlid('ldg'),
        organizationId: org.id,
        treasuryId: treasury.id,
        payoutId: payout1.id,
        entryType: LedgerEntryType.PAYOUT_CONFIRMED,
        direction: LedgerDirection.DEBIT,
        amountBaseUnits: '1500000000',
        assetSymbol: 'USDC',
        referenceType: 'PAYOUT',
        referenceId: payout1.id,
        metadata: { signature: payout1.transactionSignature },
      },
    ],
    skipDuplicates: true,
  });

  await prisma.auditEvent.createMany({
    data: [
      {
        id: generateUlid('aud'),
        organizationId: org.id,
        actorType: ActorType.USER,
        actorId: usersMap[Role.OWNER],
        action: 'POLICY_ACTIVATED',
        resourceType: 'POLICY',
        resourceId: policy.id,
        metadata: { version: 1 },
      },
      {
        id: generateUlid('aud'),
        organizationId: org.id,
        actorType: ActorType.USER,
        actorId: usersMap[Role.OPERATOR],
        action: 'PAYOUT_SUBMITTED_FOR_APPROVAL',
        resourceType: 'PAYOUT',
        resourceId: payout2.id,
        metadata: { amountBaseUnits: '3500000000' },
      },
    ],
    skipDuplicates: true,
  });

  console.info('✅ Atlas Rail database seeded successfully!');
  console.info('📌 Demo Credentials:');
  console.info('   Owner:     owner@atlasrail.local / ChangeMe_AtlasRail_DevOnly');
  console.info('   Operator:  operator@atlasrail.local / ChangeMe_AtlasRail_DevOnly');
  console.info('   Approver1: approver1@atlasrail.local / ChangeMe_AtlasRail_DevOnly');
  console.info('   Approver2: approver2@atlasrail.local / ChangeMe_AtlasRail_DevOnly');
  console.info('   Auditor:   auditor@atlasrail.local / ChangeMe_AtlasRail_DevOnly');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
