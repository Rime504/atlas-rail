import { merkleRoot } from '@atlas-rail/receipt';
import type { BoundReceipt, ReceiptVerification } from '@atlas-rail/receipt';
import type { ChainClient } from '@atlas-rail/solana';
import { anchorRootOnchain, devnetChain, resolveDevnetCoreKeys, withTimeout } from './devnet';
import { publicationBlocker } from './publication';
import { publishReceipt, storeConfigured } from './receipt-store';
import { OnchainAnchor, proveReceipt } from './scenario';
import type { Publication, World } from './types';

/**
 * Step 7: anchor the receipt on devnet (when this run may), verify it the way `atlas verify` does,
 * and publish it to the public store. Every devnet outcome comes back as a publication with a
 * reason, so the page never has to guess why "Verify this payment from the chain" is missing.
 */
export async function anchorProveAndPublish(
  world: World,
  receiptId: string,
): Promise<{ world: World; verification: ReceiptVerification; publication: Publication | undefined }> {
  const core = resolveDevnetCoreKeys();
  const blocker = publicationBlocker(world, { devnetConfigured: Boolean(core), storeConfigured: storeConfigured() });
  let next: World = { ...world, anchorOnchain: null };
  let onchainAnchor: OnchainAnchor | null = null;
  let anchorError: string | null = null;
  if (!blocker && core) {
    try {
      const receipt = world.receipts.find((r) => r.id === receiptId);
      if (!receipt) throw new Error('Receipt not found');
      // Must be the actual Merkle root over the leaf (merkleRoot([receiptHash])), not the raw
      // receipt hash itself — proveReceipt computes the same root independently below, and the
      // two have to match exactly for ANCHOR_ONCHAIN to verify against what's really on-chain.
      const root = merkleRoot([receipt.receiptHash]);
      onchainAnchor = await withTimeout(anchorRootOnchain(world.mandate!, root, 1, core));
      next = { ...next, anchorOnchain: onchainAnchor.action };
    } catch (err) {
      anchorError = messageOf(err);
      next = { ...next, devnetFallbackReason: `Devnet anchoring failed (${anchorError}) — this receipt is shown with a synthetic anchor instead.` };
    }
  }
  const { receipt, verification } = await proveReceipt(world, receiptId, onchainAnchor);
  next = { ...next, receipts: next.receipts.map((r) => (r.id === receipt.id ? receipt : r)) };
  if (world.mode !== 'devnet') return { world: next, verification, publication: undefined };
  if (blocker) return { world: next, verification, publication: blocker };
  if (!onchainAnchor) {
    return {
      world: next,
      verification,
      publication: { stored: false, retryable: true, reason: `Anchoring on devnet failed (${anchorError ?? 'unknown error'}).`, txSignature: receipt.settlement.txSignature },
    };
  }
  return { world: next, verification, publication: await publishOnce(receipt, onchainAnchor.chain) };
}

/** One publish attempt. A failure, timeout or not-yet-passing check is retryable: devnet RPC nodes lag. */
export async function publishOnce(receipt: BoundReceipt, chain: ChainClient): Promise<Publication> {
  try {
    const result = await withTimeout(publishReceipt(receipt, { chain }));
    return { stored: result.stored, retryable: !result.stored, reason: result.reason, txSignature: receipt.settlement.txSignature };
  } catch (err) {
    return { stored: false, retryable: true, reason: `Publishing failed (${messageOf(err)})`, txSignature: receipt.settlement.txSignature };
  }
}

/** The `publish` step: retry publishing this run's receipt, anchoring again only if the earlier anchor never landed. */
export async function publishStep(
  world: World,
  receiptId: string,
): Promise<{ world: World; verification: ReceiptVerification | undefined; publication: Publication | undefined }> {
  const blocker = publicationBlocker(world, { devnetConfigured: Boolean(resolveDevnetCoreKeys()), storeConfigured: storeConfigured() });
  if (blocker) return { world, verification: undefined, publication: blocker };
  if (!world.anchorOnchain) return anchorProveAndPublish(world, receiptId);
  const receipt = world.receipts.find((r) => r.id === receiptId);
  if (!receipt) throw new Error('Receipt not found');
  return { world, verification: undefined, publication: await publishOnce(receipt, devnetChain()) };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
