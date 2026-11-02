import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { isMandateAccountActive, loadMandateAccount, DEFAULT_MANDATE_PROGRAM_ID } from '@atlas-rail/solana';
import { prepareChannelOpen } from 'atlasrails/fund';
import {
  PAYMENT_PROGRAM_ID,
  assertFacilitatorGrace,
  buildSettleAndSealInstruction,
  buildWithdrawPayerInstruction,
  readCloseState,
} from 'atlasrails/channel';
import { VOUCHER_TTL_SECONDS, buildSettleTransaction, voucherExpiryOk, voucherMessage, voucherSignatureOk } from '@/lib/channel-settle';

export const runtime = 'nodejs';

const RPC = process.env.PLAYGROUND_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
const TREASURY_OWNER = new PublicKey('4zTeC5mVqWLruDexgU2mV66p9t5vCA9JyiZqdGDUspap');
function unsigned(tx: Transaction): string {
  return Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString('base64');
}

function distributeInstruction(input: {
  channel: PublicKey;
  payer: PublicKey;
  escrow: PublicKey;
  payerAta: PublicKey;
  payeeAta: PublicKey;
  treasuryAta: PublicKey;
  mint: PublicKey;
}): TransactionInstruction {
  const [eventAuthority] = PublicKey.findProgramAddressSync([Buffer.from('event_authority')], PAYMENT_PROGRAM_ID);
  const data = Buffer.alloc(5);
  data.writeUInt8(7, 0);
  return new TransactionInstruction({
    programId: PAYMENT_PROGRAM_ID,
    keys: [
      { pubkey: input.channel, isSigner: false, isWritable: true },
      { pubkey: input.payer, isSigner: false, isWritable: true },
      { pubkey: input.payer, isSigner: false, isWritable: true },
      { pubkey: input.escrow, isSigner: false, isWritable: true },
      { pubkey: input.payerAta, isSigner: false, isWritable: true },
      { pubkey: input.payeeAta, isSigner: false, isWritable: true },
      { pubkey: input.treasuryAta, isSigner: false, isWritable: true },
      { pubkey: input.mint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: PAYMENT_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    action: 'open' | 'voucher' | 'pay' | 'seal';
    owner?: string;
    payee?: string;
    agent?: string;
    /** Base64 Ed25519 signature by the mandate's agent over the bytes the voucher step returned. */
    voucherSignature?: string;
    expiresAt?: string;
    mint?: string;
    deposit?: string;
    graceSeconds?: number;
    salt?: string;
    mandatePda?: string;
    channel?: string;
    amount?: string;
    recipient?: string;
    allowedRecipients?: string[];
  };
  const connection = new Connection(RPC, 'confirmed');
  try {
    if ((await connection.getGenesisHash()) !== 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG') {
      return NextResponse.json({ error: 'RPC is not Solana Devnet' }, { status: 400 });
    }
    const { blockhash } = await connection.getLatestBlockhash('confirmed');

    if (body.action === 'open') {
      const graceSeconds = Number(body.graceSeconds);
      assertFacilitatorGrace(graceSeconds);
      if (!body.owner || !body.payee || !body.agent || !body.mint || !body.deposit) {
        return NextResponse.json({ error: 'owner, payee, agent, mint, and deposit are required' }, { status: 400 });
      }
      const mint = new PublicKey(body.mint);
      const owner = new PublicKey(body.owner);
      const payee = new PublicKey(body.payee);
      const prepared = await prepareChannelOpen({
        connection,
        payer: { publicKey: owner },
        wallet: { publicKey: body.owner },
        recipient: { publicKey: payee },
        mint,
        agent: { publicKey: body.agent },
        depositAmount: BigInt(body.deposit),
        payerAta: { address: getAssociatedTokenAddressSync(mint, owner) },
        payment: { salt: BigInt(body.salt ?? Date.now()), graceSeconds },
      });
      const missing = [];
      for (const [ata, holder] of [
        [getAssociatedTokenAddressSync(mint, owner), owner],
        [getAssociatedTokenAddressSync(mint, payee), payee],
        [getAssociatedTokenAddressSync(mint, TREASURY_OWNER), TREASURY_OWNER],
      ] as const) {
        if (!(await connection.getAccountInfo(ata, 'confirmed'))) {
          missing.push(createAssociatedTokenAccountIdempotentInstruction(owner, ata, holder, mint));
        }
      }
      prepared.transaction.instructions.splice(2, 0, ...missing);
      return NextResponse.json({
        transaction: unsigned(prepared.transaction),
        channel: prepared.channel,
        escrow: prepared.channelAta,
        graceSeconds,
      });
    }

    if (body.action === 'seal') {
      if (!body.owner || !body.channel || !body.payee) {
        return NextResponse.json({ error: 'owner, channel, and payee are required' }, { status: 400 });
      }
      const info = await connection.getAccountInfo(new PublicKey(body.channel), 'confirmed');
      if (!info || !info.owner.equals(PAYMENT_PROGRAM_ID)) {
        return NextResponse.json({ error: 'Channel is missing' }, { status: 400 });
      }
      const state = readCloseState(info.data);
      if (state.payee !== body.payee) return NextResponse.json({ error: 'Payee does not match the channel' }, { status: 400 });
      if (state.payer !== body.owner) return NextResponse.json({ error: 'Owner is not the channel payer' }, { status: 400 });
      if (state.status !== 0 && state.status !== 2) {
        return NextResponse.json({ error: 'Channel is already sealed' }, { status: 400 });
      }
      const payer = new PublicKey(body.owner);
      const channel = new PublicKey(body.channel);
      const mint = new PublicKey(state.mint);
      const escrow = getAssociatedTokenAddressSync(mint, channel, true);
      const payerAta = getAssociatedTokenAddressSync(mint, payer);
      const seal = new Transaction().add(buildSettleAndSealInstruction(new PublicKey(body.payee), channel));
      seal.feePayer = payer;
      seal.recentBlockhash = blockhash;
      const withdraw = new Transaction().add(buildWithdrawPayerInstruction({ payer, channel, escrow, payerAta, mint }));
      withdraw.feePayer = payer;
      withdraw.recentBlockhash = blockhash;
      return NextResponse.json({ seal: unsigned(seal), withdraw: unsigned(withdraw) });
    }

    if ('agentSecret' in body) {
      return NextResponse.json({ error: 'Send the voucher signature, not the agent key. The agent key stays in the browser.' }, { status: 400 });
    }
    if (body.action !== 'voucher' && body.action !== 'pay') {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
    if (!body.mandatePda || !body.channel || !body.amount || !body.recipient || !body.owner) {
      return NextResponse.json({ error: 'mandate, channel, amount, recipient, and owner are required' }, { status: 400 });
    }
    const account = await loadMandateAccount(connection, body.mandatePda, DEFAULT_MANDATE_PROGRAM_ID);
    if (account.revoked || !isMandateAccountActive(account)) {
      return NextResponse.json({ error: 'Mandate is revoked or inactive' }, { status: 400 });
    }
    const amount = BigInt(body.amount);
    if (amount <= 0n || amount > account.maxPerPayment || amount > account.maxTotal) {
      return NextResponse.json({ error: 'Amount is outside the mandate cap' }, { status: 400 });
    }
    const allowed = body.allowedRecipients ?? [];
    if (!allowed.includes(body.recipient)) {
      return NextResponse.json({ error: 'Recipient is not in the mandate allow list' }, { status: 400 });
    }
    const channelInfo = await connection.getAccountInfo(new PublicKey(body.channel), 'confirmed');
    if (!channelInfo) return NextResponse.json({ error: 'Channel is missing' }, { status: 400 });
    const state = readCloseState(channelInfo.data);
    if (state.status !== 0) return NextResponse.json({ error: 'Channel is not open' }, { status: 400 });
    if (amount <= state.settled || amount - state.settled > account.maxPerPayment) {
      return NextResponse.json({ error: 'Amount is not above the settled watermark within the per-payment cap' }, { status: 400 });
    }
    if (amount > account.maxTotal) return NextResponse.json({ error: 'Amount exceeds the lifetime cap' }, { status: 400 });
    const now = Math.floor(Date.now() / 1000);
    if (body.action === 'voucher') {
      // The checks above passed: hand the browser the exact bytes to sign with the agent key it holds.
      const expiresAt = BigInt(now + VOUCHER_TTL_SECONDS);
      const message = voucherMessage(body.channel, amount, expiresAt);
      return NextResponse.json({ message: Buffer.from(message).toString('base64'), expiresAt: expiresAt.toString(), agent: account.agent });
    }
    if (!body.voucherSignature || !body.expiresAt) {
      return NextResponse.json({ error: 'voucher signature and expiry are required' }, { status: 400 });
    }
    const expiresAt = BigInt(body.expiresAt);
    if (!voucherExpiryOk(expiresAt, now)) return NextResponse.json({ error: 'Voucher expired or lives too long' }, { status: 400 });
    // Rebuilt here from the checked fields, never taken from the browser.
    const message = voucherMessage(body.channel, amount, expiresAt);
    const signature = Uint8Array.from(Buffer.from(body.voucherSignature, 'base64'));
    if (!voucherSignatureOk(account.agent, message, signature)) {
      return NextResponse.json({ error: "Voucher is not signed by the mandate's agent" }, { status: 400 });
    }
    const payer = new PublicKey(body.owner);
    const channel = new PublicKey(body.channel);
    const mint = new PublicKey(state.mint);
    const settle = buildSettleTransaction({
      agent: account.agent, signature, message, channel: body.channel, mandatePda: body.mandatePda, payer: body.owner, blockhash,
    });
    const escrow = getAssociatedTokenAddressSync(mint, channel, true);
    const distribute = new Transaction().add(distributeInstruction({
      channel,
      payer,
      escrow,
      payerAta: getAssociatedTokenAddressSync(mint, payer),
      payeeAta: getAssociatedTokenAddressSync(mint, new PublicKey(body.recipient)),
      treasuryAta: getAssociatedTokenAddressSync(mint, TREASURY_OWNER),
      mint,
    }));
    distribute.feePayer = payer;
    distribute.recentBlockhash = blockhash;
    return NextResponse.json({ settle: unsigned(settle), distribute: unsigned(distribute) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'channel prepare failed' }, { status: 400 });
  }
}
