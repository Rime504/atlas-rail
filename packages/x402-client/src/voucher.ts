import {
  AgentMandate,
  GateAuthorization,
  GateContext,
  MessageSigner,
  SignedDecision,
  X402Offer,
  GateApproval,
  OwnerReview,
  buildDecisionRecord,
  createGateAuthorization,
  evaluateGate,
  fromBase58,
  sha256Hex,
  signDecision,
} from '@atlas-rail/mandate';
import { BlockedAttemptRecord, BoundReceipt, buildReceipt, hashResponseBody } from '@atlas-rail/receipt';
import { EscalationRequiredError, MandateDeniedError, UnsupportedPaymentError } from './errors';
import { GatedSignerAdapter } from './gated-signer';

/** Payment-channels voucher magic: ASCII 'V' and format version 1. */
export const VOUCHER_MAGIC: readonly [number, number] = [0x56, 0x01];
export const VOUCHER_MESSAGE_LENGTH = 50;
/** Default longest voucher life: one hour. */
export const MAX_VOUCHER_TTL_SECONDS = 3600;

const BASE_UNITS = /^(0|[1-9][0-9]*)$/;

export interface VoucherRequest {
  channelId: string;
  /** Cumulative channel amount, base units. The gate sees the delta above the settled watermark. */
  cumulativeAmount: string;
  /** Caller settled amount. With no chain reader and no prior voucher, omitted means 0. */
  settledAmount?: string;
  /** Unix seconds. `0` is rejected: this prototype does not sign non-expiring vouchers. */
  expiresAt: number;
  recipient: string;
  resourceUrl: string;
  asset: string;
  network: string;
  feePayer?: string | null;
}

export interface VoucherAllow {
  status: 'ALLOW';
  message: Uint8Array;
  messageHash: string;
  signature: Uint8Array;
  deltaAmount: string;
  decision: SignedDecision;
  authorization: GateAuthorization;
  /** Present only after `recordAllowedReceipt`. A denial never produces one. */
  receipt: BoundReceipt | null;
}

/**
 * Encodes the 50-byte voucher the payment-channels program verifies:
 * magic || channel pubkey || u64 LE cumulative || i64 LE expires_at.
 */
export function encodeVoucherMessage(input: { channelId: string; cumulativeAmount: bigint; expiresAt: bigint }): Uint8Array {
  const channel = decodeChannel(input.channelId);
  if (input.cumulativeAmount < 0n || input.cumulativeAmount > 0xffff_ffff_ffff_ffffn) {
    throw new UnsupportedPaymentError('Cumulative amount is not a u64');
  }
  const out = new Uint8Array(VOUCHER_MESSAGE_LENGTH);
  out[0] = VOUCHER_MAGIC[0];
  out[1] = VOUCHER_MAGIC[1];
  out.set(channel, 2);
  const view = new DataView(out.buffer);
  view.setBigUint64(34, input.cumulativeAmount, true);
  view.setBigInt64(42, input.expiresAt, true);
  return out;
}

function decodeChannel(channelId: string): Uint8Array {
  try {
    const channel = fromBase58(channelId);
    if (channel.length !== 32) throw new Error('length');
    return channel;
  } catch {
    throw new UnsupportedPaymentError('Channel id is not a 32-byte Solana address');
  }
}

function parseUnits(value: string, name: string): bigint {
  if (!BASE_UNITS.test(value)) throw new UnsupportedPaymentError(`${name} is not a base-unit integer`);
  return BigInt(value);
}

/** The offer the gate scores for a voucher: the slice above the watermark, paid to the channel payee. */
export function voucherOffer(input: VoucherRequest, delta: bigint): X402Offer {
  return {
    x402Version: 2,
    scheme: 'exact',
    network: input.network,
    asset: input.asset,
    payTo: input.recipient,
    amount: delta.toString(),
    resourceUrl: input.resourceUrl,
    feePayer: input.feePayer ?? null,
    memo: `channel:${input.channelId}`,
  };
}

export interface VoucherSpendSnapshot {
  windowAutonomousBaseUnits: string;
  totalBaseUnits: string;
}

/**
 * In-process budget for one mandate. Two authorizers in the same process can share one ledger.
 * This is not a Postgres advisory lock: another process with its own ledger does not see these
 * reservations. shortcut: process-local ledger, upgrade to AgentStore.runExclusive when voucher
 * signing goes through the API store.
 */
