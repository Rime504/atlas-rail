import { Inject, Injectable, Logger } from '@nestjs/common';
import { prisma, generateUlid, PrismaAgentStore, PrismaReceiptStore } from '@atlas-rail/database';
import { WEBHOOK_EVENT_TYPES, WebhookEventType } from '@atlas-rail/config';
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
import { ChainClient, ChainPaymentSimulator, DevnetKeyring, DevnetKeypairSigner } from '@atlas-rail/solana';
import { QueueService } from '../common/queue.service';
import { AGENT_CHAIN, AGENT_KEYRING } from './agent.tokens';

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
    this.anchorService = new AnchorService({ receipts: this.receipts, chain, signer: this.instanceSigner, clock, newId });
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
