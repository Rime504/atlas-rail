/**
 * Concurrency proof: N payments fired at the gate at the same instant against a hard cap. The bug
 * this guards against is the classic check-then-record race (read "spent so far", decide, record) —
 * two requests that both read "$4.90 spent" can both be allowed a $0.10 payment against a $5 cap
 * unless the decision and the reservation happen under one lock. Runs through the real
 * AgentGateService with whichever AgentStore it is given, then signs and settles every ALLOW through
 * the gated signer and measures what actually left the wallet.
 */
import { AgentGateService, AgentStore, InMemoryAgentStore, MandateLifecycleService, signGateRequest } from '@atlas-rail/mandate';
import { NOW, TEST_MINT, testOffer, unsignedTestMandate } from '@atlas-rail/mandate/testing';
import { ChainPaymentSimulator, DevnetKeypairSigner, buildExactPaymentTransaction } from '@atlas-rail/solana';
import { FakeChain } from '@atlas-rail/solana/testing';
import { GatedSignerAdapter } from '@atlas-rail/x402';

export interface ConcurrencyResult {
  label: string;
  payments: number;
  amountBaseUnits: bigint;
  capBaseUnits: bigint;
  allowed: number;
  allowedBaseUnits: bigint;
  /** What actually left the agent's wallet after every ALLOW was signed and settled. */
  settledBaseUnits: bigint;
  notAllowed: number;
  rejected: number;
  ms: number;
}

/** Same seed-from-label scheme as the receipt test world, so keys match the shared mandate fixtures. */
function keypairSigner(label: string): DevnetKeypairSigner {
  const seed = new Uint8Array(32);
  const bytes = new TextEncoder().encode(label);
  for (let i = 0; i < bytes.length && i < 32; i++) seed[i] = bytes[i];
  return new DevnetKeypairSigner(seed);
}

