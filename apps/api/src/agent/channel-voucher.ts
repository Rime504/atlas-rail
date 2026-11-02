import {
  AgentMandate,
  GateAuthorization,
  MessageSigner,
  SignedDecision,
  agentMandateSchema,
  approvalSigners,
  evaluateGate,
  hashMandate,
  hashOffer,
  sha256Hex,
  toBase58,
} from '@atlas-rail/mandate';
import { timingSafeEqual } from 'node:crypto';
import { PrismaOwnerApprovalStore, PrismaVoucherSpendStore, generateUlid, prisma, type VoucherSpendStore } from '@atlas-rail/database';
import { OwnerApprovals, approvalTerms, escalationReason, telegramConfigFromEnv } from './owner-approvals';
import { DEFAULT_MANDATE_PROGRAM_ID, DevnetKeyring, decodeMandateAccount, findMandatePda } from '@atlas-rail/solana';
import {
  EscalationRequiredError,
  GatedSignerAdapter,
  MandateDeniedError,
  UnsupportedPaymentError,
  VoucherAuthorizer,
  VoucherRequest,
  encodeVoucherMessage,
  voucherOffer,
} from '@atlas-rail/x402';
import { checkBehaviour } from './behaviour';
import { z } from 'zod';

const requestSchema = z.object({
  mandate: agentMandateSchema,
  channelId: z.string().min(32).max(44),
  cumulativeAmount: z.string().regex(/^(0|[1-9][0-9]*)$/),
  settledAmount: z.string().regex(/^(0|[1-9][0-9]*)$/).optional(),
  /** Accepted so older clients still parse. Ignored: the settled amount is read from the channel account. */
  chainSettled: z.string().regex(/^(0|[1-9][0-9]*)$/).optional(),
  expiresAt: z.number().int().positive(),
  recipient: z.string().min(32).max(44),
  resourceUrl: z.string().min(1).max(500),
  asset: z.string().min(32).max(44),
  network: z.string().min(1).max(80),
  feePayer: z.string().min(32).max(44).nullable().optional(),
  /** The owner's approval for this exact voucher, from an earlier OwnerApprovalRequested answer. */
  approvalId: z.string().min(1).max(100).optional(),
  /** Can only add a revocation. The on-chain mandate account is always read as well. */
  revoked: z
    .object({
      revokedAt: z.number().int().nonnegative(),
      reason: z.string().max(500).nullable().optional(),
    })
    .nullable()
    .optional(),
});

export type ChannelVoucherBody = z.infer<typeof requestSchema>;

export type ChannelVoucherAnswer =
  | {
      signed: false;
      message: string;
      /** Plain-words reason when the payment needs the owner. */
      reason?: string;
      /** Set when the owner was asked on Telegram. Ask again with it once the owner approves. */
      approvalId?: string;
      expiresAt?: number;
    }
  | {
      signed: true;
      messageBase64: string;
      signatureBase64: string;
      messageHash: string;
      deltaAmount: string;
      decision: SignedDecision;
    };

export interface AskChannelVoucherDeps {
  instance?: MessageSigner;
  signerUrl?: string;
  fetch?: typeof fetch;
  clock?: () => number;
  token?: string | null;
  /** Reads the channel account. Tests inject this; the live ask uses devnet. */
  readChannel?: (channelId: string) => Promise<ChannelAccount | null>;
  /** Every voucher already signed. Tests and the local demo inject memory; the API uses Postgres. */
  spends?: VoucherSpendStore;
  /** Owner approvals on Telegram. Null keeps over-limit vouchers blocked. Default: from settings. */
  approvals?: OwnerApprovals | null;
  /** Reads the Atlas Mandate account by mandate hash (hex). Tests inject this; the live ask uses devnet. */
  readMandate?: (mandateHash: string) => Promise<OnChainMandate | null>;
}

/** The fields of the Atlas Mandate account the voucher ask relies on. */
export interface OnChainMandate {
  agent: string;
  mint: string;
  revoked: boolean;
  revokedAt: number;
}

