import { DevnetKeyring } from '@atlas-rail/solana';
import { createDemoApi } from './server';

/** The paid demo API. Merchant and mint come from the devnet keyring so setup and server always agree. */
async function main() {
  const port = Number(process.env.DEMO_API_PORT ?? 4402);
  const facilitatorUrl = process.env.FACILITATOR_URL ?? 'http://127.0.0.1:4022';
  const keyring = DevnetKeyring.load();
  const payTo = keyring.signer('merchant').publicKey;
  const mint = process.env.DEMO_MINT ?? keyring.signer('demo-mint').publicKey;
  const app = await createDemoApi({ facilitatorUrl, payTo, mint, log: process.env.LOG_LEVEL === 'debug' });
  await app.listen({ port, host: '127.0.0.1' });
  console.info(`Demo x402 API on http://127.0.0.1:${port}`);
  console.info('  GET /research/summary  $0.01');
  console.info('  GET /inference/heavy   $40.00');
  console.info(`  payTo ${payTo}\n  mint  ${mint}\n  facilitator ${facilitatorUrl}`);
}

main().catch((error) => {
  console.error('demo API failed to start:', error);
  process.exit(1);
});
