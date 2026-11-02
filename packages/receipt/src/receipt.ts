import { PublicKey } from '@solana/web3.js';
import { z } from 'zod';
import {
  AgentMandate,
  JsonValue,
  MessageSigner,
  OwnerApprovalCheck,
  SIGNATURE_DOMAIN,
  SIGNATURE_SCHEME,
  SignatureScheme,
  SignedDecision,
  X402Offer,
  approvalSigners,
  hashCanonical,
  hashMandate,
  hashOffer,
  isSha256Hex,
  sha256Hex,
  signDomainHash,
  verifyDecisionMatchesScope,
  verifyDecisionSignature,
  verifyDomainHash,
  verifyMandateChain,
  verifyOwnerApproval,
} from '@atlas-rail/mandate';
import { ChainClient, checkChannelSettlement, checkRootAnchor, checkSettlement, findMandatePda } from '@atlas-rail/solana';
import { MerkleStep, verifyMerkleProof } from './merkle';
import { encodeBatchHeader, hashBytes, saltedLeafPreimage } from './batch-file';

export const RECEIPT_TYPE = 'atlasrail.bound-receipt' as const;
export const RECEIPT_VERSION = '0.1' as const;
const DEFAULT_MANDATE_PROGRAM_ID = 'CnGoTE5Bxc8MFGaeK5LDv5uAZ7pNiktMunYy8JZcLY4k';
const VOUCHER_CONTENT_TYPE = 'application/vnd.payment-channels.voucher';

export interface ReceiptSettlement {
  txSignature: string;
  network: string;
  /** Token-transfer authority observed on-chain (the paying wallet). */
  payer: string | null;
  settledAt: number | null;
  slot: number | null;
}

export interface ReceiptResponse {
  status: number;
  /** SHA-256 (hex) of the paid response body the agent received. */
  bodySha256: string;
  contentType: string | null;
}

export interface AnchorProof {
  batchId: string;
  merkleRoot: string;
  leafCount: number;
  leafIndex: number;
  proof: MerkleStep[];
  txSignature: string;
  network: string;
  anchoredAt: number | null;
  /** Key that signed the anchor transaction. Verification requires it to equal the receipt's instance key. */
  signer: string;
  leafSalt?: string;
  /** SHA-256 of the canonical batch header. Present on salted root batches. */
  batchHeader?: string;
  /** SHA-256 of the canonical batch file. Present on salted root batches. */
  batchFileHash?: string;
  mechanism?: 'root';
  /** The mandate's anchor_root sequence number this batch was anchored under. */
  seq?: number;
}

export interface BoundReceiptBody {
  type: typeof RECEIPT_TYPE;
  version: typeof RECEIPT_VERSION;
  id: string;
  mandate: AgentMandate;
  offer: X402Offer;
  decision: SignedDecision;
  settlement: ReceiptSettlement;
  response: ReceiptResponse;
  issuedAt: number;
  hashes: { mandateHash: string; offerHash: string; decisionHash: string; responseHash: string };
}

export interface BoundReceipt extends BoundReceiptBody {
  /** SHA-256 over the canonical binding of mandate hash, offer, decision hash, tx signature, response hash, timestamp. */
  receiptHash: string;
  /** `scheme` missing means `ed25519`. Not part of `receiptHash`. */
  instance: { publicKey: string; signature: string; scheme?: SignatureScheme };
  /** Added after the receipt is issued, once its batch has been anchored. Not covered by the receipt signature. */
  anchor?: AnchorProof;
}

export function hashResponse(response: ReceiptResponse): string {
  return hashCanonical(response as unknown as JsonValue);
}

/** The value the instance signs and that becomes the Merkle leaf. */
export function computeReceiptHash(body: {
  hashes: { mandateHash: string; decisionHash: string; responseHash: string };
  offer: X402Offer;
  settlement: { txSignature: string };
  issuedAt: number;
}): string {
  return hashCanonical({
    type: RECEIPT_TYPE,
    version: RECEIPT_VERSION,
    mandateHash: body.hashes.mandateHash,
    offer: body.offer,
    decisionHash: body.hashes.decisionHash,
    txSignature: body.settlement.txSignature,
    responseHash: body.hashes.responseHash,
    timestamp: body.issuedAt,
  } as unknown as JsonValue);
}

export class ReceiptBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReceiptBuildError';
  }
}

