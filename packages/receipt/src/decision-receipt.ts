import {
  AgentMandate,
  JsonValue,
  MessageSigner,
  SIGNATURE_DOMAIN,
  SignedDecision,
  hashCanonical,
  hashMandate,
  signDomainHash,
  verifyDecisionMatchesScope,
  verifyDecisionSignature,
  verifyDomainHash,
  verifyMandateChain,
} from '@atlas-rail/mandate';
import { ChainClient, checkRootAnchor, findMandatePda } from '@atlas-rail/solana';
import { PublicKey } from '@solana/web3.js';
import { encodeBatchHeader, hashBytes, saltedLeafPreimage } from './batch-file';
import { verifyMerkleProof } from './merkle';
import type { AnchorProof, ReceiptCheck, ReceiptVerification } from './receipt';

export const DECISION_RECEIPT_TYPE = 'atlasrail.decision-receipt' as const;
const DEFAULT_MANDATE_PROGRAM_ID = 'CnGoTE5Bxc8MFGaeK5LDv5uAZ7pNiktMunYy8JZcLY4k';

/**
 * What Atlas Rail answered a spending-authority request (for example pay.sh), bound to the exact
 * request and offer. Allow and deny both get one. The gate decision inside re-runs from the mandate.
 */
export interface AuthorityAnswer {
  decision: 'allow' | 'deny' | 'reject_before_execution';
  reason: string;
  operation_id: string;
  attempt_id: string;
  caller_id: string;
  /** SHA-256 of the request bytes, as pay fingerprints them. */
  request_sha256: string;
  /** JCS SHA-256 of the accepted offer. */
  offer_hash: string;
}

export interface DecisionReceipt {
  type: typeof DECISION_RECEIPT_TYPE;
  version: '0.1';
  id: string;
  mandate: AgentMandate;
  decision: SignedDecision;
  answer: AuthorityAnswer;
  issuedAt: number;
  receiptHash: string;
  instance: { publicKey: string; signature: string };
  /** Added after the batch is anchored. Not covered by the receipt signature. */
  anchor?: AnchorProof;
}

export function computeDecisionReceiptHash(body: { mandate: AgentMandate; decision: SignedDecision; answer: AuthorityAnswer; issuedAt: number }): string {
  return hashCanonical({
    type: DECISION_RECEIPT_TYPE,
    version: '0.1',
    mandateHash: hashMandate(body.mandate),
    decisionHash: body.decision.decisionHash,
    answer: body.answer,
    timestamp: body.issuedAt,
  } as unknown as JsonValue);
}

export async function buildDecisionReceipt(
  input: { id: string; mandate: AgentMandate; decision: SignedDecision; answer: AuthorityAnswer; issuedAt: number },
  signer: MessageSigner,
): Promise<DecisionReceipt> {
  if (input.decision.record.mandateHash !== hashMandate(input.mandate)) throw new Error('Decision was made under a different mandate');
  const receiptHash = computeDecisionReceiptHash(input);
  const signature = await signDomainHash(signer, SIGNATURE_DOMAIN.receipt, receiptHash);
  return { type: DECISION_RECEIPT_TYPE, version: '0.1', ...input, receiptHash, instance: { publicKey: signer.publicKey, signature } };
}

function check(id: string, title: string, ok: boolean, message: string): ReceiptCheck {
  return { id, title, status: ok ? 'PASS' : 'FAIL', message };
}

/**
 * Checks a decision receipt end to end: its hash and signature, the mandate's signatures, that the
 * gate decision re-runs to the same result, that the answer matches it, the Merkle proof, and the
 * anchor_root_v2 transaction on Solana. A deny is a decision, so the gate may have said DENY.
 */
