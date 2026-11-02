import { PublicKey } from '@solana/web3.js';
import { buildSaltedBatch, merkleProof, type AnchorProof } from '@atlas-rail/receipt';

export interface AnchorablePayment {
  distributeSignature?: string;
  request: { mandateAddress?: string };
  receipt?: {
    id: string;
    issuedAt: number;
    anchor?: unknown;
    instance: { publicKey: string };
  };
}

/** Distributed receipts for one mandate that this gate key attested and that have no root yet. */
export function distributedReceiptsForAnchor<T extends AnchorablePayment>(payments: Iterable<T>, mandatePda: string, gateKey: string): T[] {
  return [...payments]
    .filter((payment) =>
      payment.receipt &&
      !payment.receipt.anchor &&
      payment.distributeSignature &&
      payment.request.mandateAddress === mandatePda &&
      payment.receipt.instance.publicKey === gateKey,
    )
    .sort((a, b) => a.receipt!.issuedAt - b.receipt!.issuedAt || a.receipt!.id.localeCompare(b.receipt!.id));
}

export function payAnchorAttachment(batched: { ok: true; rootPda: string; merkleRoot: string; leafCount: number; seq: number; signature: string; settlements: string[] } | { ok: false; message: string }): {
  anchor?: { ok: true; rootPda: string; merkleRoot: string; leafCount: number; seq: number; signature: string; settlements: string[] };
  anchorError?: string;
} {
  if (!batched.ok) return batched.message === 'empty' ? {} : { anchorError: batched.message };
  return {
    anchor: {
      ok: true,
      rootPda: batched.rootPda,
      merkleRoot: batched.merkleRoot,
      leafCount: batched.leafCount,
      seq: batched.seq,
      signature: batched.signature,
      settlements: batched.settlements,
    },
  };
}

/** Salted receipt leaves for one mandate batch. The chain stores the root, header hash, and file hash. */
export function combineVoucherReceipts(input: {
  mandate: string;
  seq: number;
  receiptHashes: readonly string[];
  salts?: readonly string[];
}) {
  return buildSaltedBatch({
    mandate: new PublicKey(input.mandate).toBytes(),
    seq: BigInt(input.seq),
    receiptHashes: input.receiptHashes,
    salts: input.salts,
  });
}

export function stampVoucherAnchor(
  receipts: { receiptHash: string; anchor?: AnchorProof }[],
  input: {
    merkleRoot: string;
    leaves: string[];
    salts: string[];
    batchHeader: string;
    batchFileHash: string;
    txSignature: string;
    network: string;
    signer: string;
    seq: number;
    anchoredAt: number;
    batchId: string;
  },
): void {
  receipts.forEach((receipt, index) => {
    receipt.anchor = {
      batchId: input.batchId,
      merkleRoot: input.merkleRoot,
      leafCount: input.leaves.length,
      leafIndex: index,
      proof: merkleProof(input.leaves, index),
      txSignature: input.txSignature,
      network: input.network,
      anchoredAt: input.anchoredAt,
      signer: input.signer,
      mechanism: 'root',
      seq: input.seq,
      leafSalt: input.salts[index],
      batchHeader: input.batchHeader,
      batchFileHash: input.batchFileHash,
    };
  });
}
