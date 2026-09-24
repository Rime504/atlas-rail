#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { runScenes } from './scenes';
import { DemoEnv, prepareDemo, readState } from './setup';
import { bad, c, say } from './ui';

const USAGE = `demo-agent — the narrated Agent Mandates demo

  demo-agent setup                Fund devnet keys, create the demo mint, mint an API key for the agent
  demo-agent run [options]        Run the six scenes (grant, pay, attack, escalate, prove, revoke)

Options (env vars in brackets):
  --api <url>            Atlas Rail API                 [ATLAS_API_URL, default http://localhost:3001]
  --web <url>            Console URL for links          [ATLAS_WEB_URL, default http://localhost:3000]
  --demo-api <url>       Paid x402 API                  [DEMO_API_URL, default http://localhost:4402]
  --rpc <url>            Solana RPC (devnet or mock)    [SOLANA_RPC_URL]
  --mode <devnet|mock>   Only changes wording/links     [DEMO_MODE, default devnet]
  --asset <demo-mint|circle-usdc>                       [DEMO_ASSET, default demo-mint]
  --auto-approve         Approve the escalation automatically (rehearsal / CI)
  --approval-timeout <s> How long scene 4 waits for a human (default 900)
  --only <1,2,3>         Run only these scenes
  --json-out <file>      Write a machine-readable run summary
  --keyring <path>       Devnet keyring file            [ATLAS_KEYRING_PATH, default .demo/keyring.json]
  --state <path>         Demo state file                [DEMO_STATE_FILE, default .demo/state.json]
  --cli <path>           Built atlas CLI                [default apps/cli/dist/main.js]

Devnet only. Refuses mainnet RPC endpoints.`;

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  if (!command || command === '--help' || command === '-h') {
    say(USAGE);
    return command ? 0 : 2;
  }
  const mode = (arg(args, '--mode') ?? process.env.DEMO_MODE ?? 'devnet') as DemoEnv['mode'];
  const env: DemoEnv = {
    apiUrl: arg(args, '--api') ?? process.env.ATLAS_API_URL ?? 'http://localhost:3001',
    webUrl: arg(args, '--web') ?? process.env.ATLAS_WEB_URL ?? 'http://localhost:3000',
    demoApiUrl: arg(args, '--demo-api') ?? process.env.DEMO_API_URL ?? 'http://localhost:4402',
    rpcUrl: arg(args, '--rpc') ?? process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com',
    keyringPath: resolve(arg(args, '--keyring') ?? process.env.ATLAS_KEYRING_PATH ?? '.demo/keyring.json'),
    stateFile: resolve(arg(args, '--state') ?? process.env.DEMO_STATE_FILE ?? '.demo/state.json'),
    mode,
    assetMode: (arg(args, '--asset') ?? process.env.DEMO_ASSET ?? 'demo-mint') as DemoEnv['assetMode'],
    funderSecret: process.env.DEMO_FUNDER_SECRET_KEY,
  };
  if (/mainnet/i.test(env.rpcUrl)) {
    bad('Refusing to run against a mainnet RPC endpoint: Atlas Rail is devnet only.');
    return 2;
  }
  process.env.ATLAS_KEYRING_PATH = env.keyringPath;

  if (command === 'setup') {
    await prepareDemo(env);
    return 0;
  }
  if (command === 'run') {
    const state = readState(env.stateFile) ?? (await prepareDemo(env));
    const onlyArg = arg(args, '--only');
    const summary = await runScenes({
      env,
      state,
      autoApprove: args.includes('--auto-approve'),
      approvalTimeoutMs: Number(arg(args, '--approval-timeout') ?? 900) * 1000,
      outDir: resolve(dirname(env.stateFile), 'receipts'),
      cliPath: resolve(arg(args, '--cli') ?? 'apps/cli/dist/main.js'),
      only: onlyArg ? onlyArg.split(',').map(Number) : undefined,
    });
    const out = arg(args, '--json-out');
    if (out) {
      mkdirSync(dirname(resolve(out)), { recursive: true });
      writeFileSync(resolve(out), JSON.stringify(summary, null, 2));
    }
    return summary.ok ? 0 : 1;
  }
  say(c.red(`Unknown command ${command}`));
  say(USAGE);
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    bad(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
