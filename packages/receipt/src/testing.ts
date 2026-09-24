/**
 * A complete hermetic "world" for tests and the offline demo: an in-memory Solana cluster, funded
 * devnet keys, a live signed mandate, the gate/lifecycle/receipt/anchor services wired to in-memory
 * stores, and a controllable clock. Keys are derived from fixed seeds and are worthless.
 */
import {
  AgentGateService,
  GateOutcome,
  InMemoryAgentStore,
  MandateLifecycleService,
  MandateRecord,
  X402Offer,
  signGateRequest,
} from '@atlas-rail/mandate';
import { NOW, TEST_MINT, TEST_ORIGIN, testOffer, unsignedTestMandate } from '@atlas-rail/mandate/testing';
import {
  ChainPaymentSimulator,
  DevnetKeypairSigner,
  buildExactPaymentTransaction,
} from '@atlas-rail/solana';
import { FakeChain } from '@atlas-rail/solana/testing';
import { AnchorService, InMemoryReceiptStore, ReceiptService } from './service';

export const WORLD_ORG = 'org_test';
export { NOW, TEST_MINT, TEST_ORIGIN, testOffer };

function keypairSigner(label: string): DevnetKeypairSigner {
  const seed = new Uint8Array(32);
  const bytes = new TextEncoder().encode(label);
  for (let i = 0; i < bytes.length && i < 32; i++) seed[i] = bytes[i];
  return new DevnetKeypairSigner(seed);
}

export interface World {
  chain: FakeChain;
  store: InMemoryAgentStore;
  receipts: InMemoryReceiptStore;
  gate: AgentGateService;
  lifecycle: MandateLifecycleService;
  receiptService: ReceiptService;
  anchorService: AnchorService;
  keys: Record<'owner' | 'approver' | 'agent' | 'instance' | 'merchant' | 'attacker' | 'facilitator', DevnetKeypairSigner>;
  mandate: MandateRecord['mandate'];
  clock: { now: number; advance(seconds: number): void };
  /** Builds the agent's payment transaction, signs a gate request for it, and asks the gate. */
  requestGate(
    offerOverrides?: Partial<X402Offer>,
    extra?: { approvalId?: string | null; nonce?: string },
  ): Promise<{ outcome: GateOutcome; transactionBase64: string; offer: X402Offer }>;
  /** Agent signs, facilitator co-signs and pays fees, cluster executes. Returns the settlement signature. */
  settle(transactionBase64: string): Promise<string>;
}

export async function createWorld(options: { mandate?: Parameters<typeof unsignedTestMandate>[0] } = {}): Promise<World> {
  const previous = process.env.ATLAS_ALLOW_MOCK_SIGNER;
  process.env.ATLAS_ALLOW_MOCK_SIGNER = 'true';
  const keys = {
    owner: keypairSigner('owner'),
    approver: keypairSigner('approver'),
    agent: keypairSigner('agent'),
    instance: keypairSigner('instance'),
    merchant: keypairSigner('merchant'),
    attacker: keypairSigner('attacker'),
    facilitator: keypairSigner('facilitator'),
  };
  if (previous === undefined) delete process.env.ATLAS_ALLOW_MOCK_SIGNER;
  else process.env.ATLAS_ALLOW_MOCK_SIGNER = previous;

  const clock = {
    now: NOW,
    advance(seconds: number) {
      this.now += seconds;
    },
  };
  const chain = new FakeChain();
  chain.now = () => clock.now;
  chain.createMint(TEST_MINT, 6);
  chain.airdrop(keys.facilitator.publicKey, 1_000_000_000n);
  chain.airdrop(keys.instance.publicKey, 1_000_000_000n);
  chain.fundTokens(keys.agent.publicKey, TEST_MINT, 500_000_000n);
  chain.fundTokens(keys.merchant.publicKey, TEST_MINT, 0n);

  const store = new InMemoryAgentStore();
  const receipts = new InMemoryReceiptStore();
  let counter = 0;
  const newId = (prefix: string) => `${prefix}_${String(++counter).padStart(6, '0')}`;
  const clockFn = () => clock.now;

  const gate = new AgentGateService({
    store,
    instanceSigner: keys.instance,
    simulator: new ChainPaymentSimulator(chain),
    clock: clockFn,
    newId,
  });
  const lifecycle = new MandateLifecycleService({ store, clock: clockFn });
  const receiptService = new ReceiptService({ store, receipts, chain, instanceSigner: keys.instance, clock: clockFn, newId });
  const anchorService = new AnchorService({ receipts, chain, signer: keys.instance, clock: clockFn, newId });

  // The shared mandate fixtures use the same seed labels, so their public keys match `keys`.
  const base = unsignedTestMandate(options.mandate);
  const draft = await lifecycle.createDraft(WORLD_ORG, 'usr_owner', {
    issuer: base.issuer,
    agent: { publicKey: keys.agent.publicKey, label: 'Research Agent' },
    scope: {
      ...base.scope,
      allowedPayTo: [keys.merchant.publicKey],
    },
    escalation: base.escalation,
    notBefore: base.notBefore,
    expiresAt: base.expiresAt,
  });
  await lifecycle.sign(WORLD_ORG, draft.mandate.id, { role: 'OWNER', signer: keys.owner, userId: 'usr_owner' });
  await lifecycle.sign(WORLD_ORG, draft.mandate.id, { role: 'APPROVER', signer: keys.approver, userId: 'usr_approver' });
  const active = await lifecycle.sign(WORLD_ORG, draft.mandate.id, { role: 'AGENT', signer: keys.agent, userId: null });

  let nonceCounter = 0;

  const requestGate: World['requestGate'] = async (offerOverrides = {}, extra = {}) => {
    const offer = testOffer({
      payTo: keys.merchant.publicKey,
      feePayer: keys.facilitator.publicKey,
      ...offerOverrides,
    });
    const { blockhash } = await chain.getLatestBlockhash();
    const tx = buildExactPaymentTransaction({
      payer: keys.agent.publicKey,
      feePayer: keys.facilitator.publicKey,
      mint: offer.asset,
      decimals: 6,
      payTo: offer.payTo,
      amountBaseUnits: offer.amount,
      recentBlockhash: blockhash,
      memo: offer.memo,
    });
    const transactionBase64 = Buffer.from(tx.serialize()).toString('base64');
    const request = await signGateRequest(
      {
        type: 'atlasrail.gate-request',
        version: '0.1',
        mandateId: active.mandate.id,
        offer,
        transactionBase64,
        approvalId: extra.approvalId ?? null,
        nonce: extra.nonce ?? `nonce-${++nonceCounter}`,
        requestedAt: clock.now,
      },
      keys.agent,
    );
    return { outcome: await gate.evaluate(WORLD_ORG, request), transactionBase64, offer };
  };

  const settle: World['settle'] = async (transactionBase64) => {
    const agentSigned = await keys.agent.signTransaction(transactionBase64);
    const bothSigned = await keys.facilitator.signTransaction(agentSigned.signedBase64);
    return chain.sendAndConfirm(bothSigned.signedBase64);
  };

  return { chain, store, receipts, gate, lifecycle, receiptService, anchorService, keys, mandate: active.mandate, clock, requestGate, settle };
}
