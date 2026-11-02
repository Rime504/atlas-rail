/**
 * Prepare-only SDK example. Does not open a channel, mint, or broadcast.
 *
 *   node --experimental-strip-types sdk-prepare-only.ts
 *
 * Requires ATLAS_API_URL, SOLANA_RPC_URL, and ATLAS_FUNDER_KEY_PATH.
 */
import { isAbsolute, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, createAtlasRail, keypairWallet, loadEnv } from 'atlasrails';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
loadEnv({ path: join(root, '.env') });

const rpcUrl = process.env.SOLANA_RPC_URL;
const apiUrl = process.env.ATLAS_API_URL;
const funderPath = process.env.ATLAS_FUNDER_KEY_PATH;
if (!rpcUrl || !apiUrl || !funderPath) {
  throw new Error('SOLANA_RPC_URL, ATLAS_API_URL, and ATLAS_FUNDER_KEY_PATH are required');
}
const path = isAbsolute(funderPath) ? funderPath : join(root, funderPath);
const { connection, publicKey } = connect({ path, rpcUrl });

const atlas = createAtlasRail({
  apiUrl,
  connection,
  wallet: keypairWallet({ path }),
  execution: 'prepareOnly',
});

console.log(JSON.stringify({
  execution: atlas.execution,
  feePayer: publicKey,
  note: 'No transaction was broadcast. Pass a mandate and channel to atlas.requestPayment to continue.',
  broadcast: false,
}, null, 2));
