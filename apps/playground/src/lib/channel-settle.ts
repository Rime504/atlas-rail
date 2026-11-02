import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519';
import { encodeVoucherMessage } from '@atlas-rail/x402';
import { INSTRUCTIONS_SYSVAR, PAYMENT_PROGRAM_ID, citeMandateOnSignatureCheck } from 'atlasrails/channel';

const ED25519_PROGRAM_ID = new PublicKey('Ed25519SigVerify111111111111111111111111111');

/** How long a voucher may live; the browser signs it, so the server bounds what it accepts back. */
export const VOUCHER_TTL_SECONDS = 600;
const CLOCK_SKEW_SECONDS = 60;

export function voucherMessage(channel: string, amount: bigint, expiresAt: bigint): Uint8Array {
  return encodeVoucherMessage({ channelId: channel, cumulativeAmount: amount, expiresAt });
}

/** The expiry the browser sends back must still be live and no later than the server would have chosen. */
export function voucherExpiryOk(expiresAt: bigint, now: number): boolean {
  return expiresAt > BigInt(now) && expiresAt <= BigInt(now + VOUCHER_TTL_SECONDS + CLOCK_SKEW_SECONDS);
}

/** The agent key never reaches the server: the browser signs the voucher, the server checks it against the mandate's agent. */
export function voucherSignatureOk(agent: string, message: Uint8Array, signature: Uint8Array): boolean {
  if (signature.length !== 64) return false;
  try {
    return ed25519.verify(signature, message, new PublicKey(agent).toBytes());
  } catch {
    return false;
  }
}

export function ed25519Instruction(pubkey: Uint8Array, signature: Uint8Array, message: Uint8Array): TransactionInstruction {
  const pubkeyOffset = 16;
  const signatureOffset = 48;
  const messageOffset = 112;
  const data = Buffer.alloc(messageOffset + message.length);
  data[0] = 1;
  data.writeUInt16LE(signatureOffset, 2);
  data.writeUInt16LE(0xffff, 4);
  data.writeUInt16LE(pubkeyOffset, 6);
  data.writeUInt16LE(0xffff, 8);
  data.writeUInt16LE(messageOffset, 10);
  data.writeUInt16LE(message.length, 12);
  data.writeUInt16LE(0xffff, 14);
  Buffer.from(pubkey).copy(data, pubkeyOffset);
  Buffer.from(signature).copy(data, signatureOffset);
  Buffer.from(message).copy(data, messageOffset);
  return new TransactionInstruction({ programId: ED25519_PROGRAM_ID, keys: [], data });
}

/**
 * Signature check, then settle. The mandate is cited on the signature check, never on settle: the
 * payment-channels program takes exactly two accounts on settle and fails a third.
 */
export function buildSettleTransaction(input: {
  agent: string;
  signature: Uint8Array;
  message: Uint8Array;
  channel: string;
  mandatePda: string;
  payer: string;
  blockhash: string;
}): Transaction {
  const check = citeMandateOnSignatureCheck(
    ed25519Instruction(new PublicKey(input.agent).toBytes(), input.signature, input.message),
    new PublicKey(input.mandatePda),
  );
  const settle = new TransactionInstruction({
    programId: PAYMENT_PROGRAM_ID,
    keys: [
      { pubkey: new PublicKey(input.channel), isSigner: false, isWritable: true },
      { pubkey: INSTRUCTIONS_SYSVAR, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([2]),
  });
  const tx = new Transaction().add(check, settle);
  tx.feePayer = new PublicKey(input.payer);
  tx.recentBlockhash = input.blockhash;
  return tx;
}