/**
 * The voucher ask has no API key: a signed mandate sits inside every public receipt, so it cannot be
 * the credential. Callers present `Authorization: Bearer $ATLAS_VOUCHER_TOKEN`. Unset means the
 * endpoint stays closed. Returns null when the request may go on.
 */
export function voucherTokenProblem(header: string | undefined, token = process.env.ATLAS_VOUCHER_TOKEN): { status: 401 | 503; error: string } | null {
  if (!token) return { status: 503, error: 'Voucher endpoint is closed until ATLAS_VOUCHER_TOKEN is set' };
  const presented = Buffer.from(header?.startsWith('Bearer ') ? header.slice(7) : '', 'utf8');
  const expected = Buffer.from(token, 'utf8');
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    return { status: 401, error: 'Missing or wrong bearer token' };
  }
  return null;
}

let postgresSpends: VoucherSpendStore | null = null;
let settingsApprovals: OwnerApprovals | null | undefined;

/** Owner approvals only when TELEGRAM_BOT_TOKEN and TELEGRAM_OWNER_CHAT_ID are set. */
export function defaultApprovals(): OwnerApprovals | null {
  if (settingsApprovals === undefined) {
    const telegram = telegramConfigFromEnv();
    settingsApprovals = telegram
      ? new OwnerApprovals({
          store: new PrismaOwnerApprovalStore(prisma),
          telegram,
          clock: () => Math.floor(Date.now() / 1000),
          newId: generateUlid,
          signUrl: process.env.ATLAS_APPROVAL_URL?.trim() || undefined,
        })
      : null;
  }
  return settingsApprovals;
}

/** Spend memory in Postgres, so a restart or a second API process never resets the caps. */
function defaultSpends(): VoucherSpendStore {
  postgresSpends ??= new PrismaVoucherSpendStore(prisma);
  return postgresSpends;
}

/** The fields of a payment-channels `Channel` account the voucher ask relies on. */
export interface ChannelAccount {
  payer: string;
  payee: string;
  mint: string;
  settled: bigint;
}

function gateInstance(): MessageSigner {
  try {
    const keyring = DevnetKeyring.load();
    if (!keyring.publicKey('instance')) throw new Error('missing');
    return keyring.signer('instance');
  } catch {
    throw new Error('Gate is down');
  }
}

/**
 * The agent asks here. evaluateGate runs on the mandate in the body. The voucher key stays in the
 * signer process, one random key per mandate id. This function has no seed and does not sign the 50 bytes itself.
 */
