/** Shapes returned by the /v1/agent/* endpoints, as the console consumes them. */

export type GateDecisionOutcome = 'ALLOW' | 'DENY' | 'ESCALATE';
export type RuleStatus = 'PASS' | 'FAIL' | 'ESCALATE' | 'OVERRIDDEN' | 'SKIPPED';

export interface RuleResultView {
  id: string;
  status: RuleStatus;
  message: string;
  details: Record<string, unknown>;
}

export interface AgentDecisionView {
  id: string;
  mandateId: string;
  decision: GateDecisionOutcome;
  kind: 'AUTONOMOUS' | 'APPROVED' | null;
  failedRule: string | null;
  failedRules: string[];
  escalationRules: string[];
  reason: string;
  rulesEvaluated: RuleResultView[];
  offer: { resourceUrl: string; payTo: string; asset: string; amount: string };
  approvalId: string | null;
  decisionHash: string;
  createdAt: number;
}

export interface DelegationLinkView {
  role: 'OWNER' | 'APPROVER' | 'AGENT';
  publicKey: string;
  signature: string;
}

export interface MandateDocument {
  id: string;
  issuer: { organizationId: string; name: string };
  agent: { publicKey: string; label: string };
  delegation: { requiredApprovals: number; preventIssuerApproval: boolean };
  scope: {
    allowedNetworks: string[];
    allowedAssets: string[];
    allowedPayTo: string[];
    allowedResources: string[];
    limits: { mint: string; maxPerPayment: string; maxPerWindow: string; windowSeconds: number; maxTotal: string };
  };
  escalation: { thresholdBaseUnits: string; approverRoles: string[]; resources: string[]; approvalTtlSeconds: number };
  notBefore: number;
  expiresAt: number;
  nonce: string;
  delegationChain: DelegationLinkView[];
}

export type MandateStatusView = 'DRAFT' | 'ACTIVE' | 'EXPIRED' | 'NOT_YET_VALID' | 'REVOKED';

export interface MandateView {
  id: string;
  status: MandateStatusView;
  mandateHash: string;
  mandate: MandateDocument;
  signers: Array<{ role: 'OWNER' | 'APPROVER' | 'AGENT'; publicKey: string; userId: string | null; displayName: string | null; signedAt: number }>;
  revocation: { revokedAt: number; reason: string | null; revokedBy: string | null } | null;
  createdAt: number;
  spend: { windowAutonomousBaseUnits: string; totalBaseUnits: string };
  verification: { valid: boolean; checks: Array<{ id: string; ok: boolean; message: string }>; errors: string[] };
}

export type ApprovalStatusView = 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED' | 'CONSUMED';

export interface ApprovalView {
  id: string;
  mandateId: string;
  agentLabel?: string;
  decisionId: string;
  offerHash: string;
  offer: { resourceUrl: string; payTo: string; asset: string; amount: string };
  status: ApprovalStatusView;
  requiredRoles: string[];
  requestedAt: number;
  expiresAt: number;
  decidedAt: number | null;
  decidedBy: { userId: string; role: string } | null;
  comment: string | null;
  escalationRules: string[];
}

export interface ReceiptListItem {
  id: string;
  receiptHash: string;
  mandateId: string;
  agentLabel: string;
  decisionId: string;
  decisionKind: 'AUTONOMOUS' | 'APPROVED' | null;
  txSignature: string;
  amount: string;
  asset: string;
  payTo: string;
  resourceUrl: string;
  issuedAt: number;
  anchored: boolean;
  anchorTx: string | null;
}

export interface ReceiptCheckView {
  id: string;
  title: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  message: string;
}

export interface ReceiptVerificationView {
  pass: boolean;
  checks: ReceiptCheckView[];
}

export interface BoundReceiptView {
  id: string;
  receiptHash: string;
  issuedAt: number;
  mandate: MandateDocument;
  offer: { resourceUrl: string; payTo: string; asset: string; amount: string; network: string };
  decision: { record: AgentDecisionView & { context: unknown; request: unknown }; decisionHash: string };
  settlement: { txSignature: string; network: string; payer: string | null; settledAt: number | null; slot: number | null };
  response: { status: number; bodySha256: string; contentType: string | null };
  instance: { publicKey: string; signature: string };
  anchor?: {
    batchId: string;
    merkleRoot: string;
    leafCount: number;
    leafIndex: number;
    proof: Array<{ position: 'left' | 'right'; hash: string }>;
    txSignature: string;
    anchoredAt: number | null;
    signer: string;
  };
}

export interface AnchorRunResult {
  batch: { id: string; merkleRoot: string; leafCount: number; txSignature: string | null } | null;
  anchored: number;
}
