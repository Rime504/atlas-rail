#!/usr/bin/env node
// One-command orchestrator for the Agent Mandates demo.
//
//   pnpm demo                   devnet, Docker for Postgres + Redis
//   pnpm demo:offline           in-memory Solana JSON-RPC (no devnet, no solana-test-validator)
//   pnpm demo:rehearse          offline + auto-approve + exit when the scenes finish (CI / dress rehearsal)
//
// Flags: --offline --auto-approve --no-docker --skip-build --skip-web --exit --rpc <url> --asset <demo-mint|circle-usdc>
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEMO_DIR = path.join(ROOT, '.demo');
const LOG_DIR = path.join(DEMO_DIR, 'logs');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => (argv.indexOf(f) >= 0 ? argv[argv.indexOf(f) + 1] : undefined);

const OFFLINE = has('--offline');
const NO_DOCKER = has('--no-docker');
const AUTO_APPROVE = has('--auto-approve');
const SKIP_BUILD = has('--skip-build');
const SKIP_WEB = has('--skip-web');
const EXIT_AFTER = has('--exit');
const ASSET = val('--asset') ?? process.env.DEMO_ASSET ?? 'demo-mint';

const PORTS = { web: 3000, api: 3001, demoApi: 4402, facilitator: 4022, mock: 8899, pg: NO_DOCKER ? 54329 : 5432, redis: 6379 };
const RPC_URL = val('--rpc') ?? (OFFLINE ? `http://127.0.0.1:${PORTS.mock}` : process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com');
const DATABASE_URL = `postgresql://atlas:atlas@localhost:${PORTS.pg}/atlas_rail?schema=public`;

const color = process.stdout.isTTY;
const paint = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const [bold, dim, red, green, yellow, cyan] = ['1', '2', '31', '32', '33', '36'].map(paint);
const say = (s = '') => console.log(s);
const step = (s) => say(`${cyan('▸')} ${bold(s)}`);
const okay = (s) => say(`  ${green('✔')} ${s}`);
const fatal = (s) => {
  say(`\n${red('✖')} ${s}`);
  shutdown(1);
};

const children = [];
let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children.reverse()) {
    try {
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));

/* ---- helpers ------------------------------------------------------------------------------------ */

fs.mkdirSync(LOG_DIR, { recursive: true });
const binDir = path.join(DEMO_DIR, 'bin');
const childPath = () => `${binDir}${path.delimiter}${process.env.PATH}`;

function ensurePnpm() {
  const direct = spawnSync('pnpm', ['--version'], { shell: true, stdio: 'ignore' });
  if (direct.status === 0) return;
  const viaCorepack = spawnSync('corepack', ['pnpm', '--version'], { shell: true, stdio: 'ignore' });
  if (viaCorepack.status !== 0) fatal('pnpm is required (npm i -g pnpm, or enable corepack).');
  // Child tools (turbo, prisma scripts) shell out to `pnpm`; give them a shim that forwards to corepack.
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'pnpm.cmd'), '@corepack pnpm %*\r\n');
  const sh = path.join(binDir, 'pnpm');
  fs.writeFileSync(sh, '#!/bin/sh\nexec corepack pnpm "$@"\n');
  fs.chmodSync(sh, 0o755);
}

function baseEnv() {
  const env = {
    ...process.env,
    PATH: childPath(),
    NODE_ENV: 'development',
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
    DATABASE_URL,
    REDIS_URL: `redis://localhost:${PORTS.redis}`,
    API_PORT: String(PORTS.api),
    API_BASE_URL: `http://localhost:${PORTS.api}`,
    NEXT_PUBLIC_API_BASE_URL: `http://localhost:${PORTS.api}`,
    JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? 'atlas_rail_dev_access_secret_do_not_use_in_production_32bytes',
    JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET ?? 'atlas_rail_dev_refresh_secret_do_not_use_in_production_32bytes',
    ENCRYPTION_KEY_BASE64: process.env.ENCRYPTION_KEY_BASE64 ?? 'c29tZV9zZWNyZXRfMzJfYnl0ZV9rZXlfZm9yX2RldnZ2',
    SOLANA_RPC_URL: RPC_URL,
    SOLANA_USDC_MINT: process.env.SOLANA_USDC_MINT ?? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    ATLAS_ALLOW_MOCK_SIGNER: 'true',
    ATLAS_MAINNET_ENABLED: 'false',
    ATLAS_KEYRING_PATH: path.join(DEMO_DIR, 'keyring.json'),
    MOCK_VALIDATOR_PORT: String(PORTS.mock),
    FACILITATOR_PORT: String(PORTS.facilitator),
    FACILITATOR_URL: `http://127.0.0.1:${PORTS.facilitator}`,
    DEMO_API_PORT: String(PORTS.demoApi),
    DEMO_API_URL: `http://localhost:${PORTS.demoApi}`,
    ATLAS_API_URL: `http://localhost:${PORTS.api}`,
    ATLAS_WEB_URL: `http://localhost:${PORTS.web}`,
    DEMO_MODE: OFFLINE ? 'mock' : 'devnet',
    DEMO_ASSET: ASSET,
    WEBHOOK_ALLOW_PRIVATE_NETWORKS: 'true',
  };
  if (ASSET === 'circle-usdc') env.DEMO_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  return env;
}