export class VoucherBudgetLedger {
  private readonly tails = new Map<string, Promise<unknown>>();
  private readonly watermark = new Map<string, bigint>();
  private readonly seen = new Set<string>();
  private spentTotal: bigint;
  private spentWindow: bigint;
  /** Reservations held through signing and not yet committed or rolled back. */
  private inFlight = 0;

  constructor(spend: VoucherSpendSnapshot = { windowAutonomousBaseUnits: '0', totalBaseUnits: '0' }) {
    this.spentWindow = parseUnits(spend.windowAutonomousBaseUnits, 'spend.windowAutonomousBaseUnits');
    this.spentTotal = parseUnits(spend.totalBaseUnits, 'spend.totalBaseUnits');
  }

  snapshot(): VoucherSpendSnapshot & { inFlight: number } {
    return {
      windowAutonomousBaseUnits: this.spentWindow.toString(),
      totalBaseUnits: this.spentTotal.toString(),
      inFlight: this.inFlight,
    };
  }

  /** Same-channel requests run one at a time. A thrown request does not cancel the next one. */
  runChannel<T>(channelId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(channelId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const tail = previous.then(() => gate, () => gate);
    this.tails.set(channelId, tail);
    return previous.catch(() => undefined).then(async () => {
      try {
        return await fn();
      } finally {
        release();
        if (this.tails.get(channelId) === tail) this.tails.delete(channelId);
      }
    });
  }

  /** Synchronous. Call only from inside `runChannel` for this channel, before any await. */
  reserve(input: { channelId: string; hash: string; settled: bigint; cumulative: bigint; seenChannel: boolean }): { delta: bigint; previous: bigint | undefined } {
    if (this.seen.has(input.hash)) throw new UnsupportedPaymentError('This voucher was already presented');
    if (input.seenChannel && input.settled !== this.watermark.get(input.channelId)) {
      throw new UnsupportedPaymentError('Settled watermark does not match the last voucher this signer accepted');
    }
    if (input.cumulative <= input.settled) throw new UnsupportedPaymentError('Cumulative amount is not strictly above the settled watermark');
    const delta = input.cumulative - input.settled;
    const previous = this.watermark.get(input.channelId);
    this.spentWindow += delta;
    this.spentTotal += delta;
    this.watermark.set(input.channelId, input.cumulative);
    this.inFlight += 1;
    return { delta, previous };
  }

  rollback(input: { channelId: string; delta: bigint; previous: bigint | undefined }): void {
    this.spentWindow -= input.delta;
    this.spentTotal -= input.delta;
    if (input.previous === undefined) this.watermark.delete(input.channelId);
    else this.watermark.set(input.channelId, input.previous);
    this.inFlight -= 1;
  }

  commit(): void {
    this.inFlight -= 1;
  }

  remember(hash: string): void {
    this.seen.add(hash);
  }

  spendNow(): { windowAutonomousBaseUnits: string; totalBaseUnits: string } {
    return { windowAutonomousBaseUnits: this.spentWindow.toString(), totalBaseUnits: this.spentTotal.toString() };
  }

  knownWatermark(channelId: string): bigint | undefined {
    return this.watermark.get(channelId);
  }
}

/** On-chain settled u64 for a channel. Injected by the caller; this package does not add an RPC client. */
export type SettledWatermarkReader = (channelId: string) => Promise<bigint>;

export interface VoucherAuthorizerOptions {
  mandate: AgentMandate;
  /** Instance key that signs decisions and authorisations. Not the voucher key. */
  instance: MessageSigner;
  signer: GatedSignerAdapter;
  organizationId: string;
  clock?: () => number;
  spend?: VoucherSpendSnapshot;
  /**
   * Shared process-local ledger. When omitted, the authorizer keeps a private one seeded from `spend`.
   * Pass the same instance to every authorizer that must not overspend one mandate.
   */
  budget?: VoucherBudgetLedger;
  revoked?: { revokedAt: number; reason?: string | null } | null;
  /** Payer on the channel account. The gate ignores it when the offer has no fee payer. */
  channelPayer?: string | null;
  /** How long a gate authorisation may be presented to the signer. */
  authorizationTtlSeconds?: number;
  /**
   * An owner approval for this exact voucher. The gate lets it override only the approvable rules
   * (window budget, escalation threshold, price tolerance) and only for the offer it was given for.
   */
  approval?: GateApproval | null;
  /** Why the owner was asked and who approved, recorded on the signed decision. */
  review?: OwnerReview | null;
  /**
   * Longest voucher life, in seconds. Defaults to {@link MAX_VOUCHER_TTL_SECONDS}. A signed voucher
   * can be settled until it expires, so it must not outlive this, nor the mandate itself.
   */
  maxVoucherTtlSeconds?: number;
  /**
   * When set, the first request for a channel uses this settled u64. A caller-supplied settled
   * amount below it is rejected. A later caller amount that disagrees with the ledger is rejected.
   */
  settledWatermark?: SettledWatermarkReader;
}

/**
 * Asks the existing mandate gate before the voucher signer runs. The signer key stays inside
 * `GatedSignerAdapter`; this class never sees it. ESCALATE and DENY produce no signature.
 */
export class VoucherAuthorizer {
  readonly denials: BlockedAttemptRecord[] = [];
  private readonly clock: () => number;
  private readonly budget: VoucherBudgetLedger;
  private seq = 0;

