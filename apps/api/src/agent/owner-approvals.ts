import type { OwnerApprovalRecord, OwnerApprovalStore } from '@atlas-rail/database';
import {
  SIGNATURE_SCHEME,
  ownerApprovalText,
  verifyOwnerApproval,
  type ApprovalSigner,
  type OwnerApprovalSignature,
  type OwnerApprovalTerms,
} from '@atlas-rail/mandate';

/**
 * Owner approvals, signed by the owner's or an approver's wallet. An over-limit (or unusual) payment
 * creates one request bound to that exact payment. The owner's or an approver's wallet signs the
 * request's terms (amount, recipient, request hash, offer hash, expiry); only a valid signature from a
 * key in the mandate approves it, and only once. The agent key can never sign one, and a server, a bot
 * or a Telegram tap cannot approve on its own: Telegram only tells the owner there is something to sign.
 * No signature before `expiresAt` counts as rejected.
 */

export interface TelegramConfig {
  /** `TELEGRAM_BOT_TOKEN`. Secret: read from settings, never logged. */
  token: string;
  /** `TELEGRAM_OWNER_CHAT_ID`: the chat that gets the notification. */
  ownerChatId: string;
  /** Defaults to https://api.telegram.org. The local demo points this at a stand-in. */
  apiBase?: string;
}

/** Null unless both settings are present: over-limit approvals stay off by default. */
export function telegramConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TelegramConfig | null {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const ownerChatId = env.TELEGRAM_OWNER_CHAT_ID?.trim();
  if (!token || !ownerChatId) return null;
  return { token, ownerChatId, apiBase: env.TELEGRAM_API_BASE?.trim() || undefined };
}

export interface ApprovalRequestInput {
  kind: OwnerApprovalRecord['kind'];
  mandateHash: string;
  subjectHash: string;
  offerHash: string;
  amount: string;
  recipient: string;
  agent: string;
  reason: string;
  ttlSeconds: number;
  /** The mandate's owner and approver keys that may sign (`approvalSigners(mandate)`). */
  signers: ApprovalSigner[];
}

export interface OwnerApprovalsDeps {
  store: OwnerApprovalStore;
  telegram: TelegramConfig | null;
  clock: () => number;
  newId: (prefix: string) => string;
  fetch?: typeof fetch;
  /** Where the owner signs, for example `https://playground.example/approve`. The id is appended. */
  signUrl?: string;
}

export function approvalTerms(approval: OwnerApprovalRecord): OwnerApprovalTerms {
  return {
    approvalId: approval.id,
    mandateHash: approval.mandateHash,
    kind: approval.kind,
    amount: approval.amount,
    recipient: approval.recipient,
    requestHash: approval.subjectHash,
    offerHash: approval.offerHash,
    expiresAt: approval.expiresAt,
  };
}

/** What the owner sees on Telegram. Plain words; it approves nothing by itself. */
export function approvalMessage(approval: OwnerApprovalRecord, now: number, signUrl?: string): string {
  const minutes = Math.max(1, Math.round((approval.expiresAt - now) / 60));
  return [
    'Atlas Rail needs your signature for one payment.',
    `Amount: ${approval.amount} (token base units)`,
    `To: ${approval.recipient}`,
    `Agent: ${approval.agent}`,
    `Why: ${approval.reason}`,
    signUrl ? `Sign it with your wallet: ${signUrl.replace(/\/$/, '')}/${approval.id}` : `Sign it with your wallet: atlas approve ${approval.id}`,
    `Sign within ${minutes} min. No signature = rejected. This approves this one payment only.`,
  ].join('\n');
}

export type SignResult = { ok: true; approval: OwnerApprovalRecord } | { ok: false; reason: string };

export class OwnerApprovals {
  private readonly doFetch: typeof fetch;

  constructor(private readonly deps: OwnerApprovalsDeps) {
    this.doFetch = deps.fetch ?? fetch;
  }

  /** Over-limit approvals exist only when Telegram is configured, so the owner hears about them. */
  get enabled(): boolean {
    return this.deps.telegram !== null;
  }

  /** Reuses a live pending request for the same exact payment instead of notifying twice. */
  async request(input: ApprovalRequestInput): Promise<OwnerApprovalRecord> {
    if (!this.deps.telegram) throw new Error('Owner approvals are off: Telegram is not configured');
    const now = this.deps.clock();
    const existing = await this.deps.store.findBySubject(input.subjectHash);
    if (existing && existing.status === 'PENDING' && now < existing.expiresAt) return existing;
    const approval: OwnerApprovalRecord = {
      id: this.deps.newId('own'),
      kind: input.kind,
      mandateHash: input.mandateHash,
      subjectHash: input.subjectHash,
      offerHash: input.offerHash,
      amount: input.amount,
      recipient: input.recipient,
      agent: input.agent,
      reason: input.reason,
      status: 'PENDING',
      createdAt: now,
      expiresAt: now + input.ttlSeconds,
      decidedAt: null,
      decidedBy: null,
      telegramMessageId: null,
      signers: input.signers.filter((s) => s.publicKey !== input.agent),
      ownerSignature: null,
    };
    await this.deps.store.create(approval);
    const sent = await this.call<{ message_id: number }>('sendMessage', {
      chat_id: this.deps.telegram.ownerChatId,
      text: approvalMessage(approval, now, this.deps.signUrl),
    }).catch(() => null);
    if (sent?.message_id) await this.deps.store.setTelegramMessage(approval.id, sent.message_id);
    return approval;
  }

