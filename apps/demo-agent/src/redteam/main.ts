/**
 * pnpm redteam [--devnet] [--repetitions N]
 *
 * Runs every red-team case on the in-memory cluster (the same suite CI runs), then, with --devnet,
 * the cases marked `devnet: true` once against real Solana devnet. Writes reports/redteam-<date>.md
 * and exits non-zero — loudly — if any value ever leaves the wallet outside the mandate.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { CASES } from './cases';
import { CaseOutcome, renderReport, runCase } from './harness';
import { memoryRig } from './memory-rig';
import { devnetRig } from './devnet-rig';
import { ConcurrencyResult, renderConcurrency, runConcurrencyProof, unlockedMemoryStore } from './concurrency';
import { InMemoryAgentStore } from '@atlas-rail/mandate';

async function main() {
  const args = process.argv.slice(2);
  const repetitions = Number(args[args.indexOf('--repetitions') + 1]) || 3;
  const withDevnet = args.includes('--devnet');
  const root = process.env.INIT_CWD ?? process.cwd();
  const date = new Date().toISOString().slice(0, 10);
  const extra: string[] = [];
  let leaked = 0n;

  const memory: CaseOutcome[] = [];
  for (const c of CASES) {
    for (let rep = 1; rep <= repetitions; rep++) memory.push(await runCase(c, await memoryRig(c.world ?? {}), rep));
  }
  leaked += memory.reduce((n, o) => n + o.outsideMandateBaseUnits, 0n);
  console.log(`in-memory: ${memory.filter((o) => o.pass).length}/${memory.length} case runs passed`);

  const concurrency: ConcurrencyResult[] = [await runConcurrencyProof(new InMemoryAgentStore(), 'org_test', 'In-memory store')];
  const dbUrl = process.env.ATLAS_CONCURRENCY_DATABASE_URL;
  if (dbUrl) {
    process.env.DATABASE_URL = dbUrl;
    const { prisma, PrismaAgentStore } = await import('@atlas-rail/database');
    const orgId = `org_concurrency_${Date.now()}`;
    await prisma.organization.create({ data: { id: orgId, name: 'Concurrency proof', slug: orgId } });
    concurrency.push(await runConcurrencyProof(new PrismaAgentStore(prisma), orgId, 'Postgres (production store, advisory lock)'));
    await prisma.$disconnect();
  }
  concurrency.push(await runConcurrencyProof(unlockedMemoryStore(), 'org_test', 'Control: in-memory store with the lock removed'));
  for (const r of concurrency) console.log(`concurrency ${r.label}: ${r.allowed} allowed, settled ${r.settledBaseUnits}`);
  // The control is supposed to overspend; only the real stores count toward the verdict.
  leaked += concurrency.filter((r) => !r.label.startsWith('Control')).reduce((n, r) => n + (r.settledBaseUnits > r.capBaseUnits ? r.settledBaseUnits - r.capBaseUnits : 0n), 0n);
  extra.push(...renderConcurrency(concurrency));
  if (!dbUrl) extra.push('', 'Postgres row not run here (no ATLAS_CONCURRENCY_DATABASE_URL); see apps/demo-agent/src/redteam/concurrency.test.ts.');

  let report = renderReport(memory, { date, cluster: 'in-memory Solana cluster, run in CI on every PR', repetitions, extra });

  if (withDevnet) {
    const subset = CASES.filter((c) => c.devnet && !c.needsClock);
    const devnet: CaseOutcome[] = [];
    for (const c of subset) {
      const outcome = await runCase(c, await devnetRig(c.world ?? {}, root), 1);
      devnet.push(outcome);
      console.log(`devnet ${c.id}: ${outcome.pass ? 'PASS' : 'FAIL'} (moved ${outcome.movedBaseUnits}, outside ${outcome.outsideMandateBaseUnits})`);
    }
    leaked += devnet.reduce((n, o) => n + o.outsideMandateBaseUnits, 0n);
    report += '\n' + renderReport(devnet, {
      date,
      cluster: 'real Solana devnet, representative subset',
      repetitions: 1,
      extra: ['Same gate service and gated signer; every simulation, settlement and balance read went to real devnet. Cases that move a mocked clock (stale authorization, expiry) only run in-memory.'],
    }).replace(/^# /, '## ');
  }

  mkdirSync(join(root, 'reports'), { recursive: true });
  const file = join(root, 'reports', `redteam-${date}.md`);
  writeFileSync(file, report);
  console.log(`report: ${file}`);
  if (leaked > 0n) {
    console.error(`\n!!! MONEY MOVED OUTSIDE THE MANDATE: ${leaked} base units. STOP: see the report.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 2;
});
