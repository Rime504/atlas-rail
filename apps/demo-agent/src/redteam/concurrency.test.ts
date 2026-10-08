import { describe, expect, it } from 'vitest';
import { InMemoryAgentStore } from '@atlas-rail/mandate';
import { runConcurrencyProof, unlockedMemoryStore } from './concurrency';

describe('concurrency: 100 simultaneous payments against a $5 cap', () => {
  it('the real gate service never lets more than $5 through, decided or settled (in-memory store)', async () => {
    const r = await runConcurrencyProof(new InMemoryAgentStore(), 'org_test', 'in-memory');
    expect(r.allowedBaseUnits).toBeLessThanOrEqual(r.capBaseUnits);
    expect(r.settledBaseUnits).toBeLessThanOrEqual(r.capBaseUnits);
    expect(r.allowed).toBe(50); // the cap is used exactly, not under-filled
  }, 120_000);

  it('control: with the per-mandate lock removed, the same burst overspends (so the test above can see the race)', async () => {
    const r = await runConcurrencyProof(unlockedMemoryStore(), 'org_test', 'in-memory, lock removed');
    expect(r.settledBaseUnits).toBeGreaterThan(r.capBaseUnits);
  }, 120_000);

  // The production store (Postgres advisory lock). CI has no database; run locally with
  // ATLAS_CONCURRENCY_DATABASE_URL pointing at a throwaway database (e.g. pnpm demo's embedded one).
  const dbUrl = process.env.ATLAS_CONCURRENCY_DATABASE_URL;
  it.skipIf(!dbUrl)('the same holds on the real Prisma/Postgres store', async () => {
    process.env.DATABASE_URL = dbUrl;
    const { prisma, PrismaAgentStore } = await import('@atlas-rail/database');
    // Its rows stay behind on purpose: AgentDecision is append-only (a trigger refuses DELETE), so
    // point this at a throwaway database, never a shared one.
    const orgId = `org_concurrency_${Date.now()}`;
    await prisma.organization.create({ data: { id: orgId, name: 'Concurrency proof', slug: orgId } });
    try {
      const r = await runConcurrencyProof(new PrismaAgentStore(prisma), orgId, 'Postgres');
      expect(r.rejected).toBe(0);
      expect(r.settledBaseUnits).toBeLessThanOrEqual(r.capBaseUnits);
      expect(r.allowed).toBe(50);
    } finally {
      await prisma.$disconnect();
    }
  }, 300_000);
});
