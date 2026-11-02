import { describe, expect, it } from 'vitest';
import { Keypair, PublicKey, TransactionInstruction, TransactionMessage } from '@solana/web3.js';
import { createMandate, signMandate, SOLANA_DEVNET_CAIP2 } from '@atlas-rail/mandate';
import {
  assertGraceSeconds,
  buildRequestCloseInstruction,
  buildSealInstruction,
  buildSettleAndSealInstruction,
  citeMandateOnSignatureCheck,
  INSTRUCTIONS_SYSVAR,
  PAYMENT_PROGRAM_ID,
  buildCloseEscrowInstruction,
  buildReclaimInstruction,
  buildWithdrawPayerInstruction,
  assertFacilitatorGrace,
  readCloseState,
  refundPlan,
  revokeChannelStep,
  revokeSettleBlock,
} from './channel-flow';
import { askWithAgent } from './local-voucher';

function seed(label: string): Keypair {
  const bytes = new Uint8Array(32);
  const name = new TextEncoder().encode(label);
  for (let i = 0; i < name.length && i < 32; i += 1) bytes[i] = name[i]!;
  return Keypair.fromSeed(bytes);
}

describe('channel grace and refund plan', () => {
  it('rejects a zero grace and keeps a positive one', () => {
    expect(() => assertGraceSeconds(0)).toThrow(/positive/);
    expect(() => assertGraceSeconds(1.5)).toThrow(/positive/);
    expect(() => assertGraceSeconds(1)).not.toThrow();
  });

  it('returns the remainder immediately only when the payee can sign', () => {
    const open = { status: 0, deposit: 10_000n, settled: 1000n, closureStartedAt: 0n, payerWithdrawnAt: 0n, gracePeriod: 1, payer: 'p', payee: 'e', mint: 'm', rentPayer: 'p', openSlot: 0n };
    expect(refundPlan(open, 10n, true).steps).toEqual(['settle_and_seal', 'withdraw', 'close_escrow']);
    expect(refundPlan(open, 10n, false).steps).toEqual(['request_close']);
    const closing = { ...open, status: 2, closureStartedAt: 100n, gracePeriod: 3600 };
    expect(refundPlan(closing, 100n, false).ready).toBe(false);
    expect(refundPlan(closing, 3700n, false).steps).toEqual(['seal', 'withdraw', 'close_escrow']);
    const drained = { ...open, status: 3, payerWithdrawnAt: 1n, openSlot: 100n };
    expect(refundPlan(drained, 10n, false, 100n).ready).toBe(false);
    expect(refundPlan(drained, 10n, false, 100n).reclaimAfterSlot).toBe(1600n);
    expect(refundPlan(drained, 10n, false, 1601n).steps).toEqual(['reclaim']);
  });

  it('blocks a normal settle once revoke closes the channel', () => {
    expect(revokeSettleBlock({ status: 0, payer: 'payer' }, 'payer')).toBe('close');
    expect(revokeSettleBlock({ status: 2, payer: 'payer' }, 'payer')).toBe('blocked');
    expect(revokeSettleBlock({ status: 1, payer: 'payer' }, 'payer')).toBe('blocked');
    expect(revokeSettleBlock({ status: 0, payer: 'payer' }, 'other')).toBe('payer-mismatch');
    const open = { status: 0, payer: 'payer', payee: 'payee' };
    expect(revokeChannelStep(open, 'payer', 'payee')).toBe('seal_now');
    expect(revokeChannelStep({ ...open, status: 2 }, 'payer', 'payee')).toBe('seal_now');
    expect(revokeChannelStep(open, 'payer', null)).toBe('close');
    expect(revokeChannelStep(open, 'payer', 'other')).toBe('payee-mismatch');
    expect(() => assertFacilitatorGrace(1)).toThrow(/900/);
    expect(() => assertFacilitatorGrace(900)).not.toThrow();
  });

  it('uses the payment program discriminators', () => {
    const payer = Keypair.generate().publicKey;
    const channel = Keypair.generate().publicKey;
    const payee = Keypair.generate().publicKey;
    expect(buildSettleAndSealInstruction(payee, channel).data[0]).toBe(4);
    expect(buildRequestCloseInstruction(payer, channel).data[0]).toBe(5);
    expect(buildSealInstruction(channel).data[0]).toBe(6);
    expect(buildWithdrawPayerInstruction({
      payer,
      channel,
      escrow: Keypair.generate().publicKey,
      payerAta: Keypair.generate().publicKey,
      mint: Keypair.generate().publicKey,
    }).data[0]).toBe(8);
    expect(buildReclaimInstruction(channel, payer).data[0]).toBe(9);
    expect(buildReclaimInstruction(channel, payer).keys).toHaveLength(2);
    expect(buildCloseEscrowInstruction({
      channel,
      payer,
      rentPayer: payer,
      escrow: Keypair.generate().publicKey,
      payerAta: Keypair.generate().publicKey,
      payeeAta: Keypair.generate().publicKey,
      treasuryAta: Keypair.generate().publicKey,
      mint: Keypair.generate().publicKey,
      eventAuthority: Keypair.generate().publicKey,
    }).data).toEqual(Buffer.from([7, 0, 0, 0, 0]));
    const raw = Buffer.alloc(256);
    raw[3] = 2;
    raw.writeBigUInt64LE(10_000n, 12);
    raw.writeUInt32LE(1, 52);
    expect(readCloseState(raw)).toMatchObject({ status: 2, deposit: 10_000n, gracePeriod: 1 });
  });
});