export interface BuildReceiptInput {
  id: string;
  mandate: AgentMandate;
  decision: SignedDecision;
  settlement: ReceiptSettlement;
  response: ReceiptResponse;
  issuedAt: number;
}

export async function buildReceipt(input: BuildReceiptInput, instanceSigner: MessageSigner): Promise<BoundReceipt> {
  const { decision, mandate } = input;
  if (decision.record.decision !== 'ALLOW') {
    throw new ReceiptBuildError('Receipts can only be issued for ALLOW decisions');
  }
  if (decision.record.mandateHash !== hashMandate(mandate)) {
    throw new ReceiptBuildError('Decision was made under a different mandate');
  }
  if (!isSha256Hex(input.response.bodySha256)) {
    throw new ReceiptBuildError('response.bodySha256 must be a lowercase SHA-256 hex digest');
  }
  const hashes = {
    mandateHash: decision.record.mandateHash,
    offerHash: hashOffer(decision.record.offer),
    decisionHash: decision.decisionHash,
    responseHash: hashResponse(input.response),
  };
  const body: BoundReceiptBody = {
    type: RECEIPT_TYPE,
    version: RECEIPT_VERSION,
    id: input.id,
    mandate,
    offer: decision.record.offer,
    decision,
    settlement: input.settlement,
    response: input.response,
    issuedAt: input.issuedAt,
    hashes,
  };
  const receiptHash = computeReceiptHash(body);
  const signature = await signDomainHash(instanceSigner, SIGNATURE_DOMAIN.receipt, receiptHash);
  return { ...body, receiptHash, instance: { publicKey: instanceSigner.publicKey, signature, scheme: SIGNATURE_SCHEME } };
}

/* -------------------------------------------------------------------------------------------------
 * Verification
 * -----------------------------------------------------------------------------------------------*/

export type CheckStatus = 'PASS' | 'FAIL' | 'SKIP';

export interface ReceiptCheck {
  id: string;
  title: string;
  status: CheckStatus;
  message: string;
}

export interface ReceiptVerification {
  /** True iff no check FAILed. SKIPs (e.g. no RPC available) do not fail a receipt but are always reported. */
  pass: boolean;
  checks: ReceiptCheck[];
}

export interface VerifyReceiptOptions {
  /**
   * Instance keys this verifier trusts. Required unless `untrusted` is set. Several keys cover a
   * rotation: a receipt passes when its signer is any key still on the list.
   */
  trustedInstanceKeys?: readonly string[];
  /**
   * Diagnostic path. The signature is checked against the key inside the receipt, and the result is
   * labeled untrusted. Security-sensitive callers leave this unset.
   */
  untrusted?: boolean;
  /** Chain access for the anchor and settlement checks. Without it those checks are SKIPPED. */
  chain?: ChainClient | null;
  /** Verify the settlement transaction on-chain (requires `chain`). Default true when `chain` is given. */
  checkSettlementOnChain?: boolean;
  /** Fail (rather than skip) if the receipt has not been anchored yet. */
  requireAnchor?: boolean;
  /** Mandate registry program id, for `mechanism: 'root'` receipts. Defaults to the deployed devnet program. */
  programId?: string;
}

const receiptShapeSchema = z
  .object({
    type: z.literal(RECEIPT_TYPE),
    version: z.literal(RECEIPT_VERSION),
    id: z.string().min(1),
    mandate: z.unknown(),
    offer: z.unknown(),
    decision: z.object({ record: z.unknown(), decisionHash: z.string(), instance: z.object({ publicKey: z.string(), signature: z.string(), scheme: z.literal(SIGNATURE_SCHEME).optional() }) }),
    settlement: z.object({ txSignature: z.string().min(64).max(100), network: z.string(), payer: z.string().nullable(), settledAt: z.number().nullable(), slot: z.number().nullable() }),
    response: z.object({ status: z.number().int(), bodySha256: z.string(), contentType: z.string().nullable() }),
    issuedAt: z.number().int(),
    hashes: z.object({ mandateHash: z.string(), offerHash: z.string(), decisionHash: z.string(), responseHash: z.string() }),
    receiptHash: z.string(),
    instance: z.object({ publicKey: z.string(), signature: z.string(), scheme: z.literal(SIGNATURE_SCHEME).optional() }),
    anchor: z.unknown().optional(),
  })
  .passthrough();

function check(id: string, title: string, ok: boolean, message: string): ReceiptCheck {
  return { id, title, status: ok ? 'PASS' : 'FAIL', message };
}
function skip(id: string, title: string, message: string): ReceiptCheck {
  return { id, title, status: 'SKIP', message };
}