function runSync(cmd, args, options = {}) {
  // Node is invoked directly (its path may contain spaces); package-manager/docker shims need a shell on Windows.
  const needsShell = process.platform === 'win32' && cmd !== process.execPath;
  const res = spawnSync(cmd, args, { cwd: ROOT, env: baseEnv(), stdio: 'inherit', shell: needsShell, ...options });
  if (res.status !== 0) fatal(`Command failed: ${cmd} ${args.join(' ')}`);
}

function startProcess(name, cmd, args, { cwd = ROOT, env = {} } = {}) {
  const logFile = path.join(LOG_DIR, `${name}.log`);
  const out = fs.openSync(logFile, 'w');
  const child = spawn(cmd, args, { cwd, env: { ...baseEnv(), ...env }, stdio: ['ignore', out, out], detached: process.platform !== 'win32', shell: false });
  child.exited = false;
  child.on('exit', (code) => {
    child.exited = true;
    if (!shuttingDown && code !== 0) {
      say(red(`\n${name} exited with code ${code}. Last log lines (${logFile}):`));
      say(dim(fs.readFileSync(logFile, 'utf8').split('\n').slice(-25).join('\n')));
      shutdown(1);
    }
  });
  children.push(child);
  return { child, logFile };
}

async function waitFor(check, label, timeoutMs = 120_000) {
  const started = Date.now();
  for (;;) {
    try {
      if (await check()) return;
    } catch {
      /* not ready */
    }
    if (Date.now() - started > timeoutMs) fatal(`Timed out waiting for ${label}. Logs are in ${LOG_DIR}`);
    await new Promise((r) => setTimeout(r, 750));
  }
}

const httpOk = (url) => async () => (await fetch(url)).ok;
const portOpen = (port) => () =>
  new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('error', () => resolve(false));
  });

async function assertPortsFree(ports) {
  for (const [name, port] of ports) {
    if (await portOpen(port)()) fatal(`Port ${port} (${name}) is already in use. Stop the other process (or a previous demo) and retry.`);
  }
}

/* ---- main --------------------------------------------------------------------------------------- */