  /** The record, with a pending request past its deadline shown as rejected. */
  async get(id: string): Promise<OwnerApprovalRecord | null> {
    const approval = await this.deps.store.get(id);
    if (approval && approval.status === 'PENDING' && this.deps.clock() >= approval.expiresAt) {
      return { ...approval, status: 'REJECTED', decidedBy: 'timeout' };
    }
    return approval;
  }

  /** What the wallet signs for this request, and who may sign it. */
  async toSign(id: string): Promise<{ approval: OwnerApprovalRecord; terms: OwnerApprovalTerms; message: string } | null> {
    const approval = await this.get(id);
    if (!approval) return null;
    const terms = approvalTerms(approval);
    return { approval, terms, message: ownerApprovalText(terms) };
  }

  /**
   * The owner's or an approver's wallet signature. Approves the request only if the signer is one of
   * the mandate's owner or approver keys (never the agent), the signature covers exactly these terms,
   * and the request is still pending and not expired.
   */
  async submitSignature(id: string, signature: OwnerApprovalSignature): Promise<SignResult> {
    const approval = await this.deps.store.get(id);
    if (!approval) return { ok: false, reason: 'No such approval request.' };
    const now = this.deps.clock();
    if (approval.status !== 'PENDING') return { ok: false, reason: `This request is already ${approval.status.toLowerCase()}.` };
    const checked = verifyOwnerApproval(approvalTerms(approval), signature, { signers: approval.signers, agentPublicKey: approval.agent, now });
    if (!checked.ok) return { ok: false, reason: `Signature not accepted: ${checked.reason}.` };
    const ownerSignature = { scheme: SIGNATURE_SCHEME, signer: signature.signer, signature: signature.signature };
    const moved = await this.deps.store.transition(id, 'PENDING', 'APPROVED', { decidedAt: now, decidedBy: `wallet:${signature.signer}`, ownerSignature });
    if (!moved) return { ok: false, reason: 'This request is no longer open.' };
    await this.notifyDecision(approval, now, `Signed by ${checked.signer.role.toLowerCase()} ${signature.signer}. The agent may make this one payment.`);
    return { ok: true, approval: { ...approval, status: 'APPROVED', decidedAt: now, decidedBy: `wallet:${signature.signer}`, ownerSignature } };
  }

  /**
   * Uses an approval once, for exactly the payment it was given for. Null when it is not signed,
   * expired, for another payment, already used, or its stored signature no longer verifies.
   */
  async consume(id: string, expected: { kind: OwnerApprovalRecord['kind']; mandateHash: string; subjectHash: string }): Promise<OwnerApprovalRecord | null> {
    const approval = await this.deps.store.get(id);
    if (!approval || approval.status !== 'APPROVED' || !approval.ownerSignature) return null;
    if (approval.kind !== expected.kind || approval.mandateHash !== expected.mandateHash || approval.subjectHash !== expected.subjectHash) return null;
    const now = this.deps.clock();
    const checked = verifyOwnerApproval(approvalTerms(approval), approval.ownerSignature, { signers: approval.signers, agentPublicKey: approval.agent, now });
    if (!checked.ok) return null;
    return (await this.deps.store.transition(id, 'APPROVED', 'CONSUMED')) ? approval : null;
  }

  /** The role of the key that signed, as the gate needs it. */
  static signerRole(approval: OwnerApprovalRecord): 'OWNER' | 'APPROVER' | null {
    return approval.signers.find((s) => s.publicKey === approval.ownerSignature?.signer)?.role ?? null;
  }

  private async notifyDecision(approval: OwnerApprovalRecord, now: number, text: string): Promise<void> {
    if (!this.deps.telegram || !approval.telegramMessageId) return;
    await this.call('editMessageText', {
      chat_id: this.deps.telegram.ownerChatId,
      message_id: approval.telegramMessageId,
      text: `${approvalMessage(approval, now, this.deps.signUrl)}\n\n${text}`,
    }).catch(() => undefined);
  }

  private async call<T>(method: string, body: unknown): Promise<T | null> {
    const telegram = this.deps.telegram;
    if (!telegram) return null;
    const base = (telegram.apiBase ?? 'https://api.telegram.org').replace(/\/$/, '');
    const response = await this.doFetch(`${base}/bot${telegram.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await response.json().catch(() => ({}))) as { ok?: boolean; result?: T };
    if (!response.ok || !json.ok) throw new Error(`Telegram ${method} failed`);
    return json.result ?? null;
  }
}

/** Plain-words reason for an escalated decision, from the rules that asked for a person. */
export function escalationReason(rules: Array<{ status: string; id: string; message: string }>): string {
  const asked = rules.filter((rule) => rule.status === 'ESCALATE');
  if (asked.length === 0) return 'This payment needs the owner.';
  const plain: Record<string, string> = {
    WINDOW_BUDGET: 'It would go over the daily budget.',
    ESCALATION_THRESHOLD: 'It is above the amount the agent may pay alone.',
    PRICE_LIMIT: 'The price is higher than expected for this service.',
    RESOURCE_ALLOWED: 'This service always needs the owner.',
  };
  return asked.map((rule) => plain[rule.id] ?? rule.message).join(' ');
}