export async function askChannelVoucher(input: unknown, deps: AskChannelVoucherDeps = {}): Promise<ChannelVoucherAnswer> {
  const body = requestSchema.parse(input);
  const signerUrl = (deps.signerUrl ?? process.env.ATLAS_SIGNER_URL ?? 'http://127.0.0.1:3012').replace(/\/$/, '');
  const doFetch = deps.fetch ?? fetch;
  const token = deps.token === undefined ? process.env.ATLAS_SIGNER_TOKEN || undefined : deps.token || undefined;
  const signer = await remoteVoucherSigner(signerUrl, token, doFetch, body.mandate.id, body.mandate.agent.publicKey);

  // The settled watermark comes from the chain, never from the caller: the gate scores only the
  // slice above it, so a caller-chosen watermark would let a large voucher pass as a small one.
  const channel = await (deps.readChannel ?? readChannelAccount)(body.channelId);
  if (!channel) return { signed: false, message: 'ChannelNotFound' };
  // The gate checks `recipient` against the allowlist, but settlement pays the channel payee.
  if (channel.payee !== body.recipient) return { signed: false, message: 'RecipientIsNotChannelPayee' };
  if (channel.mint !== body.asset) return { signed: false, message: 'AssetIsNotChannelMint' };
  // Revocation comes from the chain. The caller's `revoked` field can only add one.
  const onChain = await (deps.readMandate ?? readMandateAccount)(hashMandate(body.mandate));
  if (!onChain) return { signed: false, message: 'MandateNotOnChain' };
  if (onChain.agent !== body.mandate.agent.publicKey) return { signed: false, message: 'MandateAgentMismatch' };
  const revoked = onChain.revoked
    ? { revokedAt: onChain.revokedAt, reason: 'revoked on-chain' }
    : body.revoked
      ? { revokedAt: body.revoked.revokedAt, reason: body.revoked.reason ?? null }
      : null;
  const channelPayer = body.feePayer ? channel.payer : null;
  const instance = deps.instance ?? gateInstance();
  const clock = deps.clock ?? (() => Math.floor(Date.now() / 1000));
  const spends = deps.spends ?? defaultSpends();
  const mandateHash = hashMandate(body.mandate);
  const approvals = deps.approvals === undefined ? defaultApprovals() : deps.approvals;
  let subjectHash: string;
  try {
    // The exact voucher bytes an approval is bound to.
    subjectHash = sha256Hex(encodeVoucherMessage({ channelId: body.channelId, cumulativeAmount: BigInt(body.cumulativeAmount), expiresAt: BigInt(body.expiresAt) }));
  } catch (error) {
    return { signed: false, message: error instanceof Error ? error.name : 'UnsupportedPaymentError' };
  }
  const request: VoucherRequest = {
    channelId: body.channelId,
    cumulativeAmount: body.cumulativeAmount,
    settledAmount: body.settledAmount,
    expiresAt: body.expiresAt,
    recipient: body.recipient,
    resourceUrl: body.resourceUrl,
    asset: body.asset,
    network: body.network,
    feePayer: body.feePayer ?? null,
  };
  try {
    // Check and record under one lock per mandate (a Postgres advisory lock across processes), so two
    // asks can never both fit under a cap, and a restart starts from every voucher already signed.
    return await spends.runExclusive(`voucher:${mandateHash}`, async () => {
      const spend = await spends.totals(mandateHash, clock(), body.mandate.scope.limits.windowSeconds);
      // The gate scores the slice above the highest voucher already signed for this channel, or
      // above the chain's settled amount when that is higher.
      const signedWatermark = await spends.channelWatermark(mandateHash, body.channelId);
      const watermark = signedWatermark !== null && signedWatermark > channel.settled ? signedWatermark : channel.settled;
      // An owner approval is used once, for exactly these voucher bytes, before the gate runs.
      let approval = null;
      let review = null;
      if (body.approvalId) {
        const used = approvals ? await approvals.consume(body.approvalId, { kind: 'voucher', mandateHash, subjectHash }) : null;
        const role = used ? OwnerApprovals.signerRole(used) : null;
        if (!used || !used.ownerSignature || !role) return { signed: false as const, message: 'OwnerApprovalNotValid', reason: "The owner's wallet has not signed this exact payment, or the approval was already used or expired." };
        // The gate checks the wallet signature again; the signed decision, and so the receipt, carries it.
        approval = {
          id: used.id,
          offerHash: used.offerHash,
          status: 'APPROVED' as const,
          expiresAt: used.expiresAt,
          approver: { userId: used.decidedBy ?? `wallet:${used.ownerSignature.signer}`, role },
          terms: approvalTerms(used),
          ownerSignature: used.ownerSignature,
        };
        review = { reason: used.reason, approvalId: used.id, approvedBy: used.decidedBy };
      } else {
        // "Is this normal for this agent?" Only for a payment the mandate would allow on its own.
        const delta = BigInt(body.cumulativeAmount) - watermark;
        const offer = delta > 0n ? voucherOffer(request, delta) : null;
        const wouldAllow = offer !== null && evaluateGate(body.mandate, offer, {
          now: clock(), revoked, channelPayer, spend, simulation: null, requireSimulation: false, approval: null,
        }).decision === 'ALLOW';
        if (offer && wouldAllow) {
          const history = (await spends.list(mandateHash)).map((row) => ({ amount: BigInt(row.delta), recipient: row.recipient, at: row.createdAt }));
          const flags = checkBehaviour(history, { amount: delta, recipient: body.recipient, at: clock() });
          if (flags.length > 0) {
            const reason = flags.map((flag) => flag.reason).join(' ');
            if (!approvals?.enabled) return { signed: false as const, message: 'BehaviourCheckBlocked', reason };
            const asked = await approvals.request({
              kind: 'voucher', mandateHash, subjectHash, offerHash: hashOffer(offer), amount: delta.toString(),
              recipient: body.recipient, agent: body.mandate.agent.publicKey, reason, ttlSeconds: body.mandate.escalation.approvalTtlSeconds,
              signers: approvalSigners(body.mandate),
            });
            return { signed: false as const, message: 'OwnerApprovalRequested', reason, approvalId: asked.id, expiresAt: asked.expiresAt };
          }
        }
      }
      const authorizer = new VoucherAuthorizer({
        mandate: body.mandate,
        instance,
        signer,
        organizationId: body.mandate.issuer.organizationId,
        clock,
        spend,
        revoked,
        channelPayer,
        approval,
        review,
        settledWatermark: async () => watermark,
      });
      const allowed = await authorizer.requestVoucher(request);
      // Recorded before the signature leaves this process: if this write fails, the caller never gets it.
      await spends.record({
        id: generateUlid('vsp'),
        mandateHash,
        channelId: body.channelId,
        cumulative: body.cumulativeAmount,
        delta: allowed.deltaAmount,
        autonomous: allowed.decision.record.kind === 'AUTONOMOUS',
        recipient: body.recipient,
        messageHash: allowed.messageHash,
        createdAt: clock(),
      });
      return {
        signed: true as const,
        messageBase64: Buffer.from(allowed.message).toString('base64'),
        signatureBase64: Buffer.from(allowed.signature).toString('base64'),
        messageHash: allowed.messageHash,
        deltaAmount: allowed.deltaAmount,
        decision: allowed.decision,
      };
    });
  } catch (error) {
    // ESCALATE is never signed here. With Telegram configured the owner is asked about this exact
    // voucher; without it, over-limit vouchers stay blocked.
    if (error instanceof EscalationRequiredError) {
      const reason = escalationReason(error.decision.record.rulesEvaluated);
      if (!approvals?.enabled || body.approvalId) return { signed: false, message: error.name, reason };
      const asked = await approvals.request({
        kind: 'voucher',
        mandateHash,
        subjectHash,
        offerHash: error.decision.record.offerHash,
        amount: error.decision.record.offer.amount,
        recipient: body.recipient,
        agent: body.mandate.agent.publicKey,
        reason,
        ttlSeconds: body.mandate.escalation.approvalTtlSeconds,
        signers: approvalSigners(body.mandate),
      });
      return { signed: false, message: 'OwnerApprovalRequested', reason, approvalId: asked.id, expiresAt: asked.expiresAt };
    }
    if (error instanceof MandateDeniedError || error instanceof UnsupportedPaymentError) {
      return { signed: false, message: error.name };
    }
    throw error;
  }
}

