import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  APPROVE_REQUEST_CLOSE_BROADCAST,
  DEVNET_GENESIS,
  RECOVERY_CHANNEL,
  RECOVERY_DEPOSIT,
  RECOVERY_ESCROW,
  RECOVERY_MINT,
  RECOVERY_PAYER,
  RECOVERY_PROGRAM,
  assertWithdrawAllowed,
  broadcastRequestClose,
  decodeRecoveryChannel,
  instructionFromCodama,
  loadRecoveryInstructions,
  prepareRequestCloseReview,
  readRecoveryAccounts,
  recoveryPlan,
  simulateRequestClose,
} from '../../../scripts/recover-funded-channel.mjs';

// The Codama instruction files from the payment-channels IDL, so the test does not need a vendor checkout.
process.env.X402_PAYMENT_CHANNELS_INSTRUCTIONS ??= join(__dirname, '../test-fixtures/payment-channels');

const PROGRAM = new PublicKey(RECOVERY_PROGRAM);
const MINT = new PublicKey(RECOVERY_MINT);
const PAYER = new PublicKey(RECOVERY_PAYER);
const CHANNEL = new PublicKey(RECOVERY_CHANNEL);

function channelBytes(fields: { status?: number; closureStartedAt?: bigint; deposit?: bigint } = {}): Buffer {
  const data = Buffer.alloc(256);
  data[3] = fields.status ?? 0;
  data.writeBigUInt64LE(1n, 4);
  data.writeBigUInt64LE(fields.deposit ?? RECOVERY_DEPOSIT, 12);
  data.writeBigUInt64LE(0n, 20);
  data.writeBigUInt64LE(0n, 28);
  data.writeBigInt64LE(fields.closureStartedAt ?? 0n, 36);
  data.writeUInt32LE(3600, 52);
  PAYER.toBuffer().copy(data, 88);
  Keypair.generate().publicKey.toBuffer().copy(data, 120);
  Keypair.generate().publicKey.toBuffer().copy(data, 152);
  MINT.toBuffer().copy(data, 184);
  PAYER.toBuffer().copy(data, 216);
  return data;
}

function tokenBytes(mint: PublicKey, authority: PublicKey, amount: bigint): Buffer {
  const data = Buffer.alloc(165);
  mint.toBuffer().copy(data, 0);
  authority.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  return data;
}

