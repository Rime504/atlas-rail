import { utf8ToBytes } from '@noble/hashes/utils';
import { SIGNATURE_SCHEME, verifyEd25519, type SignatureScheme } from './crypto';
import type { AgentMandate } from './schema';

/**
 * Owner-signed approval of one exact payment. The owner's or an approver's wallet signs a short,
 * readable text that names the payment; the gate checks that signature before an approval can
 * override an approvable rule. A Telegram tap, a server, or the agent can never approve on its own.
 */

/** Everything the signature binds. Any change to any field makes the signature fail. */
export interface OwnerApprovalTerms {
  approvalId: string;
  mandateHash: string;
  /** `voucher` for the channel voucher ask, `pay` for the pay.sh spending authority. */
  kind: string;
  /** Token base units. */
  amount: string;
  recipient: string;
  /** Hash of the exact request: the voucher bytes, or the pay.sh request fingerprint. */
  requestHash: string;
  /** Hash of the exact offer the gate scores. */
  offerHash: string;
  /** Epoch seconds. */
  expiresAt: number;
}

export interface OwnerApprovalSignature {
  scheme: SignatureScheme;
  /** Base58 public key of the wallet that signed. */
  signer: string;
  /** Base58 signature over `ownerApprovalMessage(terms)`. */
  signature: string;
}

export interface ApprovalSigner {
  publicKey: string;
  role: 'OWNER' | 'APPROVER';
}

export const OWNER_APPROVAL_HEADER = 'atlasrail/v0.1/owner-approval';

/**
 * The exact bytes a wallet signs, written so a person can read them in the wallet's signing prompt.
 * Fixed field order, one per line, UTF-8, no trailing newline.
 */
export function ownerApprovalText(terms: OwnerApprovalTerms): string {
  return [
    OWNER_APPROVAL_HEADER,
    'I approve this one payment, once.',
    `Approval: ${terms.approvalId}`,
    `Mandate: ${terms.mandateHash}`,
    `Kind: ${terms.kind}`,
    `Amount: ${terms.amount} base units`,
    `Recipient: ${terms.recipient}`,
    `Request: ${terms.requestHash}`,
    `Offer: ${terms.offerHash}`,
    `Expires: ${terms.expiresAt} (${new Date(terms.expiresAt * 1000).toISOString()})`,
    `Scheme: ${SIGNATURE_SCHEME}`,
  ].join('\n');
}

export function ownerApprovalMessage(terms: OwnerApprovalTerms): Uint8Array {
  return utf8ToBytes(ownerApprovalText(terms));
}

/**
 * Who may sign an approval for this mandate: the OWNER and APPROVER keys of its delegation chain,
 * when the mandate lets that role approve. Never the agent key, even if it also appears elsewhere.
 */
export function approvalSigners(mandate: Pick<AgentMandate, 'delegationChain' | 'escalation' | 'agent'>): ApprovalSigner[] {
  const allowed = mandate.escalation.approverRoles as readonly string[];
  return mandate.delegationChain
    .filter((link): link is typeof link & { role: 'OWNER' | 'APPROVER' } => link.role === 'OWNER' || link.role === 'APPROVER')
    .filter((link) => allowed.includes(link.role))
    .filter((link) => link.publicKey !== mandate.agent.publicKey)
    .map((link) => ({ publicKey: link.publicKey, role: link.role }));
}

export type OwnerApprovalCheck = { ok: true; signer: ApprovalSigner } | { ok: false; reason: string };

/** Checks one signature against the terms and the allowed signers. Never throws. */
export function verifyOwnerApproval(
  terms: OwnerApprovalTerms,
  signature: OwnerApprovalSignature,
  options: { signers: readonly ApprovalSigner[]; agentPublicKey: string; now: number },
): OwnerApprovalCheck {
  if (signature.scheme !== SIGNATURE_SCHEME) return { ok: false, reason: `signature scheme ${String(signature.scheme)} is not supported` };
  if (signature.signer === options.agentPublicKey) return { ok: false, reason: 'the agent cannot approve its own payment' };
  const signer = options.signers.find((s) => s.publicKey === signature.signer);
  if (!signer) return { ok: false, reason: 'signer is not an owner or approver of this mandate' };
  if (options.now >= terms.expiresAt) return { ok: false, reason: 'approval has expired' };
  if (!verifyEd25519(signature.signer, ownerApprovalMessage(terms), signature.signature)) {
    return { ok: false, reason: 'signature does not match this exact payment' };
  }
  return { ok: true, signer };
}
