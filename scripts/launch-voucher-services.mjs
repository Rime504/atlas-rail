/**
 * Starts the existing API (3001) and channel-voucher signer (3012) from dist.
 * Loads the repo env without printing it. Does not generate keys.
 */
import { spawn } from 'node:child_process';
import { openSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, '.tmp'), { recursive: true });

export function serviceEnv(base = process.env) {
  const env = { ...base, TEMP: join(root, '.tmp'), TMP: join(root, '.tmp') };
  for (const line of readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    env[key] = value;
  }
  if (env.DATABASE_URL) {
    env.DATABASE_URL = env.DATABASE_URL.replace(/@(localhost|127\.0\.0\.1):5432(?!\d)/, '@127.0.0.1:54329');
  }
  env.ATLAS_KEYRING_PATH = join(root, '.demo', 'keyring.json');
  env.ATLAS_ALLOW_MOCK_SIGNER = 'true';
  env.ATLAS_SIGNER_URL = 'http://127.0.0.1:3012';
  if (env.NODE_ENV === 'production') env.NODE_ENV = 'development';
  return env;
}

function launch(name, script) {
  const fd = openSync(join(root, '.tmp', `${name}.log`), 'w');
  const child = spawn(process.execPath, [script], {
    cwd: root,
    env: serviceEnv(),
    detached: true,
    stdio: ['ignore', fd, fd],
  });
  child.unref();
  console.log(`${name} pid ${child.pid}`);
}

const which = process.argv[2] ?? 'both';
const launchedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (which === 'check-db') {
  const env = serviceEnv();
  let parsed = null;
  let error = null;
  try {
    parsed = new URL(env.DATABASE_URL);
  } catch (err) {
    error = err instanceof Error ? err.message : 'bad url';
  }
  const value = env.DATABASE_URL ?? '';
  const matched = /:\/\/([^:/@]+):[^@]*@/.test(value);
  console.log(JSON.stringify({
    error,
    protocol: parsed?.protocol ?? null,
    hostname: parsed?.hostname ?? null,
    port: parsed?.port ?? null,
    pathname: parsed?.pathname ?? null,
    username: parsed?.username ?? null,
    hasPassword: Boolean(parsed?.password),
    length: value.length,
    atSigns: (value.match(/@/g) ?? []).length,
    has5432: value.includes('5432'),
    has54329: value.includes('54329'),
    passwordShapeMatched: matched,
    prefix: value.slice(0, 13),
  }));
} else if (launchedDirectly) {
  if (which === 'api' || which === 'both') launch('api', join(root, 'apps/api/dist/main.js'));
  if (which === 'signer' || which === 'both') launch('signer', join(root, 'apps/signer/dist/main.js'));
}