  constructor(private readonly options: VoucherAuthorizerOptions) {
    this.clock = options.clock ?? (() => Math.floor(Date.now() / 1000));
    this.budget = options.budget ?? new VoucherBudgetLedger(options.spend);
  }

  budgetSnapshot(): VoucherSpendSnapshot & { inFlight: number } {
    return this.budget.snapshot();
  }

  async requestVoucher(input: VoucherRequest): Promise<VoucherAllow> {
    return this.budget.runChannel(input.channelId, () => this.requestOnChannel(input));
  }

  /**
   * Reserve before the first await. Same-channel calls are queued, so a failure can roll its own
   * delta back before the next call on that channel starts. A produced signature stays charged:
   * a lost HTTP response must not free budget that a voucher can still settle.
   * A repeated hash is rejected and is not charged again.
   */
  private async requestOnChannel(input: VoucherRequest): Promise<VoucherAllow> {
    const started = performance.now();
    const cumulative = parseUnits(input.cumulativeAmount, 'cumulativeAmount');
    const now = this.clock();
    if (!Number.isInteger(input.expiresAt) || input.expiresAt <= now) {
      throw new UnsupportedPaymentError('Voucher expiry is missing, zero, or already past');
    }
    if (input.expiresAt > now + (this.options.maxVoucherTtlSeconds ?? MAX_VOUCHER_TTL_SECONDS)) {
      throw new UnsupportedPaymentError('Voucher expiry is further away than the longest voucher life');
    }
    if (input.expiresAt > this.options.mandate.expiresAt) {
      throw new UnsupportedPaymentError('Voucher expiry is after the mandate expires');
    }
    const chainSettled = this.options.settledWatermark ? await this.options.settledWatermark(input.channelId) : undefined;
    const known = this.budget.knownWatermark(input.channelId);
    const seenChannel = known !== undefined;
    const callerSettled = input.settledAmount === undefined ? undefined : parseUnits(input.settledAmount, 'settledAmount');
    if (chainSettled !== undefined && callerSettled !== undefined && callerSettled < chainSettled) {
      throw new UnsupportedPaymentError('Settled watermark is below the on-chain settled amount');
    }
    const settled = chainSettled !== undefined && !seenChannel ? chainSettled : callerSettled === undefined ? (known ?? 0n) : callerSettled;
    const message = encodeVoucherMessage({ channelId: input.channelId, cumulativeAmount: cumulative, expiresAt: BigInt(input.expiresAt) });
    const messageHash = sha256Hex(message);
    const priorSpend = this.budget.spendNow();
    let reservation: { delta: bigint; previous: bigint | undefined } | undefined;
    if (seenChannel && settled !== known) throw new UnsupportedPaymentError('Settled watermark does not match the last voucher this signer accepted');
    if (cumulative <= settled) throw new UnsupportedPaymentError('Cumulative amount is not strictly above the settled watermark');
    const delta = cumulative - settled;
    const offer = this.offer(input, delta);
    const context = this.context(now, priorSpend);
    const gateStarted = performance.now();
    const result = evaluateGate(this.options.mandate, offer, context);
    const gateMs = performance.now() - gateStarted;
    if (result.decision === 'ALLOW') {
      reservation = this.budget.reserve({ channelId: input.channelId, hash: messageHash, settled, cumulative, seenChannel });
    }

    let signature: Uint8Array | undefined;
    try {
      const decision = await signDecision(
        buildDecisionRecord({
          id: `dec_vch_${messageHash.slice(0, 16)}_${this.seq++}`,
          organizationId: this.options.organizationId,
          mandate: this.options.mandate,
          offer,
          result,
          context,
          request: null,
        }),
        this.options.instance,
      );
      if (result.decision !== 'ALLOW') {
        if (result.decision === 'DENY') this.denials.push({ mandate: this.options.mandate, decision });
        if (result.decision === 'ESCALATE') throw new EscalationRequiredError('not-requested', decision);
        throw new MandateDeniedError(decision);
      }
      const authorization = await createGateAuthorization(
        {
          type: 'atlasrail.gate-authorization',
          version: '0.1',
          decisionId: decision.record.id,
          decisionHash: decision.decisionHash,
          mandateHash: decision.record.mandateHash,
          offerHash: decision.record.offerHash,
          txMessageHash: messageHash,
          agentPublicKey: this.options.signer.publicKey,
          notBefore: now,
          notAfter: now + (this.options.authorizationTtlSeconds ?? 60),
        },
        this.options.instance,
      );
      const signStarted = performance.now();
      ({ signature } = await this.options.signer.signVoucherWithAuthorization(message, authorization, decision, this.options.mandate));
      const signMs = performance.now() - signStarted;
      this.budget.commit();
      reservation = undefined;
      this.budget.remember(messageHash);
      lastTimings.push({ gateMs, signMs, totalMs: performance.now() - started });
      return { status: 'ALLOW', message, messageHash, signature, deltaAmount: delta.toString(), decision, authorization, receipt: null };
    } catch (error) {
      if (reservation && signature === undefined) this.budget.rollback({ channelId: input.channelId, delta: reservation.delta, previous: reservation.previous });
      throw error;
    }
  }

