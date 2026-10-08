#!/usr/bin/env node
/**
 * atlas-rail-signer: the agent's key in its own process. It signs a payment only with a gate
 * authorisation that covers the exact transaction bytes, and signs messages only in the Atlas Rail
 * agent-request and mandate-acceptance forms. The agent gets the URL, never the key.
 *
 * Environment (devnet only):
 *   ATLAS_SIGNER_PORT            default 3012
 *   ATLAS_SIGNER_HOST            default 127.0.0.1 (this machine only)
 *   ATLAS_SIGNER_TOKEN           optional bearer token the agent must present
 *   ATLAS_AGENT_SECRET_KEY       base58 agent key, or ATLAS_KEYRING_PATH to read label "agent" from the devnet keyring
 *   ATLAS_TRUSTED_INSTANCE_KEY   gate instance key(s), comma-separated; from the keyring label "instance" if unset
 */
import { fromBase58 } from '@atlas-rail/mandate';
import { DevnetKeyring, DevnetKeypairSigner } from '@atlas-rail/solana';
import { GatedSignerAdapter, startSignerService } from '@atlas-rail/x402';

function agentKey(): { wallet: DevnetKeypairSigner; keyring: DevnetKeyring | null } {
  const secret = process.env.ATLAS_AGENT_SECRET_KEY;
  if (secret) {
    const bytes = fromBase58(secret);
    return { wallet: new DevnetKeypairSigner(bytes.length === 64 ? bytes.slice(0, 32) : bytes), keyring: null };
  }
  if (!process.env.ATLAS_KEYRING_PATH) throw new Error('Set ATLAS_AGENT_SECRET_KEY or ATLAS_KEYRING_PATH');
  const keyring = DevnetKeyring.load(process.env.ATLAS_KEYRING_PATH);
  if (!keyring.has('agent')) throw new Error('The keyring has no "agent" key yet; run the demo setup first');
  return { wallet: keyring.signer('agent'), keyring };
}

async function main() {
  process.env.ATLAS_ALLOW_MOCK_SIGNER ??= 'true'; // devnet-only keys; both loaders refuse NODE_ENV=production
  const { wallet, keyring } = agentKey();
  const trusted = (process.env.ATLAS_TRUSTED_INSTANCE_KEY ?? keyring?.publicKey('instance') ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  if (trusted.length === 0) throw new Error('Set ATLAS_TRUSTED_INSTANCE_KEY (the gate instance public key)');

  const service = await startSignerService({
    signer: new GatedSignerAdapter({ inner: wallet, trustedInstanceKeys: trusted }),
    host: process.env.ATLAS_SIGNER_HOST ?? '127.0.0.1',
    port: Number(process.env.ATLAS_SIGNER_PORT ?? 3012),
    token: process.env.ATLAS_SIGNER_TOKEN || undefined,
  });
  console.log(`atlas-rail-signer: agent ${wallet.publicKey} on ${service.url} (trusts ${trusted.length} gate key${trusted.length === 1 ? '' : 's'})`);

  const stop = () => void service.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((error) => {
  console.error(`atlas-rail-signer: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
