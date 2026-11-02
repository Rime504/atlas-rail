/**
 * Packs atlasrails + workspace deps as npm tarballs and installs them into a
 * clean consumer project outside the pnpm workspace. Does not publish to npm.
 * Does not broadcast.
 *
 *   node scripts/pack-sdk-consumer.mjs
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packDir = join(root, '.tmp', 'sdk-pack');
const staging = join(root, '.tmp', 'sdk-pack-staging');
const consumer = join('D:', 'atlas-rail-sdk-consumer');

const PACKAGES = [
  { dir: 'packages/config', name: '@atlas-rail/config' },
  { dir: 'packages/domain', name: '@atlas-rail/domain' },
  { dir: 'packages/mandate', name: '@atlas-rail/mandate' },
  { dir: 'packages/solana', name: '@atlas-rail/solana' },
  { dir: 'packages/receipt', name: '@atlas-rail/receipt' },
  { dir: 'packages/x402-client', name: '@atlas-rail/x402' },
  { dir: 'packages/atlasrails', name: 'atlasrails' },
];

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

function tarballName(pkg) {
  return `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`;
}

rmSync(packDir, { recursive: true, force: true });
rmSync(staging, { recursive: true, force: true });
mkdirSync(packDir, { recursive: true });
mkdirSync(staging, { recursive: true });

run('pnpm', ['--filter', 'atlasrails...', 'build'], root);

const packed = [];
for (const entry of PACKAGES) {
  const src = join(root, entry.dir);
  const pkg = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8'));
  const dest = join(staging, entry.dir.replaceAll('/', '_'));
  mkdirSync(dest, { recursive: true });
  // Copy publishable files listed in package.json files + package.json + required roots
  const files = pkg.files ?? ['dist'];
  writeFileSync(join(dest, 'package.json'), JSON.stringify(pkg, null, 2));
  for (const pattern of files) {
    if (pattern.startsWith('!')) continue;
    const from = join(src, pattern);
    if (!existsSync(from)) continue;
    cpSync(from, join(dest, pattern), { recursive: true });
  }
  // Always copy package.json fields' main tree already handled; atlasrails needs .mjs next to dist
  if (entry.name === 'atlasrails') {
    for (const extra of ['payment.mjs', 'channel-fund.mjs', 'fund.d.ts', 'MANUAL.md', 'SDK.md']) {
      const from = join(src, extra);
      if (existsSync(from)) cpSync(from, join(dest, extra));
    }
  }
  // Rewrite workspace: deps to file: tarballs already packed (or same-folder names for later install)
  const next = { ...pkg, dependencies: { ...pkg.dependencies } };
  for (const [dep, version] of Object.entries(next.dependencies ?? {})) {
    if (typeof version === 'string' && version.startsWith('workspace:')) {
      const match = PACKAGES.find((p) => p.name === dep);
      if (!match) throw new Error(`No pack recipe for ${dep}`);
      const depPkg = JSON.parse(readFileSync(join(root, match.dir, 'package.json'), 'utf8'));
      next.dependencies[dep] = `file:${join(packDir, tarballName(depPkg)).replaceAll('\\', '/')}`;
    }
  }
  // Drop workspace-only typescript-config from published package.json if present in deps (it is only in devDeps)
  writeFileSync(join(dest, 'package.json'), `${JSON.stringify(next, null, 2)}\n`);
  const out = run('npm', ['pack', '--pack-destination', packDir], dest);
  const line = out.trim().split(/\r?\n/).filter(Boolean).pop();
  packed.push({ name: pkg.name, version: pkg.version, file: join(packDir, line), tarball: line });
}

rmSync(consumer, { recursive: true, force: true });
mkdirSync(consumer, { recursive: true });
const atlas = packed.find((p) => p.name === 'atlasrails');
const consumerPkg = {
  name: 'atlas-rail-sdk-consumer',
  private: true,
  type: 'module',
  dependencies: {
    atlasrails: `file:${atlas.file.replaceAll('\\', '/')}`,
    '@solana/web3.js': '^1.95.8',
  },
};
writeFileSync(join(consumer, 'package.json'), `${JSON.stringify(consumerPkg, null, 2)}\n`);
writeFileSync(join(consumer, 'smoke.mjs'), `/**
 * Clean-consumer smoke test for atlasrails.
 * prepareOnly: requestPayment must not broadcast.
 */
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAtlasRail, connect, keypairWallet } from 'atlasrails';