/** payment-channels `Channel`: discriminator 1, settled u64 at byte 20, payer 88, payee 120, mint 184. */
const CHANNEL_PROGRAM_ID = 'CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX';
const CHANNEL_DISCRIMINATOR = 1;
const CHANNEL_SETTLED_OFFSET = 20;
const CHANNEL_PAYER_OFFSET = 88;
const CHANNEL_PAYEE_OFFSET = 120;
const CHANNEL_MINT_OFFSET = 184;

/** Null when the account is missing or is not a payment-channels channel. Throws when the RPC cannot answer. */
async function readChannelAccount(channelId: string): Promise<ChannelAccount | null> {
  const rpc = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
  let response: Response;
  try {
    response = await fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getAccountInfo',
        params: [channelId, { encoding: 'base64', commitment: 'confirmed' }],
      }),
    });
  } catch {
    throw new Error('Solana RPC is down');
  }
  if (!response.ok) throw new Error('Solana RPC is down');
  const json = (await response.json()) as { result?: { value?: { owner?: string; data?: [string, string] | null } | null } };
  if (!json.result) throw new Error('Solana RPC is down');
  const value = json.result.value;
  const encoded = value?.data?.[0];
  if (!value || value.owner !== CHANNEL_PROGRAM_ID || typeof encoded !== 'string') return null;
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length < CHANNEL_MINT_OFFSET + 32 || bytes[0] !== CHANNEL_DISCRIMINATOR) return null;
  const key = (offset: number) => toBase58(bytes.subarray(offset, offset + 32));
  return {
    payer: key(CHANNEL_PAYER_OFFSET),
    payee: key(CHANNEL_PAYEE_OFFSET),
    mint: key(CHANNEL_MINT_OFFSET),
    settled: bytes.readBigUInt64LE(CHANNEL_SETTLED_OFFSET),
  };
}

