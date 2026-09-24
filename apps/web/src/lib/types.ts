import type { UserRole, PolicyRules, PolicyEvaluationOutput } from '@atlas-rail/domain';

export type { UserRole, PolicyRules, PolicyEvaluationOutput };

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  organizationId: string;
  role: UserRole;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED';
  createdAt: string;
}

export type TreasuryStatus = 'ACTIVE' | 'FROZEN';

export interface Policy {
  id: string;
  treasuryId: string;
  version: number;
  name: string;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  rules: PolicyRules;
  createdByUserId: string;
  activatedAt: string | null;
  createdAt: string;
}

export interface Treasury {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  network: string;
  assetSymbol: string;
  mintAddress: string;
  settlementWalletAddress: string;
  status: TreasuryStatus;
  createdAt: string;
  policies?: Policy[];
}

export interface TreasuryBalance {
  assetSymbol: string;
  network: string;
  balanceBaseUnits: string;
  balanceDisplay: string;
  decimals: number;
}

export type RecipientStatus = 'PENDING' | 'VERIFIED' | 'BLOCKED' | 'ARCHIVED';
export type RecipientType = 'BUSINESS' | 'INDIVIDUAL' | 'INTERNAL';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface Recipient {
  id: string;
  organizationId: string;
  displayName: string;
  recipientType: RecipientType;
  status: RecipientStatus;
  walletAddress: string;
  expectedMintAddress: string;
  countryCode?: string | null;
  email?: string | null;
  referenceCode?: string | null;
  riskLevel: RiskLevel;
  verificationNotes?: string | null;
  createdAt: string;
}

export type PayoutStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'QUEUED_FOR_EXECUTION'
  | 'SIMULATING'
  | 'SIMULATION_FAILED'
  | 'READY_TO_SIGN'
  | 'SUBMITTED'
  | 'CONFIRMED'
  | 'FAILED'
  | 'CANCELLED'
  | 'BLOCKED';

export interface PayoutApproval {
  id: string;
  payoutId: string;
  userId: string;
  decision: 'APPROVED' | 'REJECTED';
  comment?: string | null;
  createdAt: string;
  user: { id: string; displayName: string; email: string };
}

export interface SimulationResult {
  success: boolean;
  error?: string | null;
  logs?: string[];
  unitsConsumed?: number | null;
  programIds: string[];
  unknownProgramIds: string[];
  warnings: string[];
}

export interface Payout {
  id: string;
  organizationId: string;
  treasuryId: string;
  recipientId: string;
  idempotencyKey: string;
  externalReference?: string | null;
  invoiceReference?: string | null;
  amountBaseUnits: string;
  decimals: number;
  assetSymbol: string;
  mintAddress: string;
  memo?: string | null;
  status: PayoutStatus;
  riskLevel: RiskLevel;
  riskReasons?: string[];
  policyEvaluation: PolicyEvaluationOutput;
  simulationResult?: SimulationResult | null;
  transactionSignature?: string | null;
  submittedAt?: string | null;
  confirmedAt?: string | null;
  failureCode?: string | null;
  failureMessage?: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  recipient?: Recipient;
  treasury?: Treasury;
  approvals?: PayoutApproval[];
}

export interface AuditEvent {
  id: string;
  organizationId: string;
  actorType: 'USER' | 'API_KEY' | 'SYSTEM';
  actorId?: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface LedgerEntry {
  id: string;
  organizationId: string;
  treasuryId: string;
  payoutId?: string | null;
  entryType: string;
  direction: 'DEBIT' | 'CREDIT' | 'INFORMATIONAL';
  amountBaseUnits?: string | null;
  assetSymbol?: string | null;
  referenceType: string;
  referenceId: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  payout?: {
    invoiceReference?: string | null;
    externalReference?: string | null;
    recipient?: Recipient;
  } | null;
  treasury?: Treasury;
}

export interface ReconciliationSummary {
  assetSymbol: string;
  network: string;
  confirmedPayoutsCount: number;
  totalVolumeBaseUnits: string;
  totalVolumeDisplay: string;
}

export interface WebhookDelivery {
  id: string;
  webhookEndpointId: string;
  eventType: string;
  attemptCount: number;
  status: 'PENDING' | 'DELIVERED' | 'FAILED';
  responseStatus?: number | null;
  createdAt: string;
  deliveredAt?: string | null;
}

export interface WebhookEndpoint {
  id: string;
  organizationId: string;
  url: string;
  eventTypes: string[];
  status: 'ACTIVE' | 'DISABLED';
  createdAt: string;
  _count?: { deliveries: number };
}

export interface ApiKeySummary {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt?: string | null;
  expiresAt?: string | null;
  createdAt: string;
}
