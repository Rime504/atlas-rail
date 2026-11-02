import { PublicKey, TransactionInstruction } from '@solana/web3.js';

export const PAYMENT_PROGRAM_ID = new PublicKey('CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX');
export const INSTRUCTIONS_SYSVAR = new PublicKey('Sysvar1nstructions1111111111111111111111111');
export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

/** The deployed payment program rejects 0 with custom error 201. */
export const MIN_GRACE_SECONDS = 1;
/** x402 facilitators reject a grace shorter than 15 minutes. */
export const FACILITATOR_MIN_GRACE_SECONDS = 900;

export function assertGraceSeconds(graceSeconds: number): void {
  if (!Number.isInteger(graceSeconds) || graceSeconds < MIN_GRACE_SECONDS) {
    throw new Error('Grace period must be a positive whole number of seconds');
  }
}

/** The program keeps a drained channel until this many slots after `open_slot`, then `reclaim` can delete it. */
export const OPEN_SLOT_WINDOW = 1500n;

/** Website and facilitator opens use this. The program still accepts any positive grace. */
export function assertFacilitatorGrace(graceSeconds: number): void {
  assertGraceSeconds(graceSeconds);
  if (graceSeconds < FACILITATOR_MIN_GRACE_SECONDS) {
    throw new Error('Grace must be at least 900 seconds');
  }
}

export interface CloseState {
  status: number;
  deposit: bigint;
  settled: bigint;
  closureStartedAt: bigint;
  payerWithdrawnAt: bigint;
  gracePeriod: number;
  payer: string;
  payee: string;
  mint: string;
  rentPayer: string;
  openSlot: bigint;
}

export function readCloseState(data: Uint8Array): CloseState {
  const bytes = Buffer.from(data);
  const key = (offset: number) => new PublicKey(bytes.subarray(offset, offset + 32)).toBase58();
  return {
    status: bytes[3],
    deposit: bytes.readBigUInt64LE(12),
    settled: bytes.readBigUInt64LE(20),
    closureStartedAt: bytes.readBigInt64LE(36),
    payerWithdrawnAt: bytes.readBigInt64LE(44),
    gracePeriod: bytes.readUInt32LE(52),
    payer: key(88),
    payee: key(120),
    mint: key(184),
    rentPayer: key(216),
    openSlot: bytes.readBigUInt64LE(248),
  };
}

/** Regular settle is only accepted while the channel is Open. Closing, sealed, and distributed reject it. */
export function regularSettleAllowed(status: number): boolean {
  return status === 0;
}

/**
 * After revoke, the payer starts request_close so an already-signed voucher cannot call settle.
 * A channel that is already past Open is already blocked. A different wallet cannot close it.
 */
export function revokeSettleBlock(state: { status: number; payer: string }, wallet: string): 'close' | 'blocked' | 'payer-mismatch' {
  if (!regularSettleAllowed(state.status)) return 'blocked';
  if (state.payer !== wallet) return 'payer-mismatch';
  return 'close';
}

/**
 * A payee signature seals the channel now, on Open or during grace.
 * That closes settle_and_seal for an already-signed voucher. Without the payee, the payer can only start the grace wait.
 */
export function revokeChannelStep(
  state: { status: number; payer: string; payee: string },
  wallet: string,
  payeeKey: string | null,
): 'seal_now' | 'close' | 'blocked' | 'payer-mismatch' | 'payee-mismatch' {
  if (state.status !== 0 && state.status !== 2) return 'blocked';
  if (payeeKey) {
    if (payeeKey !== state.payee) return 'payee-mismatch';
    return 'seal_now';
  }
  if (state.status === 2) return 'blocked';
  if (state.payer !== wallet) return 'payer-mismatch';
  return 'close';
}

export type RefundStep = 'settle_and_seal' | 'request_close' | 'seal' | 'withdraw' | 'close_escrow' | 'reclaim';

export interface RefundPlan {
  steps: RefundStep[];
  graceEndsAt: bigint | null;
  /** Slot after which `reclaim` is accepted. Set while a drained channel is still inside the open-slot window. */
  reclaimAfterSlot: bigint | null;
  /** False while a payer-only close is still inside its grace period, or reclaim is still inside the slot window. */
  ready: boolean;
}

/**
 * Payee-signed settle_and_seal returns the remainder on an open channel.
 * Without that signature the payer starts request_close and waits out the grace stored at open.
 */
export function refundPlan(state: CloseState, now: bigint, payeePresent: boolean, slot = 0n): RefundPlan {
  const unlock = (state.openSlot ?? 0n) + OPEN_SLOT_WINDOW;
  if (state.status === 3) {
    if (slot <= unlock) return { steps: [], graceEndsAt: null, reclaimAfterSlot: unlock, ready: false };
    return { steps: ['reclaim'], graceEndsAt: null, reclaimAfterSlot: null, ready: true };
  }
  if (state.payerWithdrawnAt !== 0n) {
    if (state.status === 1) return { steps: ['close_escrow'], graceEndsAt: null, reclaimAfterSlot: null, ready: true };
    return { steps: [], graceEndsAt: null, reclaimAfterSlot: null, ready: true };
  }
  if (state.status === 0 && payeePresent) return { steps: ['settle_and_seal', 'withdraw', 'close_escrow'], graceEndsAt: null, reclaimAfterSlot: null, ready: true };
  if (state.status === 0) return { steps: ['request_close'], graceEndsAt: null, reclaimAfterSlot: null, ready: true };
  const graceEndsAt = state.closureStartedAt + BigInt(state.gracePeriod);
  if (state.status === 2 && now < graceEndsAt) return { steps: [], graceEndsAt, reclaimAfterSlot: null, ready: false };
  if (state.status === 2) return { steps: ['seal', 'withdraw', 'close_escrow'], graceEndsAt, reclaimAfterSlot: null, ready: true };
  if (state.status === 1) return { steps: ['withdraw', 'close_escrow'], graceEndsAt, reclaimAfterSlot: null, ready: true };
  throw new Error(`Channel status ${state.status} cannot be refunded`);
}

