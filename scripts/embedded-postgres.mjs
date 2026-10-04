// Starts a throw-away PostgreSQL (no Docker needed) for `pnpm demo --no-docker`.
// Data lives in .demo/pgdata (git-ignored). Stop it with Ctrl+C or by killing the process.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, '.demo', 'pgdata');
const port = Number(process.env.EMBEDDED_PG_PORT ?? 54329);

// On Windows, embedded-postgres's own stop() force-kills the process tree (`taskkill /f /t`),
// which can race with Postgres re-exec'ing a new worker (Windows has no fork(); each "forked"
// backend is a fresh postgres.exe with --forkchild=...) and leave one behind holding the shared
// memory segment — the next start then fails with "pre-existing shared memory block is still in
// use". Clean up any such orphan from a previous run before starting. Matched on the vendored
// package name rather than a full path: Postgres re-execs forked backends using forward slashes
// internally regardless of how the original postmaster was spawned, so a match against this
// process's own (backslash) path would silently miss every forked worker. "embedded-postgres" is
// specific to our vendored binary, so this can't touch an unrelated Postgres on the machine.
async function killStrayInstances() {
  if (process.platform !== 'win32') return;
  const script = `Get-CimInstance Win32_Process -Filter "Name='postgres.exe'" | Where-Object { $_.CommandLine -like '*embedded-postgres*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  await new Promise((resolve) => {
    const p = spawn('powershell', ['-NoProfile', '-Command', script], { stdio: 'ignore' });
    p.on('close', resolve);
    p.on('error', resolve);
  });
}

let EmbeddedPostgres;
try {
  ({ default: EmbeddedPostgres } = await import('embedded-postgres'));
} catch {
  console.error('embedded-postgres is not installed. Run `pnpm install` (it is a root devDependency).');
  process.exitCode = 1;
  process.exit(1);
}

const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'atlas', password: 'atlas', port, persistent: true });

try {
  await killStrayInstances();
  if (!fs.existsSync(path.join(dir, 'PG_VERSION'))) await pg.initialise();
  await pg.start();
  try {
    await pg.createDatabase('atlas_rail');
  } catch {
    // already exists
  }
} catch (err) {
  console.error('Failed to start embedded PostgreSQL.');
  console.error(err instanceof Error && err.message ? err.message : 'The postgres process exited before reporting it was ready — see the log lines above for the actual Postgres error.');
  console.error('If the log above says "pre-existing shared memory block is still in use" or "lock file already exists": a stray postgres.exe from a previous run is holding it. This script already tries to clean those up automatically; if it still happens, end postgres.exe in Task Manager, or delete .demo/pgdata if you do not need its data.');
  process.exitCode = 1;
  process.exit(1);
}

console.log('PG READY');

const stop = async () => {
  try {
    await pg.stop();
  } finally {
    process.exit(0);
  }
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
