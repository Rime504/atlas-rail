/**
 * A throw-away solana-test-validator with the two programs Atlas Rail uses, at their real addresses:
 *   - Atlas Mandate, built from this repo (target/deploy/atlas_mandate.so, `anchor build`)
 *   - payment-channels, the program deployed on Devnet, copied once with `solana program dump`
 *     into .demo/programs/ (public program bytes, no keys).
 * Nothing here touches Devnet state. Used by the top-up test and `pnpm demo`.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MANDATE_PROGRAM_ID = 'CnGoTE5Bxc8MFGaeK5LDv5uAZ7pNiktMunYy8JZcLY4k';
export const CHANNEL_PROGRAM_ID = 'CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX';
export const MANDATE_SO = join(root, 'target/deploy/atlas_mandate.so');
export const CHANNEL_SO = join(root, '.demo/programs/payment_channels.so');

/** Copies the Devnet payment-channels program bytes once. Needs network only the first time. */
export function ensureChannelProgram() {
  if (existsSync(CHANNEL_SO)) return CHANNEL_SO;
  mkdirSync(dirname(CHANNEL_SO), { recursive: true });
  const dump = spawnSync('solana', ['program', 'dump', CHANNEL_PROGRAM_ID, CHANNEL_SO, '--url', 'devnet'], { encoding: 'utf8' });
  if (dump.status !== 0) throw new Error(`Could not copy the payment-channels program from Devnet: ${dump.stderr || dump.stdout}`);
  return CHANNEL_SO;
}

/** Builds the mandate program when the .so is missing. */
export function ensureMandateProgram() {
  if (existsSync(MANDATE_SO)) return MANDATE_SO;
  const build = spawnSync('anchor', ['build'], { cwd: root, encoding: 'utf8' });
  if (build.status !== 0 || !existsSync(MANDATE_SO)) throw new Error(`anchor build failed: ${build.stderr || build.stdout}`);
  return MANDATE_SO;
}

async function rpc(url, method, params = []) {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const json = await response.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

export async function startLocalValidator({ timeoutMs = 90_000 } = {}) {
  ensureMandateProgram();
  ensureChannelProgram();
  const ledger = mkdtempSync(join(tmpdir(), 'atlas-ledger-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn('solana-test-validator', [
    '--reset',
    '--quiet',
    '--ledger', ledger,
    '--rpc-port', String(port),
    '--faucet-port', String(port + 2),
    '--dynamic-port-range', `${port + 3}-${port + 30}`,
    '--bpf-program', MANDATE_PROGRAM_ID, MANDATE_SO,
    '--upgradeable-program', CHANNEL_PROGRAM_ID, CHANNEL_SO, 'none',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const rpcUrl = `http://127.0.0.1:${port}`;
  const stop = async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => { child.once('exit', resolve); setTimeout(resolve, 5000); });
    }
    rmSync(ledger, { recursive: true, force: true });
  };
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`solana-test-validator exited: ${stderr.trim() || child.exitCode}`);
    try {
      if ((await rpc(rpcUrl, 'getHealth')) === 'ok' && (await rpc(rpcUrl, 'getSlot')) > 1) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      await stop();
      throw new Error('solana-test-validator did not become healthy in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  const genesis = await rpc(rpcUrl, 'getGenesisHash');
  return { rpcUrl, genesis, stop };
}
