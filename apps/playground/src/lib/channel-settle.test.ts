import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Keypair, PublicKey } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519';
import { describe, expect, it } from 'vitest';
import { INSTRUCTIONS_SYSVAR, PAYMENT_PROGRAM_ID } from 'atlasrails/channel';
import { VOUCHER_TTL_SECONDS, buildSettleTransaction, voucherExpiryOk, voucherMessage, voucherSignatureOk } from './channel-settle';

const agent = Keypair.generate();
const channel = Keypair.generate().publicKey.toBase58();
const mandatePda = Keypair.generate().publicKey.toBase58();
const payer = Keypair.generate().publicKey.toBase58();
const now = 1_800_000_000;
const message = voucherMessage(channel, 20_000n, BigInt(now + 300));
const signature = ed25519.sign(message, agent.secretKey.subarray(0, 32));

describe('playground settle', () => {
  it('passes exactly two accounts to settle and cites the mandate on the signature check', () => {
    const tx = buildSettleTransaction({ agent: agent.publicKey.toBase58(), signature, message, channel, mandatePda, payer, blockhash: '11111111111111111111111111111111' });
    expect(tx.instructions).toHaveLength(2);
    const [check, settle] = tx.instructions;
    expect(check.programId.toBase58()).toBe('Ed25519SigVerify111111111111111111111111111');
    expect(check.keys).toEqual([{ pubkey: new PublicKey(mandatePda), isSigner: false, isWritable: false }]);
    expect(Buffer.from(check.data.subarray(16, 48))).toEqual(Buffer.from(agent.publicKey.toBytes()));
    expect(Buffer.from(check.data.subarray(48, 112))).toEqual(Buffer.from(signature));
    expect(Buffer.from(check.data.subarray(112))).toEqual(Buffer.from(message));
    expect(settle.programId.equals(PAYMENT_PROGRAM_ID)).toBe(true);
    expect(settle.keys.map((k) => k.pubkey.toBase58())).toEqual([channel, INSTRUCTIONS_SYSVAR.toBase58()]);
    expect(settle.keys.some((k) => k.pubkey.toBase58() === mandatePda)).toBe(false);
  });

  it('accepts only the mandate agent signing these exact voucher bytes', () => {
    expect(voucherSignatureOk(agent.publicKey.toBase58(), message, signature)).toBe(true);
    expect(voucherSignatureOk(Keypair.generate().publicKey.toBase58(), message, signature)).toBe(false);
    expect(voucherSignatureOk(agent.publicKey.toBase58(), voucherMessage(channel, 20_001n, BigInt(now + 300)), signature)).toBe(false);
    expect(voucherSignatureOk(agent.publicKey.toBase58(), message, signature.subarray(0, 63))).toBe(false);
  });

  it('bounds the expiry the browser sends back', () => {
    expect(voucherExpiryOk(BigInt(now + 300), now)).toBe(true);
    expect(voucherExpiryOk(BigInt(now), now)).toBe(false);
    expect(voucherExpiryOk(BigInt(now + VOUCHER_TTL_SECONDS + 3600), now)).toBe(false);
  });

  it('never sends the agent key to the server', () => {
    const page = readFileSync(join(__dirname, '../app/mandate/page.tsx'), 'utf8');
    const route = readFileSync(join(__dirname, '../app/api/mandate/channel/route.ts'), 'utf8');
    expect(page).not.toMatch(/agentSecret:\s*Array\.from/);
    expect(page).toContain("action: 'voucher'");
    expect(route).not.toMatch(/Keypair\.fromSecretKey/);
  });
});
