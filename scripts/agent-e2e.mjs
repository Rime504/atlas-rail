#!/usr/bin/env node
// Runs the full Agent Mandates demo end to end on devnet with on-chain anchoring (anchor_root) forced
// on, then writes reports/e2e-<date>.md: every Explorer link, p50/p95 gate latency, confirmation
// times, and anchor_root compute units + fees.
//
//   pnpm agent:e2e                 scripted agent (default), real devnet
//   AGENT_MODE=llm pnpm agent:e2e  real LLM agent — needs ANTHROPIC_API_KEY, OPENAI_API_KEY, ZAI_API_KEY, or AWS_BEARER_TOKEN_BEDROCK set
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORTS_DIR = path.join(ROOT, 'reports');
const LAST_RUN_FILE = path.join(ROOT, '.demo', 'last-run.json');

const color = process.stdout.isTTY;
const paint = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const [bold, dim, red, green] = ['1', '2', '31', '32'].map(paint);
const say = (s = '') => console.log(s);

function fmtMs(ms) {
  return ms == null ? 'n/a' : `${ms}ms`;
}

function renderLatency(label, stats) {
  if (!stats || stats.count === 0) return `- ${label}: no samples`;
  return `- ${label}: p50 ${fmtMs(stats.p50)}, p95 ${fmtMs(stats.p95)} (${stats.count} sample${stats.count === 1 ? '' : 's'})`;
}

function renderLink(label, link) {
  if (!link || !link.txSignature) return `- ${label}: (denied — nothing signed, no transaction)`;
  const memo = link.memo ? ` — memo: \`${link.memo}\`` : '';
  return `- ${label}: [${link.txSignature}](${link.explorerUrl})${memo}`;
}

function buildReport(summary, { ok, exitCode }) {
  const scenes = summary?.scenes ?? {};
  const metrics = summary?.metrics;
  const lines = [];
  lines.push(`# Agent e2e run — ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`Result: **${ok ? 'PASS' : 'FAIL'}** (exit code ${exitCode}). Agent model: ${metrics?.agentModel ?? 'unknown'}.`);
  lines.push('');
  lines.push('## Explorer links');
  lines.push(renderLink('Grant (mandate registered on-chain)', scenes.grant?.onchain));
  lines.push(renderLink('Pay (settled payment)', scenes.pay));
  lines.push(renderLink('Escalate (human-approved payment)', scenes.escalate));
  lines.push(renderLink('Prove (receipts anchored)', scenes.prove?.anchorTx));
  lines.push(renderLink('Revoke (mandate revoked on-chain)', scenes.revoke?.onchain));
  lines.push('');
  lines.push('## Latency');
  lines.push(renderLatency('Gate decision latency', metrics?.gateLatencyMs));
  lines.push(renderLatency('Payment confirmation latency', metrics?.confirmationLatencyMs));
  lines.push('');
  lines.push('## anchor_root');
  if (metrics?.anchorRoot) {
    lines.push(`- Transaction: [${metrics.anchorRoot.txSignature}](${metrics.anchorRoot.explorerUrl})`);
    lines.push(`- Compute units: ${metrics.anchorRoot.computeUnits ?? 'n/a'}`);
    lines.push(`- Fee: ${metrics.anchorRoot.feeLamports != null ? `${metrics.anchorRoot.feeLamports} lamports` : 'n/a'}`);
  } else {
    lines.push('- Not anchored via anchor_root this run (ATLAS_ANCHOR_ROOT was off, or anchoring did not run).');
  }
  lines.push('');
  lines.push('## Attack scenes');
  lines.push(`- Prompt injection: ${scenes.attack?.denied ? 'denied, as designed' : 'NOT DENIED — unexpected'}`);
  lines.push(`- Seller price creep: ${scenes.priceLimit?.denied ? 'denied (PRICE_LIMIT), as designed' : 'NOT DENIED — unexpected'}`);
  lines.push('');
  return lines.join('\n');
}

function main() {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.rmSync(LAST_RUN_FILE, { force: true });

  const env = {
    ...process.env,
    ATLAS_ONCHAIN: '1',
    ATLAS_ANCHOR_ROOT: '1',
  };
  say(bold('\nAgent e2e — full devnet flow with anchor_root'));
  say(dim(`agent mode: ${env.AGENT_MODE ?? 'scripted'}${env.AGENT_MODE === 'llm' ? ` (${env.AGENT_PROVIDER ?? 'anthropic'})` : ''}\n`));

  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'demo.mjs'), '--no-docker', '--skip-web', '--auto-approve', '--exit'],
    { cwd: ROOT, env, stdio: 'inherit' },
  );
  const exitCode = result.status ?? 1;

  let summary = null;
  try {
    summary = JSON.parse(fs.readFileSync(LAST_RUN_FILE, 'utf8'));
  } catch {
    say(red(`\nCould not read ${LAST_RUN_FILE} — the demo likely failed before the scenes ran.`));
  }
  const ok = exitCode === 0 && summary?.ok === true;

  const date = new Date().toISOString().slice(0, 10);
  const reportFile = path.join(REPORTS_DIR, `e2e-${date}.md`);
  fs.writeFileSync(reportFile, buildReport(summary, { ok, exitCode }));
  say(`\n${ok ? green('PASS') : red('FAIL')} — report written to ${path.relative(ROOT, reportFile)}`);

  process.exit(exitCode);
}

main();
