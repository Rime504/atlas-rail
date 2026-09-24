import { DevnetKeyring, Web3ChainClient } from '@atlas-rail/solana';
import { ChainFacilitatorSigner } from './chain-signer';
import { createFacilitator, createFacilitatorApp } from './facilitator';

/**
 * Local x402 facilitator for the demo: the official `@x402/svm` exact scheme, signing with the
 * `facilitator` key from the devnet keyring and settling on the configured devnet RPC (or the
 * offline mock validator). It is the fee payer, exactly as the public facilitators are.
 */
async function main() {
  const rpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
  const port = Number(process.env.FACILITATOR_PORT ?? 4022);
  const keyring = DevnetKeyring.load();
  const signer = keyring.signer('facilitator');
  const chain = Web3ChainClient.fromUrl(rpcUrl); // refuses mainnet
  const facilitator = createFacilitator(new ChainFacilitatorSigner(signer, chain));
  const app = createFacilitatorApp(facilitator, process.env.LOG_LEVEL === 'debug');
  await app.listen({ port, host: '127.0.0.1' });
  console.info(`x402 facilitator (official @x402/svm exact scheme) on http://127.0.0.1:${port}`);
  console.info(`  fee payer: ${signer.publicKey}`);
  console.info(`  cluster:   ${rpcUrl}`);
}

main().catch((error) => {
  console.error('facilitator failed to start:', error);
  process.exit(1);
});