async function main() {
  say(bold('\nAtlas Rail — Agent Mandates demo'));
  say(dim(`mode: ${OFFLINE ? 'OFFLINE (in-memory Solana JSON-RPC)' : 'Solana DEVNET'} · database: ${NO_DOCKER ? 'embedded Postgres' : 'Docker'} · asset: ${ASSET}`));
  say(dim('DEVNET ONLY · no real funds move · Atlas Rail never takes custody of production keys (see SECURITY.md)\n'));
  if (/mainnet/i.test(RPC_URL)) fatal('Refusing to run: mainnet RPC endpoints are prohibited. Atlas Rail is devnet only.');
  if (Number(process.versions.node.split('.')[0]) < 22) fatal(`Node 22+ is required (found ${process.versions.node}).`);
  ensurePnpm();

  const wanted = [['api', PORTS.api], ['demo API', PORTS.demoApi], ['facilitator', PORTS.facilitator]];
  if (!SKIP_WEB) wanted.push(['web console', PORTS.web]);
  if (OFFLINE) wanted.push(['mock validator', PORTS.mock]);
  await assertPortsFree(wanted);

  if (!fs.existsSync(path.join(ROOT, '.env')) && fs.existsSync(path.join(ROOT, '.env.example'))) {
    fs.copyFileSync(path.join(ROOT, '.env.example'), path.join(ROOT, '.env'));
    okay('created .env from .env.example');
  }

  // 1. Build
  if (!SKIP_BUILD) {
    step('Building services (turbo, cached after the first run)');
    const filters = ['api', 'worker', 'demo-api', 'demo-agent', 'cli', 'mock-validator', ...(SKIP_WEB ? [] : ['web'])].map((n) => `--filter=@atlas-rail/${n}`);
    runSync('pnpm', ['turbo', 'run', 'build', ...filters]);
    okay('build complete');
  }

  // 2. Database (+ Redis)
  step(NO_DOCKER ? 'Starting embedded PostgreSQL' : 'Starting PostgreSQL and Redis with Docker');
  if (NO_DOCKER) {
    const pg = startProcess('postgres', process.execPath, [path.join(ROOT, 'scripts', 'embedded-postgres.mjs')]);
    await waitFor(async () => fs.readFileSync(pg.logFile, 'utf8').includes('PG READY'), 'embedded PostgreSQL', 180_000);
    say(dim('  (no Redis: payout workers are skipped; the agent demo does not need them)'));
  } else {
    const docker = spawnSync('docker', ['--version'], { shell: true, stdio: 'ignore' });
    if (docker.status !== 0) fatal('Docker was not found. Install Docker Desktop, or run `pnpm demo --no-docker` to use an embedded Postgres.');
    runSync('docker', ['compose', 'up', '-d', 'postgres', 'redis']);
    await waitFor(portOpen(PORTS.pg), 'PostgreSQL', 90_000);
    await waitFor(async () => spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'pg_isready', '-U', 'atlas', '-d', 'atlas_rail'], { cwd: ROOT, shell: true }).status === 0, 'PostgreSQL to accept connections', 90_000);
  }
  okay('database is up');

  step('Applying migrations and seeding demo data');
  runSync('pnpm', ['--filter', '@atlas-rail/database', 'exec', 'prisma', 'migrate', 'deploy']);
  runSync('pnpm', ['--filter', '@atlas-rail/database', 'db:seed']);
  okay('database ready');

  // 3. Services
  if (OFFLINE) {
    step('Starting the offline Solana JSON-RPC (in-memory cluster)');
    startProcess('mock-validator', process.execPath, ['apps/mock-validator/dist/main.js']);
    await waitFor(httpOk(`http://127.0.0.1:${PORTS.mock}/health`), 'mock validator', 30_000);
    okay(`mock cluster on ${RPC_URL}`);
  }

  step('Starting the Atlas Rail API');
  startProcess('api', process.execPath, ['apps/api/dist/main.js']);
  await waitFor(httpOk(`http://localhost:${PORTS.api}/health/live`), 'API', 120_000);
  okay(`API on http://localhost:${PORTS.api} (docs: /docs)`);

  if (!NO_DOCKER) {
    startProcess('worker', process.execPath, ['apps/worker/dist/main.js']);
    okay('worker started');
  }

  step('Preparing devnet assets: keys, SOL, demo mint, agent API key');
  runSync(process.execPath, ['apps/demo-agent/dist/main.js', 'setup']);

  step('Starting the x402 facilitator and the paid demo API');
  startProcess('facilitator', process.execPath, ['apps/demo-api/dist/facilitator-main.js']);
  await waitFor(httpOk(`http://127.0.0.1:${PORTS.facilitator}/health`), 'facilitator', 30_000);
  startProcess('demo-api', process.execPath, ['apps/demo-api/dist/main.js']);
  await waitFor(httpOk(`http://127.0.0.1:${PORTS.demoApi}/health`), 'demo API', 30_000);
  okay(`demo API on http://localhost:${PORTS.demoApi}, facilitator on :${PORTS.facilitator}`);

  if (!SKIP_WEB) {
    step('Starting the console');
    const nextBin = path.join(ROOT, 'apps', 'web', 'node_modules', 'next', 'dist', 'bin', 'next');
    startProcess('web', process.execPath, [nextBin, 'start', '-p', String(PORTS.web)], { cwd: path.join(ROOT, 'apps', 'web') });
    await waitFor(httpOk(`http://localhost:${PORTS.web}/login`), 'web console', 60_000);
    okay(`console on http://localhost:${PORTS.web}  (login: owner@atlasrail.local / ChangeMe_AtlasRail_DevOnly)`);
  }

  // 4. Scenes
  say(`\n${bold('Everything is up.')} ${SKIP_WEB ? '' : `Open ${cyan(`http://localhost:${PORTS.web}/decisions`)} to watch decisions live.`}`);
  const sceneArgs = ['apps/demo-agent/dist/main.js', 'run', '--json-out', '.demo/last-run.json', ...(AUTO_APPROVE ? ['--auto-approve'] : [])];
  const scenes = spawnSync(process.execPath, sceneArgs, { cwd: ROOT, env: baseEnv(), stdio: 'inherit' });
  const success = scenes.status === 0;

  if (EXIT_AFTER || AUTO_APPROVE) {
    shutdown(success ? 0 : 1);
    return;
  }
  say(`\n${success ? green('Scenes finished.') : red('Scenes finished with failures.')} Services stay up so you can explore the console. Press Ctrl+C to stop.`);
  await new Promise(() => {});
}

main().catch((error) => {
  if (error instanceof Abort) return;
  try {
    fatal(error instanceof Error ? error.stack ?? error.message : String(error));
  } catch {
    /* shutdown already scheduled */
  }
});
