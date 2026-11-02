/**
 * Ten devnet runs of this week's path, paid by DEMO_FUNDER_SECRET_KEY:
 * ask Atlas Rail → gate → sign only if allowed → settle on the channel program → anchor_root.
 * Each run also asks for one voucher the gate must refuse. No secrets are printed.
 *
 * Run from the repo root: node scripts/week-channel-devnet.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { serviceEnv } from './launch-voucher-services.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const requireSolana = createRequire(join(root, 'packages/solana/package.json'));
const { Connection, PublicKey } = requireSolana('@solana/web3.js');
const RUNS = Number(process.env.WEEK_RUNS ?? 10);
const WALLET = '2Qy24Ut2fDfj1SXBQbzBpvEEX8QZcStcZng6M3ravpsb';
const CHANNEL_PROGRAM = 'CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX';
const MANDATE_PROGRAM = 'CnGoTE5Bxc8MFGaeK5LDv5uAZ7pNiktMunYy8JZcLY4k';
const ED25519 = 'Ed25519SigVerify111111111111111111111111111';
const RPC = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

function report(body) {
  const path = join(root, 'reports', 'week-channel-devnet.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(body, null, 2));
  console.log(path);
}

function run(script) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(root, 'scripts', script)], { cwd: root, env: process.env, stdio: 'inherit' });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

function readJson(name) {
  return JSON.parse(readFileSync(join(root, 'reports', name), 'utf8'));
}

function resume() {
  try {
    const body = readJson('week-channel-devnet.json');
    return Array.isArray(body.runs) ? body.runs : [];
  } catch {
    return [];
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry(label, fn) {
  let last;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      console.log(`${label} attempt ${attempt} failed, waiting`);
      await sleep(attempt * 10000);
    }
  }
  throw last;
}

function accountKeys(tx) {
  const message = tx.transaction.message;
  const keys = message.accountKeys ?? message.staticAccountKeys ?? [];
  return keys.map((key) => (typeof key === 'string' ? key : key.toBase58()));
}

async function confirmed(connection, signature) {
  const tx = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
  if (!tx) throw new Error(`Transaction ${signature} is not on devnet`);
  if (tx.meta?.err) throw new Error(`Transaction ${signature} failed on devnet`);
  return tx;
}

async function main() {
  Object.assign(process.env, serviceEnv());
  process.env.ATLAS_FEE_PAYER = WALLET;
  process.env.ATLAS_ALLOW_MOCK_SIGNER = 'true';
  const connection = new Connection(RPC, 'confirmed');
  const signer = await fetch('http://127.0.0.1:3012/v1/public-key');
  if (!signer.ok) throw new Error('Signer is down');
  const runs = resume();
  const known = new Set(runs.map((row) => row.channel));
  let pending = null;
  try {
    const leftover = readJson('channel-voucher-devnet.json');
    if (leftover.channel && leftover.settleSignature && !known.has(leftover.channel)) pending = leftover;
  } catch {
    pending = null;
  }
  for (let n = runs.length + 1; n <= RUNS; n++) {
    console.log(`\nrun ${n}/${RUNS}`);
    let settlement = pending;
    pending = null;
    if (!settlement) {
      let channelCode = 1;
      for (let attempt = 1; attempt <= 4; attempt++) {
        channelCode = await run('channel-voucher-devnet.mjs');
        if (channelCode === 0) break;
        console.log(`run ${n} attempt ${attempt} exited ${channelCode}, waiting`);
        await sleep(attempt * 15000);
      }
      if (channelCode !== 0) throw new Error(`Channel run ${n} exited ${channelCode}`);
      settlement = readJson('channel-voucher-devnet.json');
    }
    if (settlement.denial?.signed !== false) throw new Error(`Run ${n} signed the refused voucher`);
    if (settlement.settled !== '10000' || settlement.payeeReceived !== '10000' || settlement.payerRemainder !== '10000') {
      throw new Error(`Run ${n} did not settle 10000 and return 10000`);
    }
    let anchored = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      const anchorCode = await run('channel-voucher-anchor.mjs');
      if (anchorCode === 0) {
        anchored = readJson('channel-voucher-anchor.json');
        break;
      }
      console.log(`run ${n} anchor attempt ${attempt} exited ${anchorCode}, waiting`);
      await sleep(attempt * 20000);
    }
    if (!anchored) throw new Error(`Anchor run ${n} exited 1`);
    if (anchored.ok !== true) throw new Error(`Run ${n} anchor_root check failed`);

    const settleTx = await withRetry(`run ${n} settle read`, () => confirmed(connection, settlement.settleSignature));
    const anchorTx = await withRetry(`run ${n} anchor read`, () => confirmed(connection, anchored.anchorSignature));
    const settleKeys = accountKeys(settleTx);
    const anchorKeys = accountKeys(anchorTx);
    if (!settleKeys.includes(WALLET) || !settleKeys.includes(CHANNEL_PROGRAM) || !settleKeys.includes(ED25519)) {
      throw new Error(`Run ${n} settle transaction is missing the wallet, channel program, or signature check`);
    }
    if (settleTx.transaction.message.accountKeys?.[0]?.toBase58?.() !== WALLET && settleKeys[0] !== WALLET) {
      throw new Error(`Run ${n} settle fee payer is not the wallet`);
    }
    if (!anchorKeys.includes(MANDATE_PROGRAM)) throw new Error(`Run ${n} anchor transaction is missing the mandate program`);
    const decision = settlement.receipt?.decision;
    if (!decision?.instance?.signature || decision.record?.decision !== 'ALLOW') throw new Error(`Run ${n} receipt is not an Atlas Rail allow`);
    runs.push({
      n,
      wallet: WALLET,
      channel: settlement.channel,
      refused: settlement.denial,
      settled: settlement.settled,
      payeeReceived: settlement.payeeReceived,
      payerRemainder: settlement.payerRemainder,
      receiptId: anchored.receiptId,
      mandatePda: anchored.mandatePda,
      merkleRoot: anchored.merkleRoot,
      settle: `https://explorer.solana.com/tx/${settlement.settleSignature}?cluster=devnet`,
      anchor: `https://explorer.solana.com/tx/${anchored.anchorSignature}?cluster=devnet`,
      onchain: { settleErr: null, anchorErr: null, settleFeePayer: settleKeys[0], anchorIncludesMandateProgram: true },
    });
    report({ ok: false, done: runs.length, runs });
    await sleep(8000);
  }
  report({ ok: true, wallet: WALLET, runs });
  console.log(JSON.stringify({ ok: true, runs: runs.length }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