function connectionFor(channel = channelBytes()) {
  const payerAta = getAssociatedTokenAddressSync(MINT, PAYER, false, TOKEN_PROGRAM_ID);
  return {
    async getGenesisHash() {
      return DEVNET_GENESIS;
    },
    async getAccountInfo(key: PublicKey) {
      if (key.equals(CHANNEL)) return { owner: PROGRAM, executable: false, data: channel };
      if (key.equals(new PublicKey(RECOVERY_ESCROW))) return { owner: TOKEN_PROGRAM_ID, data: tokenBytes(MINT, CHANNEL, RECOVERY_DEPOSIT) };
      if (key.equals(payerAta)) return { owner: TOKEN_PROGRAM_ID, data: tokenBytes(MINT, PAYER, 20_000_000n) };
      if (key.equals(PROGRAM)) return { owner: new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'), executable: true, data: Buffer.alloc(0) };
      return null;
    },
  };
}

describe('funded channel recovery', () => {
  const shapes = loadRecoveryInstructions();

  it('uses the Codama discriminators and account order', () => {
    expect(shapes.requestClose.discriminator).toBe(5);
    expect(shapes.seal.discriminator).toBe(6);
    expect(shapes.withdrawPayer.discriminator).toBe(8);
    expect(shapes.requestClose.accounts).toEqual([
      { name: 'payer', isWritable: false, isSigner: true },
      { name: 'channel', isWritable: true, isSigner: false },
    ]);
    expect(shapes.seal.accounts).toEqual([{ name: 'channel', isWritable: true, isSigner: false }]);
    expect(shapes.withdrawPayer.accounts.map((account) => account.name)).toEqual([
      'payer',
      'channel',
      'channelTokenAccount',
      'payerTokenAccount',
      'mint',
      'tokenProgram',
    ]);
    const close = instructionFromCodama(shapes.requestClose, { payer: RECOVERY_PAYER, channel: RECOVERY_CHANNEL });
    expect(close.data[0]).toBe(5);
    expect(close.keys[0].isSigner).toBe(true);
    expect(close.keys[1].isSigner).toBe(false);
  });

  it('rejects a channel whose escrow or status does not match', async () => {
    const snapshot = await readRecoveryAccounts(connectionFor());
    expect(snapshot.channel.deposit).toBe(RECOVERY_DEPOSIT);
    const short = connectionFor(channelBytes({ deposit: 9n }));
    await expect(readRecoveryAccounts(short)).rejects.toThrow('Channel balances do not match the funded state');
    const sealed = decodeRecoveryChannel(channelBytes({ status: 1, closureStartedAt: 10n }));
    await expect(simulateRequestClose({
      async simulateTransaction() {
        throw new Error('should not simulate');
      },
    }, { publicKey: PAYER }, { channel: sealed, now: 20 }, shapes)).rejects.toThrow('request_close requires an open channel');
  });

  it('refuses withdraw before the grace period expires and does not send', () => {
    const open = { channel: decodeRecoveryChannel(channelBytes()), now: 1_000 };
    expect(recoveryPlan(open, shapes).withdrawRefusal).toContain('before request_close');
    expect(() => assertWithdrawAllowed(open)).toThrow('before request_close');
    const closing = {
      channel: decodeRecoveryChannel(channelBytes({ status: 2, closureStartedAt: 1_000n })),
      now: 1_000 + 3599,
    };
    expect(() => assertWithdrawAllowed(closing)).toThrow('before the grace period expires');
    const ready = {
      channel: decodeRecoveryChannel(channelBytes({ status: 1, closureStartedAt: 1_000n })),
      now: 1_000 + 3600,
    };
    expect(recoveryPlan(ready, shapes).withdraw).toBe(true);
    expect(recoveryPlan(ready, shapes).seal).toBe(false);
    const due = {
      channel: decodeRecoveryChannel(channelBytes({ status: 2, closureStartedAt: 1_000n })),
      now: 1_000 + 3600,
    };
    expect(recoveryPlan(due, shapes).seal).toBe(true);
    expect(recoveryPlan(due, shapes).withdraw).toBe(false);
  });

  it('refuses a simulation connection that can broadcast', async () => {
    const snapshot = { channel: decodeRecoveryChannel(channelBytes()), now: 10 };
    await expect(simulateRequestClose({
      async sendRawTransaction() {
        return 'sent';
      },
    }, { publicKey: PAYER }, snapshot, shapes)).rejects.toThrow('must not use a connection that can send');
  });

  it('prepares request_close for review without signing or sending', async () => {
    const snapshot = await readRecoveryAccounts(connectionFor());
    let sent = 0;
    const review = await prepareRequestCloseReview({
      async getLatestBlockhash() {
        return { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 99 };
      },
      async getFeeForMessage() {
        return { context: { slot: 1 }, value: 5_000 };
      },
      async sendRawTransaction() {
        sent += 1;
        return 'sent';
      },
    }, snapshot, shapes);
    expect(review.awaitingApproval).toBe(true);
    expect(review.broadcast).toBe(false);
    expect(review.payer).toBe(RECOVERY_PAYER);
    expect(review.channel).toBe(RECOVERY_CHANNEL);
    expect(review.feeLamports).toBe(5_000);
    expect(review.instruction.discriminator).toBe(5);
    expect(review.instruction.accounts[0]).toEqual({
      pubkey: RECOVERY_PAYER,
      isSigner: true,
      isWritable: false,
    });
    expect(sent).toBe(0);
  });

  it('refuses broadcast without explicit approval', async () => {
    let sent = 0;
    await expect(broadcastRequestClose({
      async sendRawTransaction() {
        sent += 1;
        return 'sent';
      },
    }, { publicKey: PAYER }, 'nope', shapes)).rejects.toThrow('Explicit approval is required');
    expect(sent).toBe(0);
    expect(APPROVE_REQUEST_CLOSE_BROADCAST).toBe('request_close');
  });
});
