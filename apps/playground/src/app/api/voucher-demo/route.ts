import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Keypair } from '@solana/web3.js';
import { LOCAL_ONLY, voucherDemoHosted } from '../../../lib/voucher-demo';

const repoRoot = join(process.cwd(), '..', '..');

let tail: Promise<unknown> = Promise.resolve();

function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** The fee payer's key file, `ATLAS_FUNDER_KEY_PATH`. Read only to learn its public key. */
function feePayer(): string {
  const path = process.env.ATLAS_FUNDER_KEY_PATH;
  if (!path) throw new Error('ATLAS_FUNDER_KEY_PATH is not set');
  const secret = JSON.parse(readFileSync(resolve(repoRoot, path), 'utf8')) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secret)).publicKey.toBase58();
}

function runNode(script: string, extra: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      cwd: repoRoot,
      env: { ...process.env, TEMP: tmpdir(), TMP: tmpdir(), ATLAS_ALLOW_MOCK_SIGNER: 'true', ...extra },
      windowsHide: true,
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      err += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(err.trim() || out.trim() || `exit ${code}`));
      else resolve(out);
    });
  });
}

function parseReport(stdout: string): Record<string, unknown> {
  const start = stdout.indexOf('{');
  if (start < 0) throw new Error('Script did not return a report');
  return JSON.parse(stdout.slice(start)) as Record<string, unknown>;
}

function explorerTx(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

function explorerAddress(address: string): string {
  return `https://explorer.solana.com/address/${address}?cluster=devnet`;
}

function localOnly(): Response | null {
  return voucherDemoHosted() ? Response.json({ error: LOCAL_ONLY, localOnly: true }, { status: 501 }) : null;
}

export async function GET(): Promise<Response> {
  return localOnly() ?? Response.json({ localOnly: false });
}

export async function POST(request: Request): Promise<Response> {
  const hosted = localOnly();
  if (hosted) return hosted;
  let body: { payer?: unknown };
  try {
    body = (await request.json()) as { payer?: unknown };
  } catch {
    return Response.json({ error: 'Body must be JSON' }, { status: 400 });
  }
  if (typeof body.payer !== 'string' || body.payer.length < 32) {
    return Response.json({ error: 'Connect the devnet wallet first' }, { status: 400 });
  }
  let payer: string;
  try {
    payer = feePayer();
  } catch {
    return Response.json({ error: 'Devnet fee payer is not available on this machine' }, { status: 500 });
  }
  if (body.payer !== payer) {
    return Response.json({ error: 'Connect the devnet fee payer. This page pays from that account.' }, { status: 400 });
  }

  try {
    const result = await runExclusive(async () => {
      const settled = parseReport(
        await runNode(join(repoRoot, 'scripts/channel-voucher-devnet.mjs'), { ATLAS_FEE_PAYER: payer }),
      );
      const anchored = parseReport(await runNode(join(repoRoot, 'scripts/channel-voucher-anchor.mjs')));
      const settleSignature = String(settled.settleSignature ?? '');
      const anchorSignature = String(anchored.anchorSignature ?? '');
      const rootPda = String(anchored.rootPda ?? '');
      const channel = String(anchored.channel ?? settled.channel ?? '');
      const denial = settled.denial as { signed?: boolean; message?: string } | undefined;
      return {
        payer,
        channel,
        channelExplorer: explorerAddress(channel),
        denial: { signed: denial?.signed === true, message: denial?.message ?? null },
        settleSignature,
        settleExplorer: explorerTx(settleSignature),
        anchorSignature,
        anchorExplorer: explorerTx(anchorSignature),
        rootPda,
        rootExplorer: explorerAddress(rootPda),
        merkleRoot: anchored.merkleRoot ?? null,
        receiptId: anchored.receiptId ?? settled.receiptId ?? null,
        deposit: anchored.deposit ?? null,
        settled: anchored.settled ?? null,
      };
    });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Payment failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