/**
 * Verifies a bound receipt. Everything except the two on-chain checks runs offline and is pure:
 * schema, receipt hash, instance signature, mandate delegation chain, decision signature, scope
 * re-evaluation, and Merkle inclusion. The anchor and settlement checks each need a single RPC read.
 */
export async function verifyReceipt(input: unknown, options: VerifyReceiptOptions = {}): Promise<ReceiptVerification> {
  const checks: ReceiptCheck[] = [];
  const shape = receiptShapeSchema.safeParse(input);
  if (!shape.success) {
    const issue = shape.error.issues[0];
    checks.push(check('SCHEMA', 'Receipt format', false, `Not a v${RECEIPT_VERSION} bound receipt: ${issue.path.join('.') || '<root>'}: ${issue.message}`));
    return { pass: false, checks };
  }
  const receipt = input as BoundReceipt;
  checks.push(check('SCHEMA', 'Receipt format', true, `Well-formed atlasrail bound receipt v${RECEIPT_VERSION} (${receipt.id})`));

  // Receipt hash and instance signature.
  const mandateHash = safe(() => hashMandate(receipt.mandate));
  const offerHash = safe(() => hashOffer(receipt.offer));
  const responseHash = safe(() => hashResponse(receipt.response));
  const recomputed = safe(() =>
    computeReceiptHash({
      hashes: { mandateHash: receipt.hashes.mandateHash, decisionHash: receipt.hashes.decisionHash, responseHash: receipt.hashes.responseHash },
      offer: receipt.offer,
      settlement: receipt.settlement,
      issuedAt: receipt.issuedAt,
    }),
  );
  const bindingOk =
    recomputed === receipt.receiptHash &&
    mandateHash === receipt.hashes.mandateHash &&
    offerHash === receipt.hashes.offerHash &&
    responseHash === receipt.hashes.responseHash &&
    receipt.decision.decisionHash === receipt.hashes.decisionHash;
  checks.push(
    check(
      'RECEIPT_HASH',
      'Receipt binds mandate, offer, decision, settlement and response',
      bindingOk,
      bindingOk
        ? 'Recomputed receipt hash matches; mandate, offer, decision, transaction signature and response hashes all bind'
        : 'Receipt hash or one of the bound hashes does not match the embedded documents',
    ),
  );

  const signatureOk = verifyDomainHash(receipt.instance.publicKey, SIGNATURE_DOMAIN.receipt, receipt.receiptHash, receipt.instance.signature);
  const trustedKeys = options.trustedInstanceKeys ?? [];
  const pinned = trustedKeys.includes(receipt.instance.publicKey);
  const instanceOk = options.untrusted && trustedKeys.length === 0 ? signatureOk : trustedKeys.length > 0 && signatureOk && pinned;
  const instanceMessage = !signatureOk
    ? 'Receipt signature does not verify'
    : options.untrusted && trustedKeys.length === 0
      ? `Untrusted verification: the signature matches the key in the receipt (${receipt.instance.publicKey}). No trusted instance key was required.`
      : trustedKeys.length === 0
        ? 'Trusted instance keys must be configured'
        : pinned
          ? `Valid signature by pinned instance key ${receipt.instance.publicKey}`
          : `Instance key ${receipt.instance.publicKey} is not in the trusted key list`;
  checks.push(check('INSTANCE_SIGNATURE', 'Signed by the Atlas Rail instance key', instanceOk, instanceMessage));

  // Mandate.
  const chain = attempt(() => verifyMandateChain(receipt.mandate), {
    valid: false,
    checks: [],
    errors: ['Mandate could not be processed'],
  });
  checks.push(
    check(
      'MANDATE_CHAIN',
      'Mandate delegation chain',
      chain.valid,
      chain.valid
        ? 'Owner, independent approver(s) and the agent signed the mandate in order; every signature verifies'
        : chain.errors[0] ?? 'Mandate chain failed verification',
    ),
  );

  // Decision.
  const decisionSig = attempt(() => verifyDecisionSignature(receipt.decision), {
    id: 'DECISION_SIGNATURE',
    ok: false,
    message: 'Decision record could not be processed',
  });
  const decisionBound = receipt.decision.record.mandateHash === mandateHash && receipt.decision.record.offerHash === offerHash;
  checks.push(
    check(
      'DECISION_SIGNATURE',
      'Decision record signature and binding',
      decisionSig.ok && decisionBound,
      !decisionSig.ok ? decisionSig.message : decisionBound ? decisionSig.message : 'Decision does not refer to this mandate and offer',
    ),
  );

  if (chain.valid) {
    const scope = attempt(() => verifyDecisionMatchesScope(receipt.mandate, receipt.decision), {
      id: 'DECISION_MATCHES_SCOPE',
      ok: false,
      message: 'Decision could not be re-evaluated against the mandate',
    });
    checks.push(check('DECISION_MATCHES_SCOPE', 'Decision matches the mandate scope', scope.ok, scope.message));
  } else {
    checks.push(skip('DECISION_MATCHES_SCOPE', 'Decision matches the mandate scope', 'skipped: the mandate itself did not verify'));
  }

  // An owner-signed approval travels inside the signed decision; anyone can check it here.
  const approval = receipt.decision.record.context?.approval;
  if (approval?.ownerSignature || approval?.terms) {
    const owner = attempt<OwnerApprovalCheck>(
      () => {
        if (!approval.terms || !approval.ownerSignature) return { ok: false as const, reason: 'terms or signature missing' };
        if (approval.terms.offerHash !== receipt.decision.record.offerHash) return { ok: false as const, reason: 'signed for a different offer' };
        if (approval.terms.mandateHash !== mandateHash) return { ok: false as const, reason: 'signed for a different mandate' };
        return verifyOwnerApproval(approval.terms, approval.ownerSignature, {
          signers: approvalSigners(receipt.mandate as AgentMandate),
          agentPublicKey: (receipt.mandate as AgentMandate).agent.publicKey,
          now: receipt.decision.record.context.evaluatedAt,
        });
      },
      { ok: false as const, reason: 'approval could not be processed' },
    );
    checks.push(
      check(
        'OWNER_APPROVAL_SIGNATURE',
        "Owner's wallet signed this exact payment",
        owner.ok,
        owner.ok ? `Signed by the mandate's ${owner.signer.role.toLowerCase()} ${owner.signer.publicKey}` : `Owner approval does not verify: ${owner.reason}`,
      ),
    );
  }

  checks.push(
    check(
      'DECISION_ALLOWED',
      'Payment was authorised',
      receipt.decision.record.decision === 'ALLOW',
      receipt.decision.record.decision === 'ALLOW'
        ? `Gate decision was ALLOW (${receipt.decision.record.kind === 'APPROVED' ? 'with human approval' : 'within autonomous authority'})`
        : `Gate decision was ${receipt.decision.record.decision}; a receipt must not exist for it`,
    ),
  );

  // Anchor.
  const anchor = receipt.anchor as AnchorProof | undefined;
  if (!anchor) {
    checks.push(
      options.requireAnchor
        ? check('ANCHOR_MERKLE', 'Merkle inclusion in an anchored batch', false, 'Receipt has not been anchored yet')
        : skip('ANCHOR_MERKLE', 'Merkle inclusion in an anchored batch', 'receipt has not been anchored yet (batches anchor every few minutes)'),
    );
    checks.push(skip('ANCHOR_ONCHAIN', 'Merkle root anchored on Solana devnet', 'no anchor to check'));
  } else {
    const leaf = anchor.leafSalt ? saltedLeafPreimage(receipt.receiptHash, anchor.leafSalt) : receipt.receiptHash;
    const inclusion = verifyMerkleProof(leaf, anchor.proof, anchor.merkleRoot);
    // A salted leaf comes from a batch that has a header and a file hash. They cannot be dropped,
    // and the header must be the hash of this mandate, seq, leaf count, root and file hash.
    const programId = options.programId ?? DEFAULT_MANDATE_PROGRAM_ID;
    const headerOk = !anchor.leafSalt || safe(() => {
      if (!anchor.batchHeader || !anchor.batchFileHash || !mandateHash) return false;
      const mandatePda = new PublicKey(findMandatePda(programId, Buffer.from(mandateHash, 'hex')).address).toBytes();
      return hashBytes(encodeBatchHeader({
        mandate: mandatePda,
        seq: BigInt(anchor.seq ?? 0),
        leafCount: anchor.leafCount,
        merkleRoot: Buffer.from(anchor.merkleRoot, 'hex'),
        batchFileHash: Buffer.from(anchor.batchFileHash, 'hex'),
      })) === anchor.batchHeader;
    }) === true;
    checks.push(
      check(
        'ANCHOR_MERKLE',
        'Merkle inclusion in an anchored batch',
        inclusion && headerOk,
        !inclusion
          ? 'Merkle proof does not lead from this receipt to the anchored root'
          : !headerOk
            ? 'Batch header is missing or is not the hash of this mandate, seq, leaf count, root and file hash'
            : `Receipt is leaf ${anchor.leafIndex} of ${anchor.leafCount} under root ${anchor.merkleRoot.slice(0, 16)}…`,
      ),
    );
    if (options.chain) {
      const summary = await options.chain.getTransactionSummary(anchor.txSignature).catch(() => null);
      const onChain = checkRootAnchor(summary, {
        programId: options.programId ?? DEFAULT_MANDATE_PROGRAM_ID,
        mandatePda: mandateHash
          ? findMandatePda(options.programId ?? DEFAULT_MANDATE_PROGRAM_ID, Buffer.from(mandateHash, 'hex')).address
          : '',
        signer: receipt.instance.publicKey,
        seq: BigInt(anchor.seq ?? 0),
        merkleRoot: anchor.merkleRoot,
        leafCount: anchor.leafCount,
        batchHeader: anchor.batchHeader,
        batchFileHash: anchor.batchFileHash,
      });
      checks.push(
        check(
          'ANCHOR_ONCHAIN',
          'Merkle root anchored on Solana devnet',
          onChain.ok && anchor.signer === receipt.instance.publicKey,
          onChain.ok
            ? `${onChain.reason} (slot ${onChain.slot ?? '?'}, ${anchor.txSignature.slice(0, 12)}…)`
            : onChain.reason,
        ),
      );
    } else {
      checks.push(skip('ANCHOR_ONCHAIN', 'Merkle root anchored on Solana devnet', 'no RPC available; run without --offline to check the chain'));
    }
  }

  // Settlement on-chain.
  const wantSettlement = options.checkSettlementOnChain ?? Boolean(options.chain);
  if (wantSettlement && options.chain) {
    const summary = await options.chain.getTransactionSummary(receipt.settlement.txSignature).catch(() => null);
    const voucher = receipt.response.contentType === VOUCHER_CONTENT_TYPE;
    const settled = voucher
      ? checkChannelSettlement(summary)
      : checkSettlement(summary, { payTo: receipt.offer.payTo, mint: receipt.offer.asset, amountBaseUnits: receipt.offer.amount });
    // A voucher receipt binds the exact 50-byte voucher (channel, cumulative total, expiry) through
    // response.bodySha256. The settle must have verified those same bytes, for the channel the offer names.
    const voucherOk = !voucher || voucherMatches(receipt, settled.voucherMessageHex, settled.channel);
    const payerOk = settled.ok && settled.payer === receipt.mandate.agent.publicKey && voucherOk;
    checks.push(
      check(
        'SETTLEMENT_ONCHAIN',
        'Settlement transaction matches the offer',
        settled.ok && payerOk,
        settled.ok
          ? payerOk
            ? voucher
              ? `Payment-channels settle was authorized by the mandate's agent key (slot ${settled.slot ?? '?'})`
              : `On-chain transfer of ${receipt.offer.amount} base units to ${receipt.offer.payTo} was paid by the mandate's agent key (slot ${settled.slot ?? '?'})`
            : voucher
              ? voucherOk
                ? 'Ed25519 precompile was not signed by the agent key named in the mandate'
                : 'Settled voucher is not the voucher this receipt was issued for (amount, channel or expiry differ)'
              : 'Transfer was not made by the agent key named in the mandate'
          : settled.reason,
      ),
    );
  } else {
    checks.push(skip('SETTLEMENT_ONCHAIN', 'Settlement transaction matches the offer', 'not requested or no RPC available'));
  }

  return { pass: checks.every((c) => c.status !== 'FAIL'), checks };
}

function voucherMatches(receipt: BoundReceipt, messageHex: string | undefined, channel: string | undefined): boolean {
  if (!messageHex || !channel) return false;
  const message = Buffer.from(messageHex, 'hex');
  if (message.length !== 50 || sha256Hex(message) !== receipt.response.bodySha256) return false;
  const named = receipt.offer.memo?.startsWith('channel:') ? receipt.offer.memo.slice('channel:'.length) : null;
  return named === channel && safe(() => new PublicKey(message.subarray(2, 34)).toBase58()) === channel;
}

function attempt<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}
