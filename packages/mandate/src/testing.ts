/**
 * Deterministic fixtures for tests (this package's and the packages built on it). Keys are derived
 * from fixed seeds and are worthless: never use them outside tests and the devnet demo.
 */
import { LocalEd25519Signer } from './crypto';
import { GateApproval, GateContext, GateSimulation } from './gate';
import { createMandate } from './mandate';
import { signMandate } from './mandate';
import { X402Offer, hashOffer } from './offer';
import { AgentMandate, SOLANA_DEVNET_CAIP2 } from './schema';

export function seededSigner(label: string): LocalEd25519Signer {
  const seed = new Uint8Array(32);
  const bytes = new TextEncoder().encode(label);
  for (let i = 0; i < bytes.length && i < 32; i++) seed[i] = bytes[i];
  return new LocalEd25519Signer(seed);
}

export const TEST_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
export const TEST_ORIGIN = 'http://localhost:4402';
export const NOW = 1_800_000_000;

export const signers = {
  owner: seededSigner('owner'),
  approver: seededSigner('approver'),
  approver2: seededSigner('approver-2'),
  agent: seededSigner('agent'),
  instance: seededSigner('instance'),
  merchant: seededSigner('merchant'),
  attacker: seededSigner('attacker'),
  facilitator: seededSigner('facilitator'),
};

export interface TestMandateOptions {
  notBefore?: number;
  expiresAt?: number;
  maxPerPayment?: string;
  maxPerWindow?: string;
  maxTotal?: string;
  threshold?: string;
  windowSeconds?: number;
  allowedResources?: string[];
  escalationResources?: string[];
  requiredApprovals?: number;
  id?: string;
  nonce?: string;
}

/** Unsigned mandate: $5/day autonomous budget, $50 hard ceiling per payment, $100 lifetime, human approval above $1. */
export function unsignedTestMandate(options: TestMandateOptions = {}): AgentMandate {
  return createMandate({
    id: options.id ?? 'mnd_TESTMANDATE0000000001',
    nonce: options.nonce ?? '00112233445566778899aabbccddeeff',
    issuer: { organizationId: 'org_test', name: 'Atlas Demo Imports' },
    agent: { publicKey: signers.agent.publicKey, label: 'Research Agent' },
    delegation: { requiredApprovals: options.requiredApprovals ?? 1 },
    scope: {
      allowedNetworks: [SOLANA_DEVNET_CAIP2],
      allowedAssets: [TEST_MINT],
      allowedPayTo: [signers.merchant.publicKey],
      allowedResources: options.allowedResources ?? [`${TEST_ORIGIN}/research/*`],
      limits: {
        mint: TEST_MINT,
        maxPerPayment: options.maxPerPayment ?? '50000000',
        maxPerWindow: options.maxPerWindow ?? '5000000',
        windowSeconds: options.windowSeconds ?? 86_400,
        maxTotal: options.maxTotal ?? '100000000',
      },
    },
    escalation: {
      thresholdBaseUnits: options.threshold ?? '1000000',
      approverRoles: ['OWNER', 'ADMIN', 'APPROVER'],
      resources: options.escalationResources ?? [`${TEST_ORIGIN}/inference/*`],
      approvalTtlSeconds: 900,
    },
    notBefore: options.notBefore ?? NOW - 3_600,
    expiresAt: options.expiresAt ?? NOW + 3 * 86_400,
  });
}

export async function signedTestMandate(options: TestMandateOptions = {}): Promise<AgentMandate> {
  let mandate = unsignedTestMandate(options);
  mandate = await signMandate(mandate, { role: 'OWNER', signer: signers.owner });
  mandate = await signMandate(mandate, { role: 'APPROVER', signer: signers.approver });
  if ((options.requiredApprovals ?? 1) > 1) {
    mandate = await signMandate(mandate, { role: 'APPROVER', signer: signers.approver2 });
  }
  return signMandate(mandate, { role: 'AGENT', signer: signers.agent });
}

export function testOffer(overrides: Partial<X402Offer> = {}): X402Offer {
  return {
    x402Version: 2,
    scheme: 'exact',
    network: SOLANA_DEVNET_CAIP2,
    asset: TEST_MINT,
    payTo: signers.merchant.publicKey,
    amount: '10000',
    resourceUrl: `${TEST_ORIGIN}/research/summary`,
    feePayer: signers.facilitator.publicKey,
    memo: null,
    ...overrides,
  };
}

export function testSimulation(overrides: Partial<GateSimulation> = {}): GateSimulation {
  return {
    success: true,
    error: null,
    programIds: [
      'ComputeBudget111111111111111111111111111111',
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
    ],
    unknownProgramIds: [],
    transferCount: 1,
    matchesOffer: true,
    mismatch: null,
    txMessageHash: 'a'.repeat(64),
    unitsConsumed: 18_000,
    ...overrides,
  };
}

export function testContext(overrides: Partial<GateContext> = {}): GateContext {
  return {
    now: NOW,
    revoked: null,
    spend: { windowAutonomousBaseUnits: '0', totalBaseUnits: '0' },
    simulation: testSimulation(),
    requireSimulation: true,
    approval: null,
    ...overrides,
  };
}

export function testApproval(offer: X402Offer, overrides: Partial<GateApproval> = {}): GateApproval {
  return {
    id: 'apr_TEST',
    offerHash: hashOffer(offer),
    status: 'APPROVED',
    expiresAt: NOW + 600,
    approver: { userId: 'usr_approver', role: 'APPROVER' },
    ...overrides,
  };
}
