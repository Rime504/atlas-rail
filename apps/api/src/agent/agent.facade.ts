import { Inject, Injectable, Logger } from '@nestjs/common';
import { prisma, generateUlid, PrismaAgentStore, PrismaReceiptStore } from '@atlas-rail/database';
import { WEBHOOK_EVENT_TYPES, WebhookEventType, envBoolean } from '@atlas-rail/config';
import {
  AgentEvent,
  AgentGateService,
  AgentServiceError,
  MandateLifecycleService,
  MandateRecord,
  StoredDecision,
  effectiveMandateStatus,
  verifyMandateChain,
} from '@atlas-rail/mandate';
import { AnchorService, ReceiptService } from '@atlas-rail/receipt';
import {
  ChainClient,
  ChainPaymentSimulator,
  DevnetKeyring,
  DevnetKeypairSigner,
  buildCreateMandateTransaction,
  buildRevokeMandateTransaction,
  fetchMandateAccount,
  findMandatePda,
} from '@atlas-rail/solana';
import { QueueService } from '../common/queue.service';
import { AGENT_CHAIN, AGENT_KEYRING } from './agent.tokens';

/**
 * True when the on-chain mandate registry (Milestone B) is turned on. Off by default. Parsed the
 * same way `validateEnv` parses every other boolean flag (accepts "1"/"true"/"yes"/"on", rejects
 * anything unrecognised as false) so this can't silently diverge from how ATLAS_ONCHAIN behaves
 * everywhere else it's read.
 */
function onchainEnabled(): boolean {
  const result = envBoolean.safeParse(process.env.ATLAS_ONCHAIN);
  return result.success && result.data === true;
}

/** Same pattern as {@link onchainEnabled}. Switches anchoring from an SPL Memo to the mandate
 * registry's `anchor_root` instruction. Only meaningful when `onchainEnabled()` is also true. */
function anchorRootEnabled(): boolean {
  const result = envBoolean.safeParse(process.env.ATLAS_ANCHOR_ROOT);
  return result.success && result.data === true;
}

function mandateProgramId(): string {
  return process.env.MANDATE_PROGRAM_ID ?? 'CnGoTE5Bxc8MFGaeK5LDv5uAZ7pNiktMunYy8JZcLY4k';
}

function solanaRpcUrl(): string {
  return process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
}

export interface OnChainMandateResult {
  address: string;
  txSignature: string;
}

const EVENT_TO_WEBHOOK: Record<AgentEvent['type'], WebhookEventType> = {
  'agent.mandate.created': WEBHOOK_EVENT_TYPES.AGENT_MANDATE_CREATED,
  'agent.mandate.activated': WEBHOOK_EVENT_TYPES.AGENT_MANDATE_ACTIVATED,
  'agent.mandate.revoked': WEBHOOK_EVENT_TYPES.AGENT_MANDATE_REVOKED,
  'agent.decision.allow': WEBHOOK_EVENT_TYPES.AGENT_DECISION_ALLOW,
  'agent.decision.deny': WEBHOOK_EVENT_TYPES.AGENT_DECISION_DENY,
  'agent.decision.escalate': WEBHOOK_EVENT_TYPES.AGENT_DECISION_ESCALATE,
  'agent.approval.requested': WEBHOOK_EVENT_TYPES.AGENT_APPROVAL_REQUESTED,
  'agent.approval.decided': WEBHOOK_EVENT_TYPES.AGENT_APPROVAL_DECIDED,
  'agent.receipt.issued': WEBHOOK_EVENT_TYPES.AGENT_RECEIPT_ISSUED,
};

const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * Wires the framework-free mandate, gate, receipt and anchor services to Postgres, the devnet
 * keyring and the configured cluster. Controllers stay thin: authenticate, authorise, call this.
 */
@Injectable()
export class AgentFacade {
  private readonly logger = new Logger('AgentFacade');
  readonly store = new PrismaAgentStore(prisma);
  readonly receipts = new PrismaReceiptStore(prisma);
  readonly instanceSigner: DevnetKeypairSigner;
  readonly gate: AgentGateService;
  readonly lifecycle: MandateLifecycleService;
  readonly receiptService: ReceiptService;
  readonly anchorService: AnchorService;

