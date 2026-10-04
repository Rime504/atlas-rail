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
}

export type Verdict = 'ALLOW' | 'ESCALATE' | 'DENY';

/** One rule result, pre-digested for the UI: friendly label plus the raw rule for "show details". */
export interface RuleDisplay {
  id: string;
  verdict: 'pass' | 'escalate' | 'fail' | 'skipped' | 'overridden';
  label: string;
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
  | 'revoke'
  | 'pay-after-revoke';

export interface StepRequest {
  world: World | null;
  action: { type: ActionType; approve?: boolean };
}

export interface StepResponse {
  world: World;
  payment?: PaymentOutcome;
  verification?: ReceiptVerification;
  error?: string;
}
