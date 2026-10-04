/**
 * The playground's walkthrough, built on the real gate and receipt code — not a mock-up.
 *
 * `evaluateGate` (packages/mandate), `buildReceipt`/`verifyReceipt` (packages/receipt) and the
 * mandate signing primitives are the exact same functions the console, the CLI and the devnet
 * demo use. Nothing here reimplements policy logic for the UI's sake.
 *
 * Runs entirely server-side (Node runtime route handler): no persistence, no outbound network
 * calls unless devnet mode is on. Keys are generated fresh per visitor session (instant mode) or
 * read from server-held env vars (devnet mode) — see devnet.ts. Either way they are never used to
 * move anything of real value; only mandate registration/revocation ever touches a chain, and only
 * when the visitor opts into devnet mode. Payment settlement in every step is synthetic (never a
 * real transfer) — nothing a visitor does can touch real funds.
 */
import {
  AgentMandate,
  GateApproval,
  GateContext,
  GateResult,
  LocalEd25519Signer,
  MessageSigner,
  RuleId,
  SOLANA_DEVNET_CAIP2,
  X402Offer,
  buildDecisionRecord,
  createMandate,
  evaluateGate,
  fromHex,
  hashOffer,
  sha256Bytes,
  signDecision,
  signMandate,
  toHex,
} from '@atlas-rail/mandate';
import { BoundReceipt, ReceiptVerification, buildReceipt, merkleProof, merkleRoot, verifyReceipt } from '@atlas-rail/receipt';
import { KeyInfo, PaymentOutcome, RuleDisplay, World } from './types';

export const DEMO_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const SELLER_A_ORIGIN = 'https://research.atlasrail-sellers.dev';
const SELLER_B_ORIGIN = 'https://insights.atlasrail-sellers.dev';
const ATTACKER_ORIGIN = 'https://secure-wallet-rewards.example';
export const RESEARCH_RESOURCE = `${SELLER_A_ORIGIN}/summary/weekly`;