export async function runConcurrencyProof(
  store: AgentStore,
  organizationId: string,
  label: string,
  { payments = 100, amountBaseUnits = 100_000n, capBaseUnits = 5_000_000n } = {},
): Promise<ConcurrencyResult> {
  // Same scoped opt-in as the receipt test world: these are worthless fixed-seed devnet keys.
  const previous = process.env.ATLAS_ALLOW_MOCK_SIGNER;
  process.env.ATLAS_ALLOW_MOCK_SIGNER = 'true';
  const keys = { owner: keypairSigner('owner'), approver: keypairSigner('approver'), agent: keypairSigner('agent'), instance: keypairSigner('instance'), merchant: keypairSigner('merchant'), facilitator: keypairSigner('facilitator') };
  if (previous === undefined) delete process.env.ATLAS_ALLOW_MOCK_SIGNER;
  else process.env.ATLAS_ALLOW_MOCK_SIGNER = previous;
  const chain = new FakeChain();
  chain.now = () => NOW;
  chain.createMint(TEST_MINT, 6);
  chain.airdrop(keys.facilitator.publicKey, 1_000_000_000n);
  chain.fundTokens(keys.agent.publicKey, TEST_MINT, 500_000_000n);
  chain.fundTokens(keys.merchant.publicKey, TEST_MINT, 0n);

  const clock = () => NOW;
  let counter = 0;
  const run = Math.random().toString(36).slice(2, 8).toUpperCase();
  const newId = (prefix: string) => `${prefix}_CC${run}${String(++counter).padStart(8, '0')}`;
  const gate = new AgentGateService({ store, instanceSigner: keys.instance, simulator: new ChainPaymentSimulator(chain), clock, newId });
  const lifecycle = new MandateLifecycleService({ store, clock });

  const base = unsignedTestMandate();
  const cap = capBaseUnits.toString();
  const draft = await lifecycle.createDraft(organizationId, 'usr_concurrency', {
    issuer: base.issuer,
    agent: { publicKey: keys.agent.publicKey, label: 'Concurrency Agent' },
    scope: {
      ...base.scope,
      allowedPayTo: [keys.merchant.publicKey],
      limits: { ...base.scope.limits, maxPerPayment: '1000000', maxPerWindow: cap, maxTotal: cap },
    },
    escalation: { ...base.escalation, thresholdBaseUnits: '1000000' },
    notBefore: base.notBefore,
    expiresAt: base.expiresAt,
  });
  await lifecycle.sign(organizationId, draft.mandate.id, { role: 'OWNER', signer: keys.owner, userId: 'usr_owner' });
  await lifecycle.sign(organizationId, draft.mandate.id, { role: 'APPROVER', signer: keys.approver, userId: 'usr_approver' });
  const active = await lifecycle.sign(organizationId, draft.mandate.id, { role: 'AGENT', signer: keys.agent, userId: null });

  const { blockhash } = await chain.getLatestBlockhash();
  const offer = testOffer({ payTo: keys.merchant.publicKey, feePayer: keys.facilitator.publicKey, amount: amountBaseUnits.toString() });
  const requests = await Promise.all(
    Array.from({ length: payments }, async (_, i) => {
      // memo null -> a random nonce, so every transaction (and its message hash) is distinct.
      const tx = Buffer.from(
        buildExactPaymentTransaction({ payer: keys.agent.publicKey, feePayer: keys.facilitator.publicKey, mint: TEST_MINT, decimals: 6, payTo: offer.payTo, amountBaseUnits: offer.amount, recentBlockhash: blockhash, memo: null }).serialize(),
      ).toString('base64');
      const request = await signGateRequest(
        { type: 'atlasrail.gate-request', version: '0.1', mandateId: active.mandate.id, offer, transactionBase64: tx, approvalId: null, nonce: `cc-${run}-${i}`, requestedAt: NOW },
        keys.agent,
      );
      return { tx, request };
    }),
  );

  const started = Date.now();
  // All at once: no awaits between them, so every check-then-record path is genuinely concurrent.
  const outcomes = await Promise.all(requests.map(({ request }) => gate.evaluate(organizationId, request).catch(() => null)));
  const ms = Date.now() - started;

  const signer = new GatedSignerAdapter({ inner: keys.agent, trustedInstanceKeys: [keys.instance.publicKey], clock });
  const before = chain.tokenBalance(keys.agent.publicKey, TEST_MINT);
  let allowed = 0;
  for (let i = 0; i < outcomes.length; i++) {
    const outcome = outcomes[i];
    if (outcome?.decision.record.decision !== 'ALLOW' || !outcome.authorization) continue;
    allowed++;
    const signed = await signer.signWithAuthorization(requests[i].tx, outcome.authorization);
    const both = await keys.facilitator.signTransaction(signed.signedBase64);
    await chain.sendAndConfirm(both.signedBase64);
  }
  const settled = before - chain.tokenBalance(keys.agent.publicKey, TEST_MINT);

  return {
    label,
    payments,
    amountBaseUnits,
    capBaseUnits,
    allowed,
    allowedBaseUnits: BigInt(allowed) * amountBaseUnits,
    settledBaseUnits: settled,
    notAllowed: outcomes.filter((o) => o && o.decision.record.decision !== 'ALLOW').length,
    rejected: outcomes.filter((o) => o === null).length,
    ms,
  };
}

/** The control: the same store with its lock removed. If this does NOT overspend, the test is not sensitive enough to trust. */
export function unlockedMemoryStore(): AgentStore {
  const store = new InMemoryAgentStore();
  store.runExclusive = <T>(_key: string, fn: () => Promise<T>) => fn();
  return store;
}

const usd = (b: bigint) => `$${(Number(b) / 1e6).toFixed(2)}`;

export function renderConcurrency(results: ConcurrencyResult[]): string[] {
  return [
    '## Concurrency: 100 simultaneous payments against a $5 cap',
    '',
    'Each run fires every payment at the real gate service at the same instant ($0.10 each, so at most 50 fit under the cap), then signs and settles every ALLOW through the gated signer and reads what actually left the wallet. The unlocked control removes the store’s per-mandate lock: it must overspend, or this test would not be able to catch the race.',
    '',
    '| Store | Payments | Allowed | Allowed total | Actually settled | Cap | Within cap |',
    '|---|---|---|---|---|---|---|',
    ...results.map(
      (r) => `| ${r.label} | ${r.payments} | ${r.allowed} | ${usd(r.allowedBaseUnits)} | ${usd(r.settledBaseUnits)} | ${usd(r.capBaseUnits)} | ${r.settledBaseUnits <= r.capBaseUnits ? 'yes' : '**NO (overspent)**'} |`,
    ),
  ];
}