describe('in-process agent vouchers', () => {
  it('signs under the cap and refuses over it without the HTTP API', async () => {
    const owner = seed('owner-gap');
    const approver = seed('approver-gap');
    const agent = seed('agent-gap');
    const gate = seed('gate-gap');
    const payee = Keypair.generate().publicKey.toBase58();
    const now = Math.floor(Date.now() / 1000);
    let mandate = createMandate({
      id: 'mnd_GAPTEST0000000000001',
      nonce: '00112233445566778899aabbccddeeff',
      issuer: { organizationId: 'org_gap', name: 'Gap' },
      agent: { publicKey: agent.publicKey.toBase58(), label: 'Agent' },
      delegation: { requiredApprovals: 1 },
      scope: {
        allowedNetworks: [SOLANA_DEVNET_CAIP2],
        allowedAssets: ['4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'],
        allowedPayTo: [payee],
        allowedResources: ['http://localhost/research'],
        limits: { mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', maxPerPayment: '1000', maxPerWindow: '10000', windowSeconds: 3600, maxTotal: '10000' },
        priceLimits: [],
      },
      escalation: { thresholdBaseUnits: '1000', approverRoles: ['OWNER', 'APPROVER'], resources: [], approvalTtlSeconds: 600 },
      notBefore: now - 60,
      expiresAt: now + 86_400,
    });
    const sign = async (role: 'OWNER' | 'APPROVER' | 'AGENT', key: Keypair) => {
      const { messageSigner } = await import('./local-voucher');
      mandate = await signMandate(mandate, { role, signer: messageSigner(key, role) });
    };
    await sign('OWNER', owner);
    await sign('APPROVER', approver);
    await sign('AGENT', agent);
    const fields = {
      mandate,
      agent,
      gate,
      channelId: Keypair.generate().publicKey.toBase58(),
      expiresAt: now + 600,
      recipient: payee,
      resourceUrl: 'http://localhost/research',
      asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
      network: SOLANA_DEVNET_CAIP2,
      feePayer: owner.publicKey.toBase58(),
      settled: 0n,
    };
    const above = await askWithAgent({ ...fields, cumulativeAmount: '1001' });
    const below = await askWithAgent({ ...fields, cumulativeAmount: '500' });
    expect(above.signed).toBe(false);
    expect(below.signed).toBe(true);
    expect(below.deltaAmount).toBe('500');
  });
});

describe('citeMandateOnSignatureCheck', () => {
  it('adds the mandate read-only to the signature check, leaves settle at two accounts, and adds no instruction', () => {
    const payer = Keypair.generate().publicKey;
    const channel = Keypair.generate().publicKey;
    const mandate = Keypair.generate().publicKey;
    const settle = new TransactionInstruction({
      programId: PAYMENT_PROGRAM_ID,
      keys: [
        { pubkey: channel, isSigner: false, isWritable: true },
        { pubkey: INSTRUCTIONS_SYSVAR, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([2]),
    });
    const verify = citeMandateOnSignatureCheck(
      new TransactionInstruction({ programId: new PublicKey('Ed25519SigVerify111111111111111111111111111'), keys: [], data: Buffer.alloc(0) }),
      mandate,
    );
    expect(verify.keys).toHaveLength(1);
    expect(verify.keys[0]).toMatchObject({ isSigner: false, isWritable: false });
    expect(verify.keys[0]?.pubkey.toBase58()).toBe(mandate.toBase58());
    expect(settle.keys).toHaveLength(2);
    const message = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: '11111111111111111111111111111111',
      instructions: [verify, settle],
    }).compileToV0Message();
    const index = message.staticAccountKeys.findIndex((key) => key.equals(mandate));
    expect(message.compiledInstructions).toHaveLength(2);
    expect(message.isAccountSigner(index)).toBe(false);
    expect(message.isAccountWritable(index)).toBe(false);
  });
});
