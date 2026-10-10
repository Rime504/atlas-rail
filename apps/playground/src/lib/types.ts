import type { AgentMandate, GateResult, RuleResult } from '@atlas-rail/mandate';
import type { BoundReceipt, ReceiptVerification } from '@atlas-rail/receipt';

/** A keypair's public half plus its seed, so a stateless server can re-derive the signer on the
 * next request. These are freshly generated, throwaway demo keys (instant mode) or fixed
 * server-held devnet keys (devnet mode) — never anything holding real value. */
export interface KeyInfo {
  label: string;
  publicKey: string;
  /** 32-byte Ed25519 seed, hex. Absent for devnet-mode keys the server already holds via env vars. */
  seedHex: string | null;
}

export interface OnchainAction {
  txSignature: string;
  explorerUrl: string;
}

/** Everything needed to resume the walkthrough on the next request. Plain JSON, no class instances. */
export interface World {
  mode: 'instant' | 'devnet';
  now: number;
  keys: {
    owner: KeyInfo;
    approver: KeyInfo;
    agent: KeyInfo;
    instance: KeyInfo;
    sellerA: KeyInfo;
    sellerB: KeyInfo;
    attacker: KeyInfo;
  };
  mandate: AgentMandate | null;
  mandateOnchain: OnchainAction | null;
  spend: { windowAutonomousBaseUnits: string; totalBaseUnits: string };
  revoked: { revokedAt: number; reason: string } | null;
  revokeOnchain: OnchainAction | null;
  receipts: BoundReceipt[];
  /** Devnet mode fell back to instant mode for this run (rate limit, timeout, or devnet error). */
  devnetFallbackReason: string | null;
  /** Whether this session may attempt real on-chain devnet actions at all — decided once, at init
   * (instant mode, devnet not configured, or this IP's hourly rate limit already used). Checked
   * before every individual on-chain action instead of re-consuming the rate limit per action, so
   * one full 8-step run counts as one "run" against the limit, not five. */
  devnetAllowed: boolean;
  /** Set once this run's receipt has been anchored on Solana devnet, so publishing can be retried without anchoring again. */
  anchorOnchain?: OnchainAction | null;
  /** The server's signature over everything else in this object (see session.ts). */
  sessionMac?: string;
}

export type Verdict = 'ALLOW' | 'ESCALATE' | 'DENY';

/** One rule result, pre-digested for the UI: friendly label plus the raw rule for "show details".
 * 'not-applicable' is distinct from 'pass': the gate evaluated the rule but nothing about it bore on
 * this payment (e.g. no price limit is configured for this resource at all) — shown with a neutral
 * dash, never a green tick, so a vacuous pass is never mistaken for something having been checked. */
export interface RuleDisplay {
  id: string;
  verdict: 'pass' | 'escalate' | 'fail' | 'skipped' | 'overridden' | 'not-applicable';
  label: string;
  /** Human-readable detail sentence for "show details" — dollar amounts, never base units. */
  detail: string;
  /** The rule's recorded values with every amount in dollars (what the expanded row shows). */
  values: Record<string, unknown>;
  raw: RuleResult;
}

export interface PaymentOutcome {
  verdict: Verdict;
  headline: string;
  amountUsd: string;
  resourceUrl: string;
  payTo: string;
  rules: RuleDisplay[];
  gate: GateResult;
  receipt: BoundReceipt | null;
  /** Set when this payment actually settled on real Solana devnet (devnet mode only). */
  onchain: OnchainAction | null;
}

export type ActionType =
  | 'init'
  | 'sign-mandate'
  | 'pay-normal'
  | 'attack'
  | 'price-spike-moderate'
  | 'price-spike-severe'
  | 'human-decision'
  | 'prove'
  | 'publish'
  | 'revoke'
  | 'pay-after-revoke';

export interface StepRequest {
  world: World | null;
  action: { type: ActionType; approve?: boolean };
}

/** Where this run's receipt stands in the public store. `retryable: false` means trying again cannot help (rate limit, not configured). */
export interface Publication {
  stored: boolean;
  reason: string;
  txSignature: string | null;
  retryable: boolean;
}

export interface StepResponse {
  world: World;
  payment?: PaymentOutcome;
  verification?: ReceiptVerification;
  /** Devnet mode only: whether this receipt made it into the public store, so /verify can find it. */
  publication?: Publication;
  error?: string;
}
