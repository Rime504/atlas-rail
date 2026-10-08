import { Job } from 'bullmq';
import { prisma, generateUlid, PrismaReceiptStore } from '@atlas-rail/database';
import { AgentAnchorJobData, envBoolean } from '@atlas-rail/config';
import { AnchorService } from '@atlas-rail/receipt';
import { DevnetKeyring, Web3ChainClient } from '@atlas-rail/solana';

let service: AnchorService | null = null;

/** Same pattern as apps/api/src/agent/agent.facade.ts's onchainEnabled()/anchorRootEnabled() — kept
 * local rather than shared because the two processes build their AnchorService independently. */
function flag(name: string): boolean {
  const result = envBoolean.safeParse(process.env[name]);
  return result.success && result.data === true;
}

/** Built lazily so a worker without a devnet keyring (e.g. production mode) still boots and runs its other queues. */
function anchorService(): AnchorService {
  if (!service) {
    // Same guards as the API: refuses mainnet endpoints, and refuses to load the keyring in production.
    const chain = Web3ChainClient.fromUrl(process.env.SOLANA_RPC_URL);
    const signer = DevnetKeyring.load().signer('instance');
    service = new AnchorService({
      receipts: new PrismaReceiptStore(prisma),
      chain,
      signer,
      clock: () => Math.floor(Date.now() / 1000),
      newId: (prefix) => generateUlid(prefix),
      mode: flag('ATLAS_ONCHAIN') && flag('ATLAS_ANCHOR_ROOT') ? 'root' : 'memo',
      rpcUrl: process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com',
      programId: process.env.MANDATE_PROGRAM_ID ?? 'CnGoTE5Bxc8MFGaeK5LDv5uAZ7pNiktMunYy8JZcLY4k',
    });
  }
  return service;
}

/**
 * Periodic anchoring: batches every unanchored bound receipt into a Merkle tree and writes the root to
 * Solana devnet as a Memo. Idempotent: with nothing pending it is a no-op, and a failed run leaves the
 * receipts unanchored for the next tick.
 */
export async function processAgentAnchorJob(_job: Job<AgentAnchorJobData>): Promise<void> {
  const result = await anchorService().run();
  if (result) {
    console.info(`⚓ Anchored ${result.anchored} receipt(s) under root ${result.batch.merkleRoot}`);
  }
}