  constructor(
    @Inject(AGENT_CHAIN) readonly chain: ChainClient,
    @Inject(AGENT_KEYRING) readonly keyring: DevnetKeyring,
    private readonly queue: QueueService,
  ) {
    this.instanceSigner = keyring.signer('instance');
    const clock = nowSeconds;
    const newId = (prefix: string) => generateUlid(prefix);
    const notify = (event: AgentEvent) => this.dispatch(event);

    this.gate = new AgentGateService({
      store: this.store,
      instanceSigner: this.instanceSigner,
      simulator: new ChainPaymentSimulator(chain),
      clock,
      newId,
      notify,
      requireSimulation: process.env.AGENT_REQUIRE_SIMULATION !== 'false',
      onchainRevocationCheck: onchainEnabled() ? (mandateHash) => this.checkOnChainRevocation(mandateHash) : undefined,
    });
    this.lifecycle = new MandateLifecycleService({ store: this.store, clock, notify });
    this.receiptService = new ReceiptService({
      store: this.store,
      receipts: this.receipts,
      chain,
      instanceSigner: this.instanceSigner,
      clock,
      newId,
      notify,
    });
    this.anchorService = new AnchorService({
      receipts: this.receipts,
      chain,
      signer: this.instanceSigner,
      clock,
      newId,
      mode: onchainEnabled() && anchorRootEnabled() ? 'root' : 'memo',
      rpcUrl: solanaRpcUrl(),
      programId: mandateProgramId(),
    });
    this.logger.log(`Instance attestation key: ${this.instanceSigner.publicKey}`);
  }

  now(): number {
    return nowSeconds();
  }

