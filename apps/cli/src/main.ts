#!/usr/bin/env node
import { runVerify, runVerifyMandate } from './verify';

const USAGE = `atlas — verify Atlas Rail agent-payment evidence

Usage:
  atlas verify <receipt.json> [options]     Verify a bound receipt
  atlas mandate <mandate.json>              Verify a mandate's delegation chain

Options for verify:
  --rpc <url>            Solana devnet RPC (default: $SOLANA_RPC_URL or https://api.devnet.solana.com)
  --offline              Do not contact any RPC; on-chain checks are reported as SKIP
  --trusted-key <pubkey> Pin the Atlas Rail instance key (repeatable). Strongly recommended.
  --check-settlement     Also read the settlement transaction and confirm it matches the offer
  --require-anchor       Fail (instead of skip) if the receipt is not yet anchored
  --json                 Machine-readable output
  --no-color             Disable colours

Exit codes: 0 PASS · 1 FAIL · 2 usage or I/O error

Mainnet endpoints are refused: Atlas Rail v1 is devnet only.`;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') {
    console.log(USAGE);
    return command ? 0 : 2;
  }

  const trustedKeys: string[] = [];
  const positional: string[] = [];
  let rpc: string | null = null;
  let offline = false;
  let checkSettlement = false;
  let requireAnchor = false;
  let json = false;
  let color = process.stdout.isTTY === true && !process.env.NO_COLOR;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--rpc') rpc = rest[++i] ?? null;
    else if (arg === '--trusted-key') {
      const key = rest[++i];
      if (key) trustedKeys.push(key);
    } else if (arg === '--offline') offline = true;
    else if (arg === '--check-settlement') checkSettlement = true;
    else if (arg === '--require-anchor') requireAnchor = true;
    else if (arg === '--json') json = true;
    else if (arg === '--no-color') color = false;
    else if (arg === '--color') color = true;
    else if (arg.startsWith('--')) {
      console.error(`Unknown option ${arg}\n\n${USAGE}`);
      return 2;
    } else positional.push(arg);
  }

  const file = positional[0];
  if (!file) {
    console.error(`Missing file argument\n\n${USAGE}`);
    return 2;
  }

  if (command === 'verify') {
    return runVerify({ file, rpc, offline, trustedKeys, checkSettlement, requireAnchor, json, color });
  }
  if (command === 'mandate') {
    return runVerifyMandate(file, color);
  }
  console.error(`Unknown command ${command}\n\n${USAGE}`);
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  },
);