const require = createRequire(import.meta.url);
const { Keypair, PublicKey } = require('@solana/web3.js');
const root = 'D:/atlas-rail-channels';
const envPath = join(root, '.env');
const env = {};
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\\r?\\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[t.slice(0, i).trim()] = v;
  }
}
const rpcUrl = env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const apiUrl = env.ATLAS_API_URL || 'http://127.0.0.1:3001';
const funderRel = env.ATLAS_FUNDER_KEY_PATH || '.demo/atlasrails-funder.json';
const funderPath = existsSync(funderRel) ? funderRel : join(root, funderRel);
const { connection, publicKey } = connect({ path: funderPath, rpcUrl });
const wallet = keypairWallet({ path: funderPath });
const atlas = createAtlasRail({ apiUrl, connection, wallet, execution: 'prepareOnly', requireOnChainMandate: false });

const report = {
  package: 'atlasrails',
  importOk: true,
  createAtlasRailOk: atlas.execution === 'prepareOnly',
  feePayer: publicKey,
  exportsSample: Object.keys(await import('atlasrails')).sort(),
  broadcast: false,
};

const channel = process.env.ATLAS_SMOKE_CHANNEL || '5R9dv5gjMkZt9yFdHS3T67X3hNAM9XZLrXxnCtaSHoif';
const statePath = join(root, '.tmp/devnet-e2e-new-channel-state.json');
let mandate = null;
if (existsSync(statePath)) {
  mandate = JSON.parse(readFileSync(statePath, 'utf8')).mandate ?? null;
}

if (mandate) {
  // Channel already has settled=1000 from the prior e2e. Cumulative must be strictly above that.
  const denied = await atlas.requestPayment({
    mandate,
    channel,
    recipient: Keypair.generate().publicKey.toBase58(),
    mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    amount: 2000n,
    resourceUrl: 'http://localhost:4402/research/summary',
    network: mandate.scope?.allowedNetworks?.[0] || 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    expiresAt: Math.floor(Date.now() / 1000) + 600,
    feePayer: publicKey,
  });
  report.deniedRequest = {
    status: denied.status,
    hasSignature: denied.status === 'denied' ? denied.hasSignature : null,
    broadcast: denied.status === 'denied' || denied.status === 'voucher_ready' ? denied.broadcast : denied.error?.broadcast,
    message: denied.status === 'denied' ? denied.message : denied.status === 'failed' ? denied.error?.message : null,
  };
  const allowed = await atlas.requestPayment({
    mandate,
    channel,
    recipient: 'Ayc7LB6Mw9pHp5e3ZH38HdLErHrpztnuyb9aT2g4nhGM',
    mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    amount: 2000n,
    resourceUrl: 'http://localhost:4402/research/summary',
    network: mandate.scope?.allowedNetworks?.[0] || 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    expiresAt: Math.floor(Date.now() / 1000) + 600,
    feePayer: publicKey,
  });
  report.allowedRequest = {
    status: allowed.status,
    broadcast: allowed.status === 'voucher_ready' ? allowed.broadcast : allowed.error?.broadcast ?? allowed.broadcast,
    voucherBytes: allowed.status === 'voucher_ready' ? allowed.voucherBytes : null,
    signatureVerified: allowed.status === 'voucher_ready' ? allowed.signatureVerified : null,
  };
  if (allowed.status === 'voucher_ready') {
    const prepared = await atlas.prepareSettlement(allowed.paymentId);
    report.prepareSettlement = {
      status: prepared.status,
      broadcast: prepared.broadcast ?? prepared.error?.broadcast,
      simulationErr: prepared.status === 'simulated' || prepared.status === 'awaiting_approval'
        ? prepared.review?.simulation?.err ?? null
        : prepared.error?.message ?? null,
    };
    const blocked = await atlas.executeSettlement(allowed.paymentId, { approval: 'settle' });
    report.executeBlockedByPrepareOnly = {
      status: blocked.status,
      code: blocked.error?.code,
      broadcast: blocked.error?.broadcast ?? false,
    };
  }
} else {
  report.requestPayment = { skipped: true, reason: 'no mandate state file' };
}

console.log(JSON.stringify(report, null, 2));
`);

const installEnv = {
  ...process.env,
  TEMP: join(root, '.tmp'),
  TMP: join(root, '.tmp'),
  npm_config_cache: join(root, '.tmp', 'npm-cache'),
};
run('npm', ['install', '--ignore-scripts'], consumer, installEnv);

const smoke = run('node', ['smoke.mjs'], consumer, installEnv);
writeFileSync(join(packDir, 'consumer-smoke.json'), smoke);
writeFileSync(join(packDir, 'PACKED.json'), `${JSON.stringify({ packed, consumer, note: 'Not published to the public npm registry' }, null, 2)}\n`);
console.log(JSON.stringify({
  ok: true,
  packDir,
  consumer,
  packed: packed.map((p) => ({ name: p.name, tarball: p.tarball })),
  smoke: JSON.parse(smoke),
  publishedToNpm: false,
}, null, 2));
