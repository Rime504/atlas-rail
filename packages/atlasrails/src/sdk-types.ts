import type { Connection, Keypair, Transaction } from '@solana/web3.js';
import type { AgentMandate, SignedDecision } from '@atlas-rail/mandate';
import type { BoundReceipt } from '@atlas-rail/receipt';
import type { WalletSigner } from './funder';

/** How the SDK may broadcast settlement and distribution. */
export type ExecutionPolicy = 'prepareOnly' | 'requireApproval' | 'autoExecute';

export type PaymentLifecycleStatus =
  | 'denied'
  | 'voucher_ready'
  | 'awaiting_approval'
  | 'simulated'
  | 'submitted'
  | 'confirmed'
  | 'paid'
  | 'partial'
  | 'failed'
  | 'unknown';

export type AtlasErrorCode =
  | 'CONFIG_INVALID'
  | 'NETWORK_MISMATCH'
  | 'CHANNEL_FORBIDDEN'
  | 'CHANNEL_INVALID'
  | 'MANDATE_INVALID'
  | 'GATE_DENIED'
  | 'SIGNER_MISMATCH'
  | 'VOUCHER_INVALID'
  | 'INSUFFICIENT_ESCROW'
  | 'SIMULATION_FAILED'
  | 'APPROVAL_REQUIRED'
  | 'APPROVAL_REJECTED'
  | 'WALLET_REJECTED'
  | 'SUBMIT_FAILED'
  | 'OUTCOME_UNKNOWN'
  | 'SETTLE_OK_DISTRIBUTE_FAILED'
  | 'RECEIPT_FAILED'
  | 'STALE_STATE';

export interface AtlasRailConfig {
  apiUrl: string;
  /** Bearer token for `POST /v1/channel-voucher`, the API's `ATLAS_VOUCHER_TOKEN`. Defaults to that variable. */
  apiToken?: string;
  connection: Connection;
  /** Fee-payer wallet. Signs settlement and distribution fees. Never holds the voucher secret. */
  wallet: WalletSigner;
  execution: ExecutionPolicy;
  /**
   * For `requireApproval`: called with a review summary before broadcast.
   * Must return true to proceed. A callback that always returns true is unsafe and undocumented as production use.
   */
  onApprove?: (review: TransactionReview) => Promise<boolean>;
  /** Expected genesis hash. Defaults to Solana Devnet. */
  expectedGenesis?: string;
  fetch?: typeof fetch;
  /**
   * Defaults to true. Every `requestPayment` and settlement must include `mandateAddress`.
   * The SDK loads that PDA and refuses a missing, revoked, inactive, or over-cap account.
   * Pass false only when the caller has no on-chain mandate.
   */
  requireOnChainMandate?: boolean;
  /** Atlas Mandate program id. Defaults to the deployed Devnet program. */
  mandateProgramId?: string;
  /**
   * Tests only. With `gate`, vouchers are signed in this process and `apiUrl` is not called, so this
   * process holds the agent key and can approve its own vouchers. Leave it out in real use: the
   * voucher API and the signer service then hold the gate and the agent key.
   */
  agent?: Keypair;
  /**
   * Signs receipts and `anchor_root` (the mandate's gate authority). Alone, it never signs vouchers.
   * It must not be the API instance key the signer trusts. With `agent`, it also signs gate decisions in process.
   */
  gate?: Keypair;
}

export interface PayRequest {
  mandate: AgentMandate;
  channel: string;
  recipient: string;
  mint: string;
  /** Cumulative voucher amount in base units (must be strictly above on-chain settled). */
  amount: bigint;
  resourceUrl: string;
  network: string;
  expiresAt: number;
  feePayer?: string | null;
  /** Optional chain settled watermark; when omitted the SDK reads the channel. */
  chainSettled?: bigint;
  /**
   * Atlas Mandate PDA. When set (or when `requireOnChainMandate` is true), the SDK fetches and
   * validates the on-chain account before asking for a voucher. Client JSON cannot override it.
   */
  mandateAddress?: string;
  /** The owner's approval for this exact payment, from an earlier `denied` result's `approvalId`. */
  approvalId?: string;
}

export interface TransactionReview {
  stage: 'settle' | 'distribute' | 'anchor';
  reviewId: string;
  channel: string;
  feeLamports: number | null;
  requiredSigners: string[];
  instructionSummary: { programId: string; dataHex: string }[];
  simulation: { err: unknown; logs: string[]; unitsConsumed: number | null };
  effect: string;
  approvalToken: 'settle' | 'distribute' | 'anchor';
}

export interface AtlasErrorInfo {
  code: AtlasErrorCode;
  stage: string;
  message: string;
  broadcast: boolean;
  outcomeKnown: boolean;
  signature?: string | null;
  fundsMayHaveMoved: boolean;
  nextAction: string;
}