const MAX_PER_PAYMENT = '5000000'; // $5.00
const MAX_PER_WINDOW = '20000000'; // $20.00
const WINDOW_SECONDS = 3600; // 1 hour
const MAX_TOTAL = '100000000'; // $100.00
const ESCALATION_THRESHOLD = MAX_PER_PAYMENT; // schema requires threshold <= maxPerPayment
const EXPECTED_PRICE = '10000'; // $0.01
const PRICE_TOLERANCE_PCT = 50; // tolerated ceiling: $0.015
const PRICE_HARD_MAX = '30000'; // $0.03 — anything above this is always denied
export const MODERATE_SPIKE_AMOUNT = '20000'; // $0.02 — above tolerance, within hard max: escalate
export const SEVERE_SPIKE_AMOUNT = '50000'; // $0.05 — above hard max: deny

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function randomId(): string {
  return Array.from(randomBytes(10), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function randomKeyInfo(label: string): KeyInfo {
  const seedHex = toHex(randomBytes(32));
  const signer = new LocalEd25519Signer(fromHex(seedHex));
  return { label, publicKey: signer.publicKey, seedHex };
}

function materializeSigner(key: KeyInfo): MessageSigner {
  if (!key.seedHex) throw new Error(`No key material available for ${key.label} in this mode`);
  return new LocalEd25519Signer(fromHex(key.seedHex));
}

/** Instant mode: every key is freshly random per visitor session and carries its seed so a
 * stateless server can resume on the next request. */
function freshInstantKeys(): World['keys'] {
  return {
    owner: randomKeyInfo('owner'),
    approver: randomKeyInfo('approver'),
    agent: randomKeyInfo('agent'),
    instance: randomKeyInfo('instance'),
    sellerA: randomKeyInfo('sellerA'),
    sellerB: randomKeyInfo('sellerB'),
    attacker: randomKeyInfo('attacker'),
  };
}

function unsignedMandate(keys: World['keys'], now: number): AgentMandate {
  return createMandate({
    issuer: { organizationId: 'org_playground', name: 'Atlas Rail Playground' },
    agent: { publicKey: keys.agent.publicKey, label: 'Research Agent' },
    delegation: { requiredApprovals: 1 },
    scope: {
      allowedNetworks: [SOLANA_DEVNET_CAIP2],
      allowedAssets: [DEMO_MINT],
      allowedPayTo: [keys.sellerA.publicKey, keys.sellerB.publicKey],
      allowedResources: [`${SELLER_A_ORIGIN}/summary/*`, `${SELLER_B_ORIGIN}/summary/*`],
      limits: {
        mint: DEMO_MINT,
        maxPerPayment: MAX_PER_PAYMENT,
        maxPerWindow: MAX_PER_WINDOW,
        windowSeconds: WINDOW_SECONDS,
        maxTotal: MAX_TOTAL,
      },
      priceLimits: [
        {
          resource: `${SELLER_A_ORIGIN}/summary/*`,
          expectedPriceBaseUnits: EXPECTED_PRICE,
          tolerancePct: PRICE_TOLERANCE_PCT,
          hardMaxBaseUnits: PRICE_HARD_MAX,
        },
      ],
    },
    escalation: {
      thresholdBaseUnits: ESCALATION_THRESHOLD,
      approverRoles: ['OWNER', 'APPROVER'],
      resources: [],
      approvalTtlSeconds: 900,
    },
    notBefore: now - 60,
    expiresAt: now + 3 * 86_400,
  });
}

export interface DevnetCoreKeys {
  owner: KeyInfo;
  approver: KeyInfo;
  agent: KeyInfo;
  instance: KeyInfo;
}

/** Step 1 (Meet the agent) + the mandate skeleton Step 2 will sign. No chain access, instant.
 * In devnet mode, owner/approver/agent/instance are the server's fixed, funded demo keys
 * (devnet.ts); sellers and the attacker are always freshly random, since they never need funding. */
export function initWorld(mode: 'instant' | 'devnet', devnetCore: DevnetCoreKeys | null): { world: World } {
  const now = Math.floor(Date.now() / 1000);
  const keys: World['keys'] =
    mode === 'devnet' && devnetCore
      ? { ...devnetCore, sellerA: randomKeyInfo('sellerA'), sellerB: randomKeyInfo('sellerB'), attacker: randomKeyInfo('attacker') }
      : freshInstantKeys();
  const mandate = unsignedMandate(keys, now);
  return {
    world: {
      mode,
      now,
      keys,
      mandate,
      mandateOnchain: null,
      spend: { windowAutonomousBaseUnits: '0', totalBaseUnits: '0' },
      revoked: null,
      revokeOnchain: null,
      receipts: [],
      devnetFallbackReason: null,
    },
  };
}

/** Step 2 (Give it rules): owner, then approver, then the agent itself sign the mandate. Pure, free. */
export async function signMandateStep(world: World): Promise<World> {
  if (!world.mandate) throw new Error('No mandate to sign');
  let mandate = world.mandate;
  mandate = await signMandate(mandate, { role: 'OWNER', signer: materializeSigner(world.keys.owner) });
  mandate = await signMandate(mandate, { role: 'APPROVER', signer: materializeSigner(world.keys.approver) });
  mandate = await signMandate(mandate, { role: 'AGENT', signer: materializeSigner(world.keys.agent) });
  return { ...world, mandate };
}

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Looks like a real Solana signature but is never submitted anywhere — every playground payment
 * is synthetic, so this never needs to resolve to a real transaction. */
function syntheticTxSignature(): string {
  const bytes = randomBytes(48);
  let n = BigInt('0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''));
  let out = '';
  const base = BigInt(58);
  while (n > 0n) {
    out = BASE58_ALPHABET[Number(n % base)] + out;
    n /= base;
  }
  return out.padEnd(66, BASE58_ALPHABET[0]);
}

function friendlyRuleLabel(rule: { id: RuleId; status: string; message: string }): string {
  const map: Partial<Record<RuleId, Partial<Record<string, string>>>> = {
    RESOURCE_ALLOWED: { PASS: 'This is something the agent is allowed to buy', FAIL: 'Not something this agent is allowed to buy' },
    PAYTO_ALLOWED: { PASS: "The seller is on the mandate's allowlist", FAIL: "Seller is not on the mandate's allowlist" },
    MAX_PER_PAYMENT: { PASS: 'Within the per-payment ceiling', FAIL: 'Above the hard per-payment ceiling' },
    PRICE_LIMIT: {
      PASS: 'Price matches what the owner signed off on',
      ESCALATE: 'Price is higher than expected — within the range a human can still approve',
      FAIL: 'Price is above the hard maximum the owner signed off on',
    },
    WINDOW_BUDGET: { PASS: 'Fits the rolling spending budget', ESCALATE: 'Would exceed the autonomous spending budget' },
    MAX_TOTAL: { PASS: 'Within the lifetime cap', FAIL: 'Would exceed the lifetime cap' },
    MANDATE_NOT_REVOKED: { PASS: 'Mandate has not been revoked', FAIL: 'Mandate was revoked' },
    MANDATE_VALIDITY: { PASS: 'Mandate is currently valid', FAIL: 'Mandate is not valid right now' },
    ESCALATION_APPROVAL: { PASS: 'A human approved this exact payment', FAIL: 'Human approval is missing or was rejected' },
  };
  return map[rule.id]?.[rule.status] ?? rule.message;
}

function displayRules(gate: GateResult): RuleDisplay[] {
  return gate.rulesEvaluated
    .filter((r) => r.status !== 'SKIPPED')
    .map((r) => ({
      id: r.id,
      verdict:
        r.status === 'PASS' ? 'pass' : r.status === 'ESCALATE' ? 'escalate' : r.status === 'OVERRIDDEN' ? 'overridden' : r.status === 'FAIL' ? 'fail' : 'skipped',
      label: friendlyRuleLabel(r),
      raw: r,
    }));
}

type DisplayContext = 'normal' | 'attack' | 'spike-moderate' | 'spike-severe' | 'approval';

function headlineFor(gate: GateResult, context: DisplayContext): string {
  if (gate.decision === 'ALLOW') {
    return context === 'approval' ? 'Allowed — the human approved it' : 'Allowed';
  }
  if (gate.decision === 'ESCALATE') return 'Needs a human';
  if (context === 'attack') return 'Blocked: seller not on the list';
  if (gate.failedRules.includes('MANDATE_NOT_REVOKED')) return 'Blocked: the mandate was revoked';
  if (gate.failedRules.includes('PRICE_LIMIT')) return 'Blocked: price is above the hard maximum';
  if (gate.failedRules.includes('ESCALATION_APPROVAL')) return 'Blocked: the human rejected this payment';
  const failed = gate.rulesEvaluated.find((r) => r.id === gate.failedRule);
  return `Blocked: ${failed?.message ?? gate.reason}`;
}

async function evaluateAndMaybeReceipt(
  world: World,
  offer: X402Offer,
  context: GateContext,
  display: DisplayContext,
  amountUsd: string,
): Promise<{ world: World; outcome: PaymentOutcome }> {
  const mandate = world.mandate;
  if (!mandate) throw new Error('Mandate is not signed yet');
  const gate = evaluateGate(mandate, offer, context);
  let receipt: BoundReceipt | null = null;
  let nextWorld = world;

  if (gate.decision === 'ALLOW') {
    const instanceSigner = materializeSigner(world.keys.instance);
    const decisionRecord = buildDecisionRecord({
      id: `dec_${randomId()}`,
      organizationId: mandate.issuer.organizationId,
      mandate,
      offer,
      result: gate,
      context,
      request: null,
    });
    const signed = await signDecision(decisionRecord, instanceSigner);
    const bodySha256 = toHex(sha256Bytes(`Paid response for ${offer.resourceUrl}`));
    receipt = await buildReceipt(
      {
        id: `rcp_${randomId()}`,
        mandate,
        decision: signed,
        settlement: { txSignature: syntheticTxSignature(), network: SOLANA_DEVNET_CAIP2, payer: mandate.agent.publicKey, settledAt: context.now, slot: null },
        response: { status: 200, bodySha256, contentType: 'text/plain' },
        issuedAt: context.now,
      },
      instanceSigner,
    );
    const spent = BigInt(offer.amount);
    nextWorld = {
      ...world,
      receipts: [...world.receipts, receipt],
      spend:
        gate.kind === 'AUTONOMOUS'
          ? {
              windowAutonomousBaseUnits: (BigInt(world.spend.windowAutonomousBaseUnits) + spent).toString(),
              totalBaseUnits: (BigInt(world.spend.totalBaseUnits) + spent).toString(),
            }
          : { ...world.spend, totalBaseUnits: (BigInt(world.spend.totalBaseUnits) + spent).toString() },
    };
  }

  return {
    world: nextWorld,
    outcome: {
      verdict: gate.decision,
      headline: headlineFor(gate, display),
      amountUsd,
      resourceUrl: offer.resourceUrl,
      payTo: offer.payTo,
      rules: displayRules(gate),
      gate,
      receipt,
    },
  };
}

function baseContext(world: World, extra: Partial<GateContext> = {}): GateContext {
  return {
    now: world.now,
    revoked: world.revoked,
    spend: world.spend,
    simulation: {
      success: true,
      error: null,
      programIds: ['ComputeBudget111111111111111111111111111111', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'],
      unknownProgramIds: [],
      transferCount: 1,
      matchesOffer: true,
      mismatch: null,
      txMessageHash: 'a'.repeat(64),
      unitsConsumed: 18_000,
    },
    requireSimulation: true,
    approval: null,
    ...extra,
  };
}

function baseOffer(world: World, overrides: Partial<X402Offer>): X402Offer {
  return {
    x402Version: 2,
    scheme: 'exact',
    network: SOLANA_DEVNET_CAIP2,
    asset: DEMO_MINT,
    payTo: world.keys.sellerA.publicKey,
    amount: EXPECTED_PRICE,
    resourceUrl: RESEARCH_RESOURCE,
    feePayer: world.keys.instance.publicKey,
    memo: null,
    ...overrides,
  };
}

/** Step 3 (A normal payment). */
export async function payNormal(world: World) {
  const offer = baseOffer(world, {});
  return evaluateAndMaybeReceipt(world, offer, baseContext(world), 'normal', '$0.01');
}

/** Step 4 (An attack): prompt-injected agent tries to pay a stranger for an invented "invoice". */
export async function attack(world: World) {
  const offer = baseOffer(world, {
    payTo: world.keys.attacker.publicKey,
    amount: '500000000',
    resourceUrl: `${ATTACKER_ORIGIN}/invoice`,
  });
  return evaluateAndMaybeReceipt(world, offer, baseContext(world), 'attack', '$500.00');
}

/** Step 5a: the approved seller raises its price moderately — above tolerance, within the hard max. */
export async function priceSpikeModerate(world: World) {
  const offer = baseOffer(world, { amount: MODERATE_SPIKE_AMOUNT });
  return evaluateAndMaybeReceipt(world, offer, baseContext(world), 'spike-moderate', '$0.02');
}

/** Step 5b: a 5x spike, above the hard maximum — always denied, no human can override it. */
export async function priceSpikeSevere(world: World) {
  const offer = baseOffer(world, { amount: SEVERE_SPIKE_AMOUNT });
  return evaluateAndMaybeReceipt(world, offer, baseContext(world), 'spike-severe', '$0.05');
}

/** Step 6 (You are the human): approve or reject the moderate price-spike payment from step 5a. */
export async function humanDecision(world: World, approve: boolean) {
  const offer = baseOffer(world, { amount: MODERATE_SPIKE_AMOUNT });
  const approval: GateApproval = {
    id: `apr_${randomId()}`,
    offerHash: hashOffer(offer),
    status: approve ? 'APPROVED' : 'DENIED',
    expiresAt: world.now + 900,
    approver: { userId: 'visitor', role: 'APPROVER' },
  };
  return evaluateAndMaybeReceipt(world, offer, baseContext(world, { approval }), 'approval', '$0.02');
}

/** Step 8 (Revoke): the owner revokes the mandate, then the agent tries one more payment. */
export function revokeMandate(world: World, reason: string): World {
  return { ...world, revoked: { revokedAt: world.now, reason } };
}

export async function payAfterRevoke(world: World) {
  const offer = baseOffer(world, {});
  return evaluateAndMaybeReceipt(world, offer, baseContext(world), 'normal', '$0.01');
}

/** Step 7 (Prove): anchor the receipt into a (single-leaf, in-memory) Merkle batch, then verify it
 * the same way `atlas verify` does. */
export async function proveReceipt(world: World, receiptId: string): Promise<{ receipt: BoundReceipt; verification: ReceiptVerification }> {
  const receipt = world.receipts.find((r) => r.id === receiptId);
  if (!receipt) throw new Error('Receipt not found');
  const root = merkleRoot([receipt.receiptHash]);
  const proof = merkleProof([receipt.receiptHash], 0);
  const anchored: BoundReceipt = {
    ...receipt,
    anchor: {
      batchId: `batch_${randomId()}`,
      merkleRoot: root,
      leafCount: 1,
      leafIndex: 0,
      proof,
      txSignature: syntheticTxSignature(),
      network: SOLANA_DEVNET_CAIP2,
      anchoredAt: world.now,
      signer: world.keys.instance.publicKey,
    },
  };
  const verification = await verifyReceipt(anchored, { trustedInstanceKeys: [world.keys.instance.publicKey] });
  return { receipt: anchored, verification };
}
