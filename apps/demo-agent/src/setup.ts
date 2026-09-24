import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { Keypair } from '@solana/web3.js';
import { base58 } from '@scure/base';
import { DevnetKeyring, FundableChain, Web3ChainClient, ensureAta, ensureMint, ensureSol, mintTokens } from '@atlas-rail/solana';
import { ConsoleApi, DEMO_PASSWORD, DEMO_USERS } from './console-api';
import { c, info, ok, short, step } from './ui';

const CIRCLE_DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

export interface DemoEnv {
  apiUrl: string;
  rpcUrl: string;
  webUrl: string;
  demoApiUrl: string;
  keyringPath: string;
  stateFile: string;
  mode: 'devnet' | 'mock';
  /** `demo-mint`: create our own USDC-like mint (reliable). `circle-usdc`: use Circle's devnet USDC (fund it from faucet.circle.com). */
  assetMode: 'demo-mint' | 'circle-usdc';
  funderSecret?: string;
}

export interface DemoState {
  mode: DemoEnv['mode'];
  assetMode: DemoEnv['assetMode'];
  mint: string;
  decimals: number;
  agent: string;
  merchant: string;
  facilitator: string;
  attacker: string;
  instance: string;
  funder: string;
  apiKey: string;
}

function parseSecret(secret: string): Uint8Array {
  const trimmed = secret.trim();
  return trimmed.startsWith('[') ? Uint8Array.from(JSON.parse(trimmed) as number[]) : base58.decode(trimmed);
}

export function readState(file: string): DemoState | null {
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as DemoState) : null;
}

/**
 * Idempotent devnet preparation: keys, SOL, the demo mint and balances, and an API key for the agent.
 * Safe to re-run; it only tops up what is missing. The public devnet faucet is rate limited, so it
 * retries with backoff and can draw from a wallet you funded yourself (DEMO_FUNDER_SECRET_KEY).
 */
export async function prepareDemo(env: DemoEnv): Promise<DemoState> {
  const keyring = DevnetKeyring.load(env.keyringPath);
  const chain = Web3ChainClient.fromUrl(env.rpcUrl) as unknown as FundableChain;
  const kp = (label: string) => Keypair.fromSecretKey(keyring.signer(label).exportSecretKey());

  const funder = env.funderSecret ? Keypair.fromSecretKey(parseSecret(env.funderSecret)) : kp('funder');
  const facilitator = kp('facilitator');
  const merchant = kp('merchant');
  const agent = kp('agent');
  const attacker = kp('attacker');
  const instance = kp('instance');
  const log = (m: string) => info(m);

  step(`Funding devnet keys (${env.mode === 'mock' ? 'offline mock cluster' : 'public devnet faucet, with retry and fallback'})`);
  await ensureSol(chain, funder.publicKey.toBase58(), 1_000_000_000n, { log });
  await ensureSol(chain, facilitator.publicKey.toBase58(), 100_000_000n, { funder, preferFunder: true, log });
  await ensureSol(chain, instance.publicKey.toBase58(), 100_000_000n, { funder, preferFunder: true, log });
  ok(`funder ${short(funder.publicKey.toBase58())}  facilitator ${short(facilitator.publicKey.toBase58())}  instance ${short(instance.publicKey.toBase58())}`);

  let mintAddress: string;
  if (env.assetMode === 'circle-usdc') {
    mintAddress = CIRCLE_DEVNET_USDC;
    await ensureAta(chain, funder, merchant.publicKey.toBase58(), mintAddress);
    const balance = await chain.getTokenBalance(agent.publicKey.toBase58(), mintAddress);
    if (balance < 50_000_000n) {
      throw new Error(
        `The agent wallet ${agent.publicKey.toBase58()} holds ${Number(balance) / 1e6} devnet USDC. ` +
          `Get at least 50 devnet USDC for it from https://faucet.circle.com (network: Solana Devnet) and re-run, or use the default demo mint (DEMO_ASSET=demo-mint).`,
      );
    }
    ok(`using Circle devnet USDC ${short(mintAddress)}; agent holds ${Number(balance) / 1e6}`);
  } else {
    const mint = kp('demo-mint');
    mintAddress = mint.publicKey.toBase58();
    const created = await ensureMint(chain, funder, mint, 6);
    await ensureAta(chain, funder, merchant.publicKey.toBase58(), mintAddress);
    const balance = await chain.getTokenBalance(agent.publicKey.toBase58(), mintAddress);
    if (balance < 100_000_000n) await mintTokens(chain, funder, funder, mintAddress, agent.publicKey.toBase58(), 100_000_000n - balance);
    ok(`${created ? 'created' : 'reusing'} demo USDC mint ${short(mintAddress)}; agent holds 100.00`);
  }

  // API key for the agent, created as the org owner.
  const api = new ConsoleApi(env.apiUrl);
  const previous = readState(env.stateFile);
  let apiKey = previous?.apiKey ?? '';
  if (apiKey) {
    try {
      await api.get('/v1/agent/gate/mandates/mnd_probe', { apiKey });
    } catch (error) {
      // 404 = the key works (mandate simply doesn't exist); 401 = revoked or from another database.
      if (!(error instanceof Error && error.message.includes('→ 404'))) apiKey = '';
    }
  }
  if (!apiKey) {
    const owner = await api.login(DEMO_USERS.owner, DEMO_PASSWORD);
    const created = await api.post<{ secretKey: string }>('/v1/api-keys', { token: owner }, { name: `demo-agent ${new Date().toISOString()}`, scopes: ['*'] });
    apiKey = created.secretKey;
    ok('created an API key for the agent (role DEVELOPER: can only call the gate)');
  } else {
    ok('reusing the agent API key');
  }

  const state: DemoState = {
    mode: env.mode,
    assetMode: env.assetMode,
    mint: mintAddress,
    decimals: 6,
    agent: agent.publicKey.toBase58(),
    merchant: merchant.publicKey.toBase58(),
    facilitator: facilitator.publicKey.toBase58(),
    attacker: attacker.publicKey.toBase58(),
    instance: instance.publicKey.toBase58(),
    funder: funder.publicKey.toBase58(),
    apiKey,
  };
  mkdirSync(dirname(env.stateFile), { recursive: true });
  writeFileSync(env.stateFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  say(c.dim(`  state written to ${env.stateFile}`));
  return state;
}

function say(line: string) {
  console.log(line);
}