export class AtlasRailError extends Error {
  readonly info: AtlasErrorInfo;

  constructor(info: AtlasErrorInfo) {
    super(info.message);
    this.name = 'AtlasRailError';
    this.info = info;
  }
}

export interface DeniedPaymentResult {
  status: 'denied';
  stage: 'gate';
  message: string;
  /** Plain-words reason when the payment needs the owner. */
  reason?: string;
  /** Set when the owner was asked on Telegram. Pay again with it once the owner approves. */
  approvalId?: string;
  /** Epoch seconds. No answer by then counts as rejected. */
  approvalExpiresAt?: number;
  channel: string;
  broadcast: false;
  hasSignature: false;
}

export interface VoucherReadyResult {
  status: 'voucher_ready';
  stage: 'voucher';
  channel: string;
  amount: string;
  messageHash: string;
  deltaAmount: string;
  authorizedSigner: string;
  voucherBytes: 50;
  signatureVerified: true;
  decision: SignedDecision;
  broadcast: false;
  /** Opaque handle for later settle/distribute stages. */
  paymentId: string;
}

export interface SimulatedStageResult {
  status: 'simulated' | 'awaiting_approval';
  stage: 'settle' | 'distribute';
  review: TransactionReview;
  broadcast: false;
  paymentId: string;
}

export interface ConfirmedSettleResult {
  status: 'confirmed' | 'partial';
  stage: 'settle';
  settleSignature: string;
  settledBefore: string;
  settledAfter: string;
  receipt: BoundReceipt;
  receiptVerifyPass: boolean;
  broadcast: true;
  paymentId: string;
}

export interface PaidResult {
  status: 'paid';
  stage: 'distribute';
  settleSignature: string;
  distributeSignature: string;
  settled: string;
  payoutWatermark: string;
  payeeDelta: string;
  treasuryDelta: string;
  escrowAmount: string;
  receipt: BoundReceipt;
  receiptVerifyPass: boolean;
  broadcast: true;
  paymentId: string;
  /** Set when this payment's `anchor_root` confirmed. */
  anchor?: {
    ok: true;
    rootPda: string;
    merkleRoot: string;
    leafCount: number;
    seq: number;
    signature: string;
    settlements: string[];
  };
  /** Set when the token payment confirmed and `anchor_root` did not. */
  anchorError?: string;
}

export interface FailedPaymentResult {
  status: 'failed' | 'unknown';
  error: AtlasErrorInfo;
}

/**
 * The channel cannot cover this payment. The agent stops here: it never tops up by itself. The owner
 * calls `topUp` with at least `needed`, then the same payment can be asked for again.
 */
export interface NeedsTopUpResult {
  status: 'needs_top_up';
  stage: 'channel';
  channel: string;
  /** Base units still in the escrow: deposit minus settled. */
  remaining: string;
  /** Base units the owner must add for this payment to fit. */
  needed: string;
  deposit: string;
  settled: string;
  message: string;
  broadcast: false;
}

export interface TopUpCall {
  channel: string;
  /** Base units to add to the escrow, from the owner wallet's token account. */
  amount: bigint;
  /** Broadcasts only when true. */
  submit?: boolean;
}

export type TopUpResult =
  | { status: 'prepared'; channel: string; transactionBase64: string; broadcast: false }
  | { status: 'confirmed'; channel: string; signature: string; depositBefore: string; depositAfter: string; broadcast: true }
  | FailedPaymentResult;

export type PaymentResult =
  | DeniedPaymentResult
  | NeedsTopUpResult
  | VoucherReadyResult
  | SimulatedStageResult
  | ConfirmedSettleResult
  | PaidResult
  | FailedPaymentResult;

