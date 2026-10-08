/**
 * The playground's walkthrough, built on the real gate and receipt code — not a mock-up.
 *
 * `evaluateGate` (packages/mandate), `buildReceipt`/`verifyReceipt` (packages/receipt) and the
 * mandate signing primitives are the exact same functions the console, the CLI and the devnet
 * demo use. Nothing here reimplements policy logic for the UI's sake.
 *
 * Runs entirely server-side (Node runtime route handler): no persistence, no outbound network
 * calls unless devnet mode is on. Keys are generated fresh per visitor session (instant mode) or
 * read from server-held env vars (devnet mode) — see devnet.ts. In instant mode (the default),
 * payment settlement and receipt anchoring are always synthetic — nothing a visitor does can touch
 * real funds. In devnet mode, the two payments that are actually ALLOWed (step 3, step 6) settle for
 * real on Solana devnet (a real SPL token transfer, devnet-only, amounts of a cent or two), and the
 * step 7 receipt is anchored for real via the registry's `anchor_root` instruction — see the
 * `settle`/`onchainAnchor` parameters below. Every real on-chain call falls back to the synthetic
 * path with a visible reason if it fails or devnet mode isn't available for this visitor.
 */
import {
  AgentMandate,
  GateApproval,
  GateContext,
  GateResult,
  LocalEd25519Signer,
  MessageSigner,
  RuleId,
  RuleResult,
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
import type { ChainClient } from '@atlas-rail/solana';
import { BoundReceipt, ReceiptVerification, buildReceipt, merkleProof, merkleRoot, verifyReceipt } from '@atlas-rail/receipt';
import {
  ATTACK_AMOUNT,
  EXPECTED_PRICE,
  MAX_PER_PAYMENT,
  MAX_PER_WINDOW,
  MAX_TOTAL,
  MODERATE_SPIKE_AMOUNT,
  PRICE_HARD_MAX,
  PRICE_TOLERANCE_PCT,
  SEVERE_SPIKE_AMOUNT,
} from './amounts';
import { DEMO_MINT_DECIMALS, formatUsd } from './format';
import { KeyInfo, OnchainAction, PaymentOutcome, RuleDisplay, World } from './types';

export const DEMO_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const SELLER_A_ORIGIN = 'https://research.atlasrail-sellers.dev';
const SELLER_B_ORIGIN = 'https://insights.atlasrail-sellers.dev';
const ATTACKER_ORIGIN = 'https://secure-wallet-rewards.example';
export const RESEARCH_RESOURCE = `${SELLER_A_ORIGIN}/summary/weekly`;

const WINDOW_SECONDS = 3600; // 1 hour
const ESCALATION_THRESHOLD = MAX_PER_PAYMENT; // schema requires threshold <= maxPerPayment

/** A step 3/6 payment settling for real on Solana devnet (devnet mode only). Returns the on-chain
 * transaction so it can be bound into the receipt; throwing falls back to a synthetic settlement
 * with a visible reason (see evaluateAndMaybeReceipt). */
/** `receiptId` is the id this payment's receipt WILL have (decided before settlement, same as the
 * main demo's `createAtlasFetch`) — implementations that settle for real embed it in the
 * transaction's memo (`formatReceiptMemo`) so the payment is self-proving, same as N1. */
export type SettleFn = (offer: X402Offer, receiptId: string) => Promise<OnchainAction>;

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
 * (devnet.ts); sellers and the attacker are always freshly random, since they never need funding.
 * `devnetAllowed` is decided once here (by the caller, from the rate limit) and reused for every
 * on-chain action this session attempts, rather than re-spending the rate limit per action. */
export function initWorld(mode: 'instant' | 'devnet', devnetCore: DevnetCoreKeys | null, devnetAllowed = mode === 'devnet'): { world: World } {
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
      devnetAllowed: mode === 'devnet' && devnetAllowed,
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

/** PRICE_LIMIT passes vacuously (no price limit is configured at all for this resource — the attack
 * step's made-up invoice endpoint, for instance) distinctly from a price that was actually checked
 * and matched. Both come back as gate status PASS; only the message tells them apart. */
function priceLimitNotConfigured(rule: { id: RuleId; message: string }): boolean {
  return rule.id === 'PRICE_LIMIT' && rule.message === 'No price limit is configured for this resource';
}

function friendlyRuleLabel(rule: { id: RuleId; status: string; message: string }): string {
  if (priceLimitNotConfigured(rule)) return 'No price limit applies to this resource';
  const map: Partial<Record<RuleId, Partial<Record<string, string>>>> = {
    NETWORK_ALLOWED: { PASS: 'Network is allowed (Solana devnet)', FAIL: 'Network is not allowed' },
    ASSET_ALLOWED: { PASS: "Asset is on the mandate's allowlist", FAIL: "Asset is not on the mandate's allowlist" },
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

/** Reads a base-units field out of a rule's `details` and formats it as dollars; falls back to the
 * field being absent/malformed rather than throwing, since `details` is loosely typed upstream. */
function usdField(details: Record<string, unknown>, key: string): string | null {
  const value = details[key];
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  return formatUsd(value);
}

/** The human-readable sentence shown in "show details" — dollar amounts, never base units. Falls
 * back to the gate's own message (never contains money for the rules not covered here). */
function friendlyRuleDetail(rule: RuleResult): string {
  const d = rule.details as Record<string, unknown>;
  switch (rule.id) {
    case 'MAX_PER_PAYMENT': {
      const amount = usdField(d, 'amount');
      const max = usdField(d, 'maxPerPayment');
      if (amount && max) return rule.status === 'PASS' ? `${amount} is within the ${max} per-payment ceiling` : `${amount} exceeds the ${max} per-payment ceiling`;
      break;
    }
    case 'PRICE_LIMIT': {
      if (priceLimitNotConfigured(rule)) return 'This resource has no price limit set — nothing to check it against.';
      const amount = usdField(d, 'amount');
      const expected = usdField(d, 'expectedPrice');
      const ceiling = usdField(d, 'toleratedCeiling');
      const hardMax = usdField(d, 'hardMax');
      if (amount && expected && ceiling && hardMax) {
        if (rule.status === 'PASS') return `${amount} is within tolerance of the expected price ${expected}`;
        if (rule.status === 'ESCALATE') return `${amount} is above the tolerated ${ceiling} but at or below the hard maximum ${hardMax} — a human can approve it`;
        return `${amount} is above the hard maximum ${hardMax} the owner signed off on — no human can override this`;
      }
      break;
    }
    case 'WINDOW_BUDGET': {
      const projected = usdField(d, 'projected');
      const max = usdField(d, 'maxPerWindow');
      if (projected && max) return rule.status === 'PASS' ? `Spending would reach ${projected} of the ${max} hourly budget` : `Spending would reach ${projected}, above the ${max} hourly budget — needs a human`;
      break;
    }
    case 'MAX_TOTAL': {
      const projected = usdField(d, 'projected');
      const max = usdField(d, 'maxTotal');
      if (projected && max) return rule.status === 'PASS' ? `Lifetime spend would reach ${projected} of the ${max} cap` : `Lifetime spend would reach ${projected}, above the ${max} cap`;
      break;
    }
    case 'ESCALATION_THRESHOLD': {
      const amount = usdField(d, 'amount');
      const threshold = usdField(d, 'threshold');
      if (amount && threshold) return rule.status === 'PASS' ? `${amount} is at or below the ${threshold} approval threshold` : `${amount} is above the ${threshold} approval threshold`;
      break;
    }
  }
  return rule.message;
}

function displayRules(gate: GateResult): RuleDisplay[] {
  return gate.rulesEvaluated
    .filter((r) => r.status !== 'SKIPPED')
    .map((r) => ({
      id: r.id,
      verdict: priceLimitNotConfigured(r)
        ? 'not-applicable'
        : r.status === 'PASS'
          ? 'pass'
          : r.status === 'ESCALATE'
            ? 'escalate'
            : r.status === 'OVERRIDDEN'
              ? 'overridden'
              : r.status === 'FAIL'
                ? 'fail'
                : 'skipped',
      label: friendlyRuleLabel(r),
      detail: friendlyRuleDetail(r),
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
  settle?: SettleFn,
): Promise<{ world: World; outcome: PaymentOutcome }> {
  const mandate = world.mandate;
  if (!mandate) throw new Error('Mandate is not signed yet');
  const gate = evaluateGate(mandate, offer, context);
  let receipt: BoundReceipt | null = null;
  let nextWorld = world;
  let onchain: OnchainAction | null = null;

  if (gate.decision === 'ALLOW') {
    // Decided before settlement, same as the main demo's createAtlasFetch, so a real settlement can
    // embed it in the transaction's memo and this receipt ends up with the exact id that memo names.
    const receiptId = `rcp_${toHex(randomBytes(16))}`; // same shape as createAtlasFetch: parseReceiptMemo only accepts rcp_ + 32 lowercase hex
    let txSignature = syntheticTxSignature();
    let devnetFallbackReason: string | null = null;
    if (settle) {
      try {
        onchain = await settle(offer, receiptId);
        txSignature = onchain.txSignature;
      } catch (error) {
        devnetFallbackReason = `Devnet settlement failed (${error instanceof Error ? error.message : String(error)}) — this payment is shown without a real on-chain transfer.`;
      }
    }
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
        id: receiptId,
        mandate,
        decision: signed,
        settlement: { txSignature, network: SOLANA_DEVNET_CAIP2, payer: mandate.agent.publicKey, settledAt: context.now, slot: null },
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
      ...(devnetFallbackReason ? { devnetFallbackReason } : {}),
    };
  }

  return {
    world: nextWorld,
    outcome: {
      verdict: gate.decision,
      headline: headlineFor(gate, display),
      amountUsd: formatUsd(offer.amount, DEMO_MINT_DECIMALS),
      resourceUrl: offer.resourceUrl,
      payTo: offer.payTo,
      rules: displayRules(gate),
      gate,
      receipt,
      onchain,
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

/** Step 3 (A normal payment). `settle`, when given, is tried for real on Solana devnet. */
export async function payNormal(world: World, settle?: SettleFn) {
  const offer = baseOffer(world, {});
  return evaluateAndMaybeReceipt(world, offer, baseContext(world), 'normal', settle);
}

/** Step 4 (An attack): prompt-injected agent tries to pay a stranger for an invented "invoice". Always
 * denied by design, so `settle` is never invoked — no need to accept one. */
export async function attack(world: World) {
  const offer = baseOffer(world, {
    payTo: world.keys.attacker.publicKey,
    amount: ATTACK_AMOUNT,
    resourceUrl: `${ATTACKER_ORIGIN}/invoice`,
  });
  return evaluateAndMaybeReceipt(world, offer, baseContext(world), 'attack');
}

/** Step 5a: the approved seller raises its price moderately — above tolerance, within the hard max.
 * Escalates rather than settling, so `settle` is never invoked here either. */
export async function priceSpikeModerate(world: World) {
  const offer = baseOffer(world, { amount: MODERATE_SPIKE_AMOUNT });
  return evaluateAndMaybeReceipt(world, offer, baseContext(world), 'spike-moderate');
}

/** Step 5b: a 5x spike, above the hard maximum — always denied, no human can override it. */
export async function priceSpikeSevere(world: World) {
  const offer = baseOffer(world, { amount: SEVERE_SPIKE_AMOUNT });
  return evaluateAndMaybeReceipt(world, offer, baseContext(world), 'spike-severe');
}

/** Step 6 (You are the human): approve or reject the moderate price-spike payment from step 5a.
 * `settle`, when given, is tried for real on Solana devnet (approval only; a rejection never pays). */
export async function humanDecision(world: World, approve: boolean, settle?: SettleFn) {
  const offer = baseOffer(world, { amount: MODERATE_SPIKE_AMOUNT });
  const approval: GateApproval = {
    id: `apr_${randomId()}`,
    offerHash: hashOffer(offer),
    status: approve ? 'APPROVED' : 'DENIED',
    expiresAt: world.now + 900,
    approver: { userId: 'visitor', role: 'APPROVER' },
  };
  return evaluateAndMaybeReceipt(world, offer, baseContext(world, { approval }), 'approval', settle);
}

/** Step 8 (Revoke): the owner revokes the mandate, then the agent tries one more payment. */
export function revokeMandate(world: World, reason: string): World {
  return { ...world, revoked: { revokedAt: world.now, reason } };
}

/** The payment after revocation is always denied by design, so `settle` is never invoked. */
export async function payAfterRevoke(world: World) {
  const offer = baseOffer(world, {});
  return evaluateAndMaybeReceipt(world, offer, baseContext(world), 'normal');
}

/** Real on-chain anchoring for step 7 (devnet mode only): the `anchor_root` transaction that was
 * actually sent, plus the mandate registry program id, so `verifyReceipt` can check it for real. */
export interface OnchainAnchor {
  action: OnchainAction;
  seq: number;
  chain: ChainClient;
  programId: string;
}

/** Step 7 (Prove): anchor the receipt into a (single-leaf, in-memory) Merkle batch, then verify it
 * the same way `atlas verify` does. `onchain`, when given, means this batch was actually anchored via
 * a real `anchor_root` call on Solana devnet — the receipt and the verification both reflect that
 * instead of a synthetic signature, and ANCHOR_ONCHAIN/SETTLEMENT_ONCHAIN are checked for real rather
 * than skipped. */
export async function proveReceipt(
  world: World,
  receiptId: string,
  onchain?: OnchainAnchor | null,
): Promise<{ receipt: BoundReceipt; verification: ReceiptVerification }> {
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
      txSignature: onchain?.action.txSignature ?? syntheticTxSignature(),
      network: SOLANA_DEVNET_CAIP2,
      anchoredAt: world.now,
      signer: world.keys.instance.publicKey,
      ...(onchain ? { mechanism: 'root' as const, seq: onchain.seq } : {}),
    },
  };
  const verification = await verifyReceipt(anchored, {
    trustedInstanceKeys: [world.keys.instance.publicKey],
    ...(onchain ? { chain: onchain.chain, checkSettlementOnChain: true, requireAnchor: true, programId: onchain.programId } : {}),
  });
  return { receipt: anchored, verification };
}