/**
 * Appends the mandate PDA as a read-only account so the settle transaction can be found from that
 * address. Put it on the Ed25519 signature-check instruction, never on `settle`: the payment-channels
 * program takes exactly two accounts on settle and fails a third with NotEnoughAccountKeys. The
 * precompile ignores accounts, so the citation costs nothing there.
 */
export function citeMandateOnSignatureCheck(ix: TransactionInstruction, mandate: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: ix.programId,
    data: ix.data,
    keys: [...ix.keys, { pubkey: mandate, isSigner: false, isWritable: false }],
  });
}

export function buildSettleAndSealInstruction(payee: PublicKey, channel: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: PAYMENT_PROGRAM_ID,
    keys: [
      { pubkey: payee, isSigner: true, isWritable: false },
      { pubkey: channel, isSigner: false, isWritable: true },
      { pubkey: INSTRUCTIONS_SYSVAR, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([4, 0]),
  });
}

export function buildRequestCloseInstruction(payer: PublicKey, channel: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: PAYMENT_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: false },
      { pubkey: channel, isSigner: false, isWritable: true },
    ],
    data: Buffer.from([5]),
  });
}

export function buildSealInstruction(channel: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: PAYMENT_PROGRAM_ID,
    keys: [{ pubkey: channel, isSigner: false, isWritable: true }],
    data: Buffer.from([6]),
  });
}

/**
 * payment-channels `top_up` (discriminator 3, u64 LE amount): moves more of the payer's tokens into the
 * escrow. The program requires the channel payer to sign. Only the owner calls this, never the agent.
 */
export function buildTopUpInstruction(input: {
  payer: PublicKey;
  channel: PublicKey;
  payerAta: PublicKey;
  escrow: PublicKey;
  mint: PublicKey;
  amount: bigint;
}): TransactionInstruction {
  const data = Buffer.alloc(9);
  data[0] = 3;
  data.writeBigUInt64LE(input.amount, 1);
  return new TransactionInstruction({
    programId: PAYMENT_PROGRAM_ID,
    keys: [
      { pubkey: input.payer, isSigner: true, isWritable: true },
      { pubkey: input.channel, isSigner: false, isWritable: true },
      { pubkey: input.payerAta, isSigner: false, isWritable: true },
      { pubkey: input.escrow, isSigner: false, isWritable: true },
      { pubkey: input.mint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function buildWithdrawPayerInstruction(input: {
  payer: PublicKey;
  channel: PublicKey;
  escrow: PublicKey;
  payerAta: PublicKey;
  mint: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: PAYMENT_PROGRAM_ID,
    keys: [
      { pubkey: input.payer, isSigner: true, isWritable: false },
      { pubkey: input.channel, isSigner: false, isWritable: true },
      { pubkey: input.escrow, isSigner: false, isWritable: true },
      { pubkey: input.payerAta, isSigner: false, isWritable: true },
      { pubkey: input.mint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([8]),
  });
}

/** Sealed `distribute` with an empty recipient list. Closes the escrow and leaves the channel Distributed until `reclaim`. */
export function buildCloseEscrowInstruction(input: {
  channel: PublicKey;
  payer: PublicKey;
  rentPayer: PublicKey;
  escrow: PublicKey;
  payerAta: PublicKey;
  payeeAta: PublicKey;
  treasuryAta: PublicKey;
  mint: PublicKey;
  eventAuthority: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: PAYMENT_PROGRAM_ID,
    keys: [
      { pubkey: input.channel, isSigner: false, isWritable: true },
      { pubkey: input.payer, isSigner: false, isWritable: true },
      { pubkey: input.rentPayer, isSigner: false, isWritable: true },
      { pubkey: input.escrow, isSigner: false, isWritable: true },
      { pubkey: input.payerAta, isSigner: false, isWritable: true },
      { pubkey: input.payeeAta, isSigner: false, isWritable: true },
      { pubkey: input.treasuryAta, isSigner: false, isWritable: true },
      { pubkey: input.mint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: input.eventAuthority, isSigner: false, isWritable: false },
      { pubkey: PAYMENT_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([7, 0, 0, 0, 0]),
  });
}

/** Deletes a Distributed channel and sends its rent SOL to `rentPayer`. No signer. The slot window must already have passed. */
export function buildReclaimInstruction(channel: PublicKey, rentPayer: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: PAYMENT_PROGRAM_ID,
    keys: [
      { pubkey: channel, isSigner: false, isWritable: true },
      { pubkey: rentPayer, isSigner: false, isWritable: true },
    ],
    data: Buffer.from([9]),
  });
}
