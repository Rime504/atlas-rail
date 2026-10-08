import { readFileSync } from 'fs';
import { join } from 'path';
import { AgentGateService, InMemoryAgentStore, MandateLifecycleService } from '@atlas-rail/mandate';
import { TEST_ORIGIN, testOffer, unsignedTestMandate } from '@atlas-rail/mandate/testing';
import { ChainPaymentSimulator, DevnetKeyring, DevnetKeypairSigner, Web3ChainClient, buildExactPaymentTransaction } from '@atlas-rail/solana';
import { GatedSignerAdapter } from '@atlas-rail/x402';
import type { Rig } from './harness';

const ORG = 'org_redteam';

function freshSigner(): DevnetKeypairSigner {
  const seed = new Uint8Array(32);
  globalThis.crypto.getRandomValues(seed);
  return new DevnetKeypairSigner(seed);
}

/**
 * Same gate service and gated signer as the in-memory rig, but every simulation, settlement and
 * balance read goes to real Solana devnet. Uses the demo keyring (`pnpm demo` creates and funds it):
 * its agent holds demo USDC and its facilitator pays fees. Owner and approver are throwaway keys —
 * they only sign the mandate.
 */
export async function devnetRig(mandateOptions: Record<string, unknown> = {}, root = process.cwd()): Promise<Rig> {
  process.env.ATLAS_ALLOW_MOCK_SIGNER ??= 'true';
  const keyring = DevnetKeyring.load(join(root, '.demo', 'keyring.json'));
  const state = JSON.parse(readFileSync(join(root, '.demo', 'state.json'), 'utf8')) as { mint: string; decimals: number };
  const chain = Web3ChainClient.fromUrl(process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com');
  const agent = keyring.signer('agent');
  const facilitator = keyring.signer('facilitator');
  const merchant = keyring.signer('merchant');
  const instance = keyring.signer('instance');
  const attacker = freshSigner();
  const now = () => Math.floor(Date.now() / 1000);
  let counter = 0;
  const newId = (prefix: string) => `${prefix}_RT${now().toString(36).toUpperCase()}${String(++counter).padStart(6, '0')}`;

  const store = new InMemoryAgentStore();
  const gate = new AgentGateService({ store, instanceSigner: instance, simulator: new ChainPaymentSimulator(chain), clock: now, newId });
  const lifecycle = new MandateLifecycleService({ store, clock: now });
  const base = unsignedTestMandate(mandateOptions);
  const draft = await lifecycle.createDraft(ORG, 'usr_owner', {
    issuer: base.issuer,
    agent: { publicKey: agent.publicKey, label: 'Research Agent' },
    scope: {
      ...base.scope,
      allowedAssets: [state.mint],
      allowedPayTo: [merchant.publicKey],
      limits: { ...base.scope.limits, mint: state.mint },
    },
    escalation: base.escalation,
    notBefore: now() - 3_600,
    expiresAt: now() + 3 * 86_400,
  });
  await lifecycle.sign(ORG, draft.mandate.id, { role: 'OWNER', signer: freshSigner(), userId: 'usr_owner' });
  await lifecycle.sign(ORG, draft.mandate.id, { role: 'APPROVER', signer: freshSigner(), userId: 'usr_approver' });
  const active = await lifecycle.sign(ORG, draft.mandate.id, { role: 'AGENT', signer: agent, userId: null });

  return {
    label: 'devnet',
    mint: state.mint,
    merchant: merchant.publicKey,
    attacker: attacker.publicKey,
    agent: agent.publicKey,
    facilitatorKey: facilitator.publicKey,
    attackerSigner: attacker,
    agentRawSigner: agent,
    resource: (path) => `${TEST_ORIGIN}${path}`,
    signer: new GatedSignerAdapter({ inner: agent, trustedInstanceKeys: [instance.publicKey], clock: now }),
    offer: (overrides = {}) => testOffer({ asset: state.mint, payTo: merchant.publicKey, feePayer: facilitator.publicKey, ...overrides }),
    async buildTx(p) {
      const { blockhash } = await chain.getLatestBlockhash();
      const tx = buildExactPaymentTransaction({
        payer: agent.publicKey,
        feePayer: p.feePayer ?? facilitator.publicKey,
        mint: p.mint ?? state.mint,
        decimals: state.decimals,
        payTo: p.payTo,
        amountBaseUnits: p.amount,
        recentBlockhash: blockhash,
        memo: p.memo ?? null,
      });
      return Buffer.from(tx.serialize()).toString('base64');
    },
    evaluate: (request) => gate.evaluate(ORG, request),
    mandateId: active.mandate.id,
    now,
    balance: (owner) => chain.getTokenBalance(owner, state.mint),
    async submit(agentSigned) {
      const both = await facilitator.signTransaction(agentSigned);
      return chain.sendAndConfirm(both.signedBase64);
    },
    async revoke() {
      await lifecycle.revoke(ORG, active.mandate.id, { userId: 'usr_owner', reason: 'red team' });
    },
    async decideApproval(approvalId, approve) {
      await lifecycle.decideApproval(ORG, approvalId, { approve, approver: { userId: 'usr_approver', role: 'APPROVER' }, comment: null });
    },
  };
}
