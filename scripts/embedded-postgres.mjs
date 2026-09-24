// Starts a throw-away PostgreSQL (no Docker needed) for `pnpm demo --no-docker`.
// Data lives in .demo/pgdata (git-ignored). Stop it with Ctrl+C or by killing the process.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, '.demo', 'pgdata');
const port = Number(process.env.EMBEDDED_PG_PORT ?? 54329);

let EmbeddedPostgres;
try {
  ({ default: EmbeddedPostgres } = await import('embedded-postgres'));
} catch {
  console.error('embedded-postgres is not installed. Run `pnpm install` (it is a root devDependency).');
  process.exit(1);
}

const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'atlas', password: 'atlas', port, persistent: true });
if (!fs.existsSync(path.join(dir, 'PG_VERSION'))) await pg.initialise();
await pg.start();
try {
  await pg.createDatabase('atlas_rail');
} catch {
  // already exists
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