/** Null when no Atlas Mandate account exists at the mandate's PDA. Throws when the RPC cannot answer. */
export async function readMandateAccount(mandateHash: string): Promise<OnChainMandate | null> {
  const rpc = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
  const programId = process.env.MANDATE_PROGRAM_ID || DEFAULT_MANDATE_PROGRAM_ID;
  const { address } = findMandatePda(programId, Buffer.from(mandateHash, 'hex'));
  let response: Response;
  try {
    response = await fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [address, { encoding: 'base64', commitment: 'confirmed' }] }),
    });
  } catch {
    throw new Error('Solana RPC is down');
  }
  if (!response.ok) throw new Error('Solana RPC is down');
  const json = (await response.json()) as { result?: { value?: { owner?: string; data?: [string, string] | null } | null } };
  if (!json.result) throw new Error('Solana RPC is down');
  const value = json.result.value;
  const encoded = value?.data?.[0];
  if (!value || value.owner !== programId || typeof encoded !== 'string') return null;
  try {
    const account = decodeMandateAccount(Buffer.from(encoded, 'base64'));
    return { agent: account.agent, mint: account.mint, revoked: account.revoked, revokedAt: Number(account.revokedAt) };
  } catch {
    return null;
  }
}

async function voucherPublicKey(
  signerUrl: string,
  headers: Record<string, string>,
  doFetch: typeof fetch,
  mandateId: string,
): Promise<string> {
  let listed: Response;
  try {
    listed = await doFetch(`${signerUrl}/v1/voucher-key?mandateId=${encodeURIComponent(mandateId)}`, { headers });
  } catch {
    throw new Error('Signer is down');
  }
  if (listed.ok) {
    const key = (await listed.json()) as { publicKey?: unknown };
    if (typeof key.publicKey !== 'string') throw new Error('Signer is down');
    return key.publicKey;
  }
  const missing = (await listed.json().catch(() => ({}))) as { error?: unknown };
  if (listed.status !== 404 || missing.error !== 'Not found') throw new Error('Mandate agent is not the voucher signer');
  try {
    listed = await doFetch(`${signerUrl}/v1/public-key`, { headers });
  } catch {
    throw new Error('Signer is down');
  }
  if (!listed.ok) throw new Error('Signer is down');
  const key = (await listed.json()) as { publicKey?: unknown };
  if (typeof key.publicKey !== 'string') throw new Error('Signer is down');
  return key.publicKey;
}

async function remoteVoucherSigner(
  signerUrl: string,
  token: string | undefined,
  doFetch: typeof fetch,
  mandateId: string,
  agentPublicKey: string,
): Promise<GatedSignerAdapter> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const publicKey = await voucherPublicKey(signerUrl, headers, doFetch, mandateId);
  if (publicKey !== agentPublicKey) throw new Error('Mandate agent is not the voucher signer');
  return {
    publicKey,
    async signVoucherWithAuthorization(
      message: Uint8Array,
      authorization: GateAuthorization | null,
      decision: SignedDecision | null,
      mandate: AgentMandate | null,
    ) {
      const response = await doFetch(`${signerUrl}/v1/sign-voucher`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          messageBase64: Buffer.from(message).toString('base64'),
          authorization,
          decision,
          mandate,
        }),
      });
      const json = (await response.json().catch(() => ({}))) as { signatureBase64?: unknown };
      if (!response.ok || typeof json.signatureBase64 !== 'string') throw new Error('Signer refused the voucher');
      const signature = Buffer.from(json.signatureBase64, 'base64');
      if (signature.length !== 64) throw new Error('Signer is down');
      return { signature: new Uint8Array(signature) };
    },
  } as GatedSignerAdapter;
}
