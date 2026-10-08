// Verifies and uploads demo-agent showcase records to the public receipt store.
//
//   pnpm --filter @atlas-rail/playground publish-showcase ../../.demo/showcase/*.json
//
// Needs BLOB_READ_WRITE_TOKEN (apps/playground/.env.local, from `vercel env pull`). Uses the exact
// same publish rules as the playground server (src/lib/receipt-store.ts): receipts must pass every
// verifyReceipt check against devnet, blocked attempts must be a genuine signed DENY.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { Web3ChainClient } from '@atlas-rail/solana';
import { publishBlockedAttempt, publishReceipt } from '../src/lib/receipt-store.ts';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: publish-showcase <receipt-or-blocked.json> [...]');
  process.exit(2);
}
if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('BLOB_READ_WRITE_TOKEN is not set (run `vercel env pull .env.local` in apps/playground).');
  process.exit(2);
}

const chain = Web3ChainClient.fromUrl(process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com');
const site = process.env.PLAYGROUND_URL ?? 'https://atlas-rail-playground.vercel.app';
let failed = 0;

for (const file of files) {
  const record = JSON.parse(readFileSync(file, 'utf8'));
  const isReceipt = typeof record?.receiptHash === 'string';
  const result = isReceipt ? await publishReceipt(record, { chain }) : await publishBlockedAttempt(record);
  const id = isReceipt ? record.id : record?.decision?.record?.id;
  const link = isReceipt ? `${site}/api/receipts/${id}` : `${site}/api/decisions/${id}`;
  if (!result.stored) failed++;
  console.log(`${result.stored ? 'OK  ' : 'SKIP'} ${basename(file)} -> ${result.stored ? link : result.reason}`);
  if (isReceipt && result.stored) console.log(`     payment: ${record.settlement.txSignature}`);
}
process.exit(failed > 0 ? 1 : 0);