  /** Best-effort webhook fan-out: a queue outage must never block or change a decision. */
  private async dispatch(event: AgentEvent): Promise<void> {
    const type = EVENT_TO_WEBHOOK[event.type];
    try {
      await Promise.race([
        this.queue.dispatchWebhookEvent(event.organizationId, type, event.payload),
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error('webhook dispatch timed out')), 1500)),
      ]);
    } catch (error) {
      this.logger.warn(`Webhook dispatch for ${event.type} skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** The signer that signs on behalf of a console user (demo custody; production: HSM / WebAuthn adapter). */
  async userSigner(userId: string): Promise<DevnetKeypairSigner> {
    const existing = await prisma.userSigningKey.findUnique({ where: { userId } });
    if (existing) {
      const signer = this.keyring.signerByPublicKey(existing.publicKey);
      if (!signer) throw new AgentServiceError('INVALID_STATE', 'This user’s signing key is not available in the devnet keyring');
      return signer;
    }
    const signer = this.keyring.signer(`user:${userId}`);
    await prisma.userSigningKey.create({
      data: { id: generateUlid('usk'), userId, publicKey: signer.publicKey, label: 'devnet demo key' },
    });
    return signer;
  }

  /**
   * Behind `ATLAS_ONCHAIN=1`: does the on-chain mandate account say revoked? Returns `null` (not
   * revoked, as far as this check can tell) if the account doesn't exist yet or the RPC call fails —
   * a chain-read hiccup must never block a payment the database considers valid; only a *positive*
   * on-chain revocation overrides the database (see {@link GateServiceOptions.onchainRevocationCheck}).
   */
  private async checkOnChainRevocation(mandateHashHex: string): Promise<{ revokedAt: number; reason: string | null } | null> {
    try {
      const { address } = findMandatePda(mandateProgramId(), Buffer.from(mandateHashHex, 'hex'));
      const account = await fetchMandateAccount(process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com', address);
      if (!account || !account.revoked) return null;
      return { revokedAt: Number(account.revokedAt), reason: 'Mandate is revoked on-chain' };
    } catch (error) {
      this.logger.warn(`On-chain revocation check failed, falling back to the database: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Behind `ATLAS_ONCHAIN=1`: registers a newly-activated mandate on-chain (`create_mandate`), signed
   * by the owner, approver and agent — the same devnet-custody keys that produced the off-chain
   * delegation chain (see {@link userSigner}). Best-effort: on any failure this logs and returns
   * `null` rather than throwing, so the off-chain mandate (already ACTIVE) is never rolled back or
   * blocked by an on-chain hiccup, per the "existing demo always works" rule.
   */
  async anchorMandateOnChain(record: MandateRecord): Promise<OnChainMandateResult | null> {
    if (!onchainEnabled()) return null;
    try {
      const { mandate } = record;
      const ownerLink = mandate.delegationChain.find((l) => l.role === 'OWNER');
      const approverLink = mandate.delegationChain.find((l) => l.role === 'APPROVER');
      if (!ownerLink || !approverLink) throw new Error('mandate is missing an OWNER or APPROVER link');
      const ownerSigner = this.keyring.signerByPublicKey(ownerLink.publicKey);
      const approverSigner = this.keyring.signerByPublicKey(approverLink.publicKey);
      const agentSigner = this.keyring.signerByPublicKey(mandate.agent.publicKey);
      if (!ownerSigner || !approverSigner || !agentSigner) {
        throw new Error('owner, approver or agent signing key is not available in the devnet keyring');
      }

      const programId = mandateProgramId();
      const mandateHashBytes = Buffer.from(record.mandateHash, 'hex');
      const latest = await this.chain.getLatestBlockhash();
      const unsigned = buildCreateMandateTransaction({
        programId,
        mandateHash: mandateHashBytes,
        gateAuthority: this.instanceSigner.publicKey,
        mint: mandate.scope.limits.mint,
        maxPerPayment: BigInt(mandate.scope.limits.maxPerPayment),
        maxPerWindow: BigInt(mandate.scope.limits.maxPerWindow),
        windowSeconds: BigInt(mandate.scope.limits.windowSeconds),
        maxTotal: BigInt(mandate.scope.limits.maxTotal),
        escalationThreshold: BigInt(mandate.escalation.thresholdBaseUnits),
        notBefore: BigInt(mandate.notBefore),
        expiresAt: BigInt(mandate.expiresAt),
        owner: ownerLink.publicKey,
        approver: approverLink.publicKey,
        agent: mandate.agent.publicKey,
        recentBlockhash: latest.blockhash,
      });
      let signed = (await ownerSigner.signTransaction(unsigned)).signedBase64;
      signed = (await approverSigner.signTransaction(signed)).signedBase64;
      signed = (await agentSigner.signTransaction(signed)).signedBase64;
      const txSignature = await this.chain.sendAndConfirm(signed);
      const { address } = findMandatePda(programId, mandateHashBytes);
      this.logger.log(`Mandate ${mandate.id} registered on-chain at ${address} (${txSignature})`);
      return { address, txSignature };
    } catch (error) {
      this.logger.warn(`On-chain create_mandate skipped for ${record.mandate.id}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Behind `ATLAS_ONCHAIN=1`: revokes a mandate on-chain (`revoke_mandate`), signed by whichever
   * owner/approver user just revoked it off-chain. Best-effort, same reasoning as
   * {@link anchorMandateOnChain} — a failure here never undoes the (already-effective) off-chain
   * revocation.
   */
  async revokeMandateOnChain(record: MandateRecord, authorityUserId: string): Promise<OnChainMandateResult | null> {
    if (!onchainEnabled()) return null;
    try {
      const authoritySigner = await this.userSigner(authorityUserId);
      const programId = mandateProgramId();
      const mandateHashBytes = Buffer.from(record.mandateHash, 'hex');
      const { address: mandatePda } = findMandatePda(programId, mandateHashBytes);
      const latest = await this.chain.getLatestBlockhash();
      const unsigned = buildRevokeMandateTransaction({
        programId,
        mandatePda,
        authority: authoritySigner.publicKey,
        recentBlockhash: latest.blockhash,
      });
      const signed = (await authoritySigner.signTransaction(unsigned)).signedBase64;
      const txSignature = await this.chain.sendAndConfirm(signed);
      this.logger.log(`Mandate ${record.mandate.id} revoked on-chain at ${mandatePda} (${txSignature})`);
      return { address: mandatePda, txSignature };
    } catch (error) {
      this.logger.warn(`On-chain revoke_mandate skipped for ${record.mandate.id}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async presentMandate(record: MandateRecord) {
    const users = await prisma.user.findMany({
      where: { id: { in: record.signers.map((s) => s.userId).filter((id): id is string => Boolean(id)) } },
      select: { id: true, displayName: true },
    });
    const names = new Map(users.map((u) => [u.id, u.displayName]));
    const limits = record.mandate.scope.limits;
    const spend = await this.store.spend.totals(record.mandate.id, this.now(), limits.windowSeconds, 300);
    return {
      id: record.mandate.id,
      status: effectiveMandateStatus(record, this.now()),
      mandateHash: record.mandateHash,
      mandate: record.mandate,
      signers: record.signers.map((s) => ({ ...s, displayName: s.userId ? (names.get(s.userId) ?? null) : s.role === 'AGENT' ? record.mandate.agent.label : null })),
      revocation: record.revocation,
      createdAt: record.createdAt,
      spend,
      verification: verifyMandateChain(record.mandate),
    };
  }

  presentDecision(stored: StoredDecision) {
    const { record, decisionHash } = stored.signed;
    return {
      id: record.id,
      mandateId: record.mandateId,
      decision: record.decision,
      kind: record.kind,
      failedRule: record.failedRule,
      failedRules: record.failedRules,
      escalationRules: record.escalationRules,
      reason: record.reason,
      rulesEvaluated: record.rulesEvaluated,
      offer: {
        resourceUrl: record.offer.resourceUrl,
        payTo: record.offer.payTo,
        asset: record.offer.asset,
        amount: record.offer.amount,
      },
      approvalId: stored.approvalId,
      decisionHash,
      createdAt: stored.createdAt,
    };
  }
}