export interface AtlasRailClient {
  readonly execution: ExecutionPolicy;
  /** Ask the live voucher API. Never broadcasts. */
  requestPayment(request: PayRequest): Promise<DeniedPaymentResult | NeedsTopUpResult | VoucherReadyResult | FailedPaymentResult>;
  /** Load and decode an Atlas Mandate PDA. Never broadcasts. Fails closed on missing/wrong-owner data. */
  loadMandate(address: string): Promise<import('./mandate-onchain').LoadMandateResult>;
  /**
   * Builds `create_mandate` for the deployed Atlas Mandate program.
   * Broadcasts only when `submit` is true.
   */
  createMandate(input: import('./mandate-program').CreateMandateCall): Promise<import('./mandate-program').MandateInstructionResult>;
  /** Builds `revoke_mandate`. Broadcasts only when `submit` is true. */
  revokeMandate(input: import('./mandate-program').RevokeMandateCall): Promise<import('./mandate-program').MandateInstructionResult>;
  /** Builds `anchor_root` using the account's next sequence. Broadcasts only when `submit` is true. */
  anchorRoot(input: import('./mandate-program').AnchorRootCall): Promise<import('./mandate-program').MandateInstructionResult>;
  /**
   * Combines every distributed voucher for this mandate that has no root yet into one `anchor_root`.
   * The transaction stores the Merkle root, batch header, leaf count, and batch file hash.
   * Settlement signatures stay on the receipts.
   */
  anchorVouchers(mandatePda: string): Promise<
    | {
        status: 'anchored';
        mandatePda: string;
        rootPda: string;
        merkleRoot: string;
        leafCount: number;
        seq: number;
        signature: string;
        settlements: string[];
        ok: true;
      }
    | { status: 'empty'; mandatePda: string }
    | FailedPaymentResult
  >;
  /** Build and simulate settlement. Never broadcasts. */
  prepareSettlement(paymentId: string): Promise<SimulatedStageResult | FailedPaymentResult>;
  /** Broadcast settlement under the configured execution policy. */
  executeSettlement(paymentId: string, options?: { approval?: 'settle' }): Promise<ConfirmedSettleResult | FailedPaymentResult>;
  /** Build and simulate distribution. Never broadcasts. */
  prepareDistribution(paymentId: string): Promise<SimulatedStageResult | FailedPaymentResult>;
  /** Broadcast distribution under the configured execution policy. */
  executeDistribution(paymentId: string, options?: { approval?: 'distribute' }): Promise<PaidResult | FailedPaymentResult>;
  /**
   * Convenience: request → prepare settle → (optional execute) → prepare distribute → (optional execute) → one `anchor_root` for this mandate's unanchored receipts.
   * With `prepareOnly`, stops after simulations. A failed root leaves the payment `paid` and sets `anchorError`. Never opens channels or mints.
   */
  pay(request: PayRequest): Promise<PaymentResult>;
  /**
   * Opens a payment channel and locks `deposit` in its escrow.
   * `graceSeconds` must be a whole number of 1 or more. The payment program rejects 0.
   * Broadcasts only when `submit` is true.
   */
  openChannel(input: OpenChannelCall): Promise<OpenChannelResult>;
  /**
   * Returns deposit − settled to the payer.
   * A payee key on an open channel signs settle_and_seal and the remainder moves in that step.
   * Without the payee key, the payer starts request_close and must call again after grace.
   * After the tokens are back, the same call closes the escrow. Call again after `reclaimAfterSlot` and it sends `reclaim`, which returns the channel rent and deletes the account.
   */
  refundRemainder(input: RefundCall): Promise<RefundResult>;
  /**
   * Owner only: adds `amount` to the channel escrow, signed by the configured wallet, which must be the
   * channel payer. `pay()` never calls this; it returns `needs_top_up` instead.
   * Broadcasts only when `submit` is true.
   */
  topUp(input: TopUpCall): Promise<TopUpResult>;
}

export interface OpenChannelCall {
  payee: string;
  mint: string;
  /** Channel authorized signer. This is the mandate agent public key. */
  agent: string;
  deposit: bigint;
  graceSeconds: number;
  salt?: bigint;
  /** Broadcasts only when true. */
  submit?: boolean;
}

export type OpenChannelResult =
  | {
      status: 'prepared';
      channel: string;
      escrow: string;
      transactionBase64: string;
      graceSeconds: number;
      broadcast: false;
    }
  | {
      status: 'confirmed';
      channel: string;
      escrow: string;
      deposit: string;
      openSignature: string;
      graceSeconds: number;
      broadcast: true;
    }
  | FailedPaymentResult;

export interface RefundCall {
  channel: string;
  /** Payee key. On an open channel this signs the immediate refund. */
  payee?: Keypair;
  /** Broadcasts only when true. A grace wait never broadcasts. */
  submit?: boolean;
}

export type RefundResult =
  | { status: 'prepared'; channel: string; steps: string[]; broadcast: false }
  | { status: 'waiting'; channel: string; graceEndsAt: string; broadcast: false }
  | { status: 'rent_pending'; channel: string; reclaimAfterSlot: string; signatures?: string[]; broadcast: boolean }
  | { status: 'reclaimed'; channel: string; signatures: string[]; rentLamports: string; broadcast: true }
  | { status: 'closing'; channel: string; requestCloseSignature: string; graceEndsAt: string; broadcast: true }
  | {
      status: 'refunded';
      channel: string;
      signatures: string[];
      payerDelta: string;
      escrowAmount: string;
      broadcast: true;
      anchor?: {
        ok: true;
        rootPda: string;
        merkleRoot: string;
        leafCount: number;
        seq: number;
        signature: string;
        settlements: string[];
      };
      anchorError?: string;
    }
  | { status: 'closed'; channel: string; broadcast: false }
  | FailedPaymentResult;

export type { Connection, Transaction, WalletSigner, AgentMandate, BoundReceipt };