export async function verifyDecisionReceipt(
  input: unknown,
  options: { chain?: ChainClient | null; trustedInstanceKeys: readonly string[]; requireAnchor?: boolean; programId?: string },
): Promise<ReceiptVerification> {
  const checks: ReceiptCheck[] = [];
  const receipt = input as DecisionReceipt;
  if (!receipt || receipt.type !== DECISION_RECEIPT_TYPE || !receipt.decision?.record || !receipt.answer || !receipt.mandate) {
    return { pass: false, checks: [check('SCHEMA', 'Receipt format', false, 'Not an Atlas Rail decision receipt')] };
  }
  checks.push(check('SCHEMA', 'Receipt format', true, `Decision receipt ${receipt.id}`));
  let hashOk = false;
  try {
    hashOk = computeDecisionReceiptHash(receipt) === receipt.receiptHash;
  } catch {
    hashOk = false;
  }
  checks.push(check('RECEIPT_HASH', 'Receipt binds mandate, decision and answer', hashOk, hashOk ? 'Recomputed hash matches' : 'Receipt hash does not match its contents'));
  const sigOk = verifyDomainHash(receipt.instance.publicKey, SIGNATURE_DOMAIN.receipt, receipt.receiptHash, receipt.instance.signature);
  const pinned = options.trustedInstanceKeys.includes(receipt.instance.publicKey);
  checks.push(check('INSTANCE_SIGNATURE', 'Signed by the Atlas Rail instance key', sigOk && pinned, !sigOk ? 'Signature does not verify' : pinned ? 'Valid signature by a pinned key' : 'Signer is not a pinned key'));
  const chain = verifyMandateChain(receipt.mandate);
  checks.push(check('MANDATE_CHAIN', 'Mandate delegation chain', chain.valid, chain.valid ? 'Owner, approver and agent signatures verify' : chain.errors[0] ?? 'Mandate does not verify'));
  const decisionSig = verifyDecisionSignature(receipt.decision);
  const bound = receipt.decision.record.mandateHash === hashMandate(receipt.mandate);
  checks.push(check('DECISION_SIGNATURE', 'Decision record signature and binding', decisionSig.ok && bound, decisionSig.ok && bound ? decisionSig.message : 'Decision does not verify or belongs to another mandate'));
  const scope = chain.valid ? verifyDecisionMatchesScope(receipt.mandate, receipt.decision) : { ok: false, message: 'skipped: mandate did not verify' };
  checks.push(check('DECISION_MATCHES_SCOPE', 'Decision matches the mandate scope', scope.ok, scope.message));
  // The safety property: an allow is always backed by a gate ALLOW. Deny and "wait for the owner"
  // may be stricter than the gate (the behaviour check can stop a payment the mandate allows).
  const answerOk = receipt.answer.decision !== 'allow' || receipt.decision.record.decision === 'ALLOW';
  checks.push(check('ANSWER_MATCHES_DECISION', 'An allow is backed by a gate ALLOW', answerOk, answerOk ? `Answered ${receipt.answer.decision}; the gate said ${receipt.decision.record.decision}` : 'Allowed although the gate did not allow'));

  const anchor = receipt.anchor;
  if (!anchor) {
    checks.push({ id: 'ANCHOR_MERKLE', title: 'Merkle inclusion in an anchored batch', status: options.requireAnchor ? 'FAIL' : 'SKIP', message: 'Not anchored yet' });
  } else {
    const leaf = anchor.leafSalt ? saltedLeafPreimage(receipt.receiptHash, anchor.leafSalt) : receipt.receiptHash;
    const programId = options.programId ?? DEFAULT_MANDATE_PROGRAM_ID;
    const mandatePda = findMandatePda(programId, Buffer.from(hashMandate(receipt.mandate), 'hex')).address;
    let headerOk = false;
    try {
      headerOk = Boolean(anchor.batchHeader && anchor.batchFileHash) && hashBytes(encodeBatchHeader({
        mandate: new PublicKey(mandatePda).toBytes(),
        seq: BigInt(anchor.seq ?? 0),
        leafCount: anchor.leafCount,
        merkleRoot: Buffer.from(anchor.merkleRoot, 'hex'),
        batchFileHash: Buffer.from(anchor.batchFileHash!, 'hex'),
      })) === anchor.batchHeader;
    } catch {
      headerOk = false;
    }
    const inclusion = verifyMerkleProof(leaf, anchor.proof, anchor.merkleRoot) && headerOk;
    checks.push(check('ANCHOR_MERKLE', 'Merkle inclusion in an anchored batch', inclusion, inclusion ? `Leaf ${anchor.leafIndex} of ${anchor.leafCount}` : 'Merkle proof or batch header does not hold'));
    if (options.chain) {
      const summary = await options.chain.getTransactionSummary(anchor.txSignature).catch(() => null);
      const onChain = checkRootAnchor(summary, {
        programId, mandatePda, signer: receipt.instance.publicKey, seq: BigInt(anchor.seq ?? 0),
        merkleRoot: anchor.merkleRoot, leafCount: anchor.leafCount, batchHeader: anchor.batchHeader, batchFileHash: anchor.batchFileHash,
      });
      checks.push(check('ANCHOR_ONCHAIN', 'Merkle root anchored on Solana', onChain.ok, onChain.reason));
    } else {
      checks.push({ id: 'ANCHOR_ONCHAIN', title: 'Merkle root anchored on Solana', status: 'SKIP', message: 'No RPC' });
    }
  }
  return { pass: checks.every((c) => c.status !== 'FAIL'), checks };
}