  private offer(input: VoucherRequest, delta: bigint): X402Offer {
    return voucherOffer(input, delta);
  }

  private context(now: number, spend: { windowAutonomousBaseUnits: string; totalBaseUnits: string }): GateContext {
    return {
      now,
      revoked: this.options.revoked ?? null,
      channelPayer: this.options.channelPayer ?? null,
      spend,
      // A voucher is not an SPL transfer. The exact-scheme simulation rule is unchanged;
      // this path uses the existing "simulation not required" branch and binds the authorisation
      // to the voucher bytes instead of a transaction message.
      simulation: null,
      requireSimulation: false,
      approval: this.options.approval ?? null,
      ...(this.options.review ? { review: this.options.review } : {}),
    };
  }

  /** Successful-payment receipt only. Callers must not pass a denial. */
  async recordAllowedReceipt(allowed: VoucherAllow, settlement: { txSignature: string; slot: number | null }): Promise<BoundReceipt> {
    if (allowed.status !== 'ALLOW') throw new UnsupportedPaymentError('A denied voucher cannot produce a payment receipt');
    const receipt = await buildReceipt(
      {
        id: `rcp_${allowed.messageHash.slice(0, 16)}`,
        mandate: this.options.mandate,
        decision: allowed.decision,
        settlement: {
          txSignature: settlement.txSignature,
          network: allowed.decision.record.offer.network,
          payer: this.options.signer.publicKey,
          settledAt: this.clock(),
          slot: settlement.slot,
        },
        response: { status: 200, bodySha256: hashResponseBody(Buffer.from(allowed.message)), contentType: 'application/vnd.payment-channels.voucher' },
        issuedAt: this.clock(),
      },
      this.options.instance,
    );
    allowed.receipt = receipt;
    return receipt;
  }
}

export interface VoucherTiming {
  gateMs: number;
  signMs: number;
  totalMs: number;
}

const lastTimings: VoucherTiming[] = [];

export function takeVoucherTimings(): VoucherTiming[] {
  const copy = lastTimings.slice();
  lastTimings.length = 0;
  return copy;
}

/** Nearest-rank percentile. `samples` need not be sorted. */
export function percentile(samples: readonly number[], rank: number): number {
  if (samples.length === 0) throw new Error('no samples');
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((rank / 100) * sorted.length) - 1));
  return sorted[index];
}
