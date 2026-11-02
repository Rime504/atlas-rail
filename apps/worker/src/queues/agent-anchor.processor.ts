import { Job } from 'bullmq';
import { prisma, generateUlid, PrismaDecisionReceiptStore, PrismaReceiptStore } from '@atlas-rail/database';
import { AgentAnchorJobData } from '@atlas-rail/config';
import { AnchorService, type ReceiptStore } from '@atlas-rail/receipt';
import { DevnetKeyring, Web3ChainClient } from '@atlas-rail/solana';

let services: { payments: AnchorService; decisions: AnchorService } | null = null;

/** Built lazily so a worker without a devnet keyring (e.g. production mode) still boots and runs its other queues. */
function anchorServices(): { payments: AnchorService; decisions: AnchorService } {
  if (!services) {
    // Same guards as the API: refuses mainnet endpoints, and refuses to load the keyring in production.
    const chain = Web3ChainClient.fromUrl(process.env.SOLANA_RPC_URL);
    const signer = DevnetKeyring.load().signer('instance');
    const build = (receipts: ReceiptStore) =>
      new AnchorService({
        receipts,
        chain,
        signer,
        clock: () => Math.floor(Date.now() / 1000),
        newId: (prefix) => generateUlid(prefix),
        rpcUrl: process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com',
        programId: process.env.MANDATE_PROGRAM_ID ?? 'CnGoTE5Bxc8MFGaeK5LDv5uAZ7pNiktMunYy8JZcLY4k',
      });
    services = { payments: build(new PrismaReceiptStore(prisma)), decisions: build(new PrismaDecisionReceiptStore(prisma).asAnchorStore()) };
  }
  return services;
}

/**
 * Periodic anchoring: batches every unanchored bound receipt into a Merkle tree and writes the root
 * with `anchor_root`, then does the same for pay.sh decision receipts (allow and deny). One after the
 * other, because both advance the same mandate's root seq. Idempotent: with nothing pending it is a
 * no-op, and a failed run leaves the receipts unanchored for the next tick without holding back the other kind.
 */
export async function processAgentAnchorJob(_job: Job<AgentAnchorJobData>): Promise<void> {
  let failure: unknown = null;
  for (const [kind, service] of Object.entries(anchorServices())) {
    try {
      const result = await service.run();
      if (result) {
        console.info(`⚓ Anchored ${result.anchored} ${kind === 'payments' ? 'receipt' : 'decision receipt'}(s) under root ${result.batch.merkleRoot}`);
      }
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure) throw failure;
}
