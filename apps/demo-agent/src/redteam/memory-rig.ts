import { buildExactPaymentTransaction } from '@atlas-rail/solana';
import { TEST_MINT, TEST_ORIGIN, WORLD_ORG, createWorld, testOffer } from '@atlas-rail/receipt/testing';
import { GatedSignerAdapter } from '@atlas-rail/x402';
import type { Rig } from './harness';

/** The real gate service, lifecycle and gated signer, on the in-memory Solana cluster. */
export async function memoryRig(mandateOptions: Record<string, unknown> = {}): Promise<Rig> {
  const world = await createWorld({ mandate: mandateOptions });
  const { agent, merchant, attacker, facilitator, instance } = world.keys;
  const signer = new GatedSignerAdapter({ inner: agent, trustedInstanceKeys: [instance.publicKey], clock: () => world.clock.now });
  return {
    label: 'in-memory',
    mint: TEST_MINT,
    merchant: merchant.publicKey,
    attacker: attacker.publicKey,
    agent: agent.publicKey,
    facilitatorKey: facilitator.publicKey,
    attackerSigner: attacker,
    agentRawSigner: agent,
    resource: (path) => `${TEST_ORIGIN}${path}`,
    signer,
    offer: (overrides = {}) => testOffer({ payTo: merchant.publicKey, feePayer: facilitator.publicKey, ...overrides }),
    async buildTx(p) {
      const { blockhash } = await world.chain.getLatestBlockhash();
      const tx = buildExactPaymentTransaction({
        payer: agent.publicKey,
        feePayer: p.feePayer ?? facilitator.publicKey,
        mint: p.mint ?? TEST_MINT,
        decimals: 6,
        payTo: p.payTo,
        amountBaseUnits: p.amount,
        recentBlockhash: blockhash,
        memo: p.memo ?? null,
      });
      return Buffer.from(tx.serialize()).toString('base64');
    },
    evaluate: (request) => world.gate.evaluate(WORLD_ORG, request),
    mandateId: world.mandate.id,
    now: () => world.clock.now,
    advance: (seconds) => world.clock.advance(seconds),
    balance: async (owner) => world.chain.tokenBalance(owner, TEST_MINT),
    async submit(agentSigned) {
      const both = await facilitator.signTransaction(agentSigned);
      return world.chain.sendAndConfirm(both.signedBase64);
    },
    async revoke() {
      await world.lifecycle.revoke(WORLD_ORG, world.mandate.id, { userId: 'usr_owner', reason: 'red team' });
    },
    async decideApproval(approvalId, approve) {
      await world.lifecycle.decideApproval(WORLD_ORG, approvalId, { approve, approver: { userId: 'usr_approver', role: 'APPROVER' }, comment: null });
    },
  };
}
