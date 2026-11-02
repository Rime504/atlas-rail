/**
 * Uses the wallet in DEMO_FUNDER_SECRET_KEY, then the atlasrails package
 * creates the mandate, deposits the upfront amount, and settles.
 * Run: node scripts/atlasrails-funder.mjs
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { importFunder, createMandateAndTransfer } = createRequire(join(root, 'packages/atlasrails/package.json'))(
  join(root, 'packages/atlasrails/dist/index.js'),
);

const envFile = join(root, '.env');
const keyPath = process.argv[2] ?? join(root, '.demo', 'atlasrails-funder.json');

export async function run() {
  const account = importFunder({ path: keyPath, envFile });
  console.log(`wallet ${account.publicKey}`);
  return createMandateAndTransfer({ path: keyPath, envFile });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
