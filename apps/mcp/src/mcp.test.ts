import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { wrapFetch } from '@atlas-rail/agent';
import { WORLD_ORG, createWorld } from '@atlas-rail/receipt/testing';
import { LocalGateClient, reservePort, startFakeSeller } from '@atlas-rail/x402/testkit';
import { payTool } from './pay';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

describe('the pay tool', () => {
  it('pays within the mandate and reports the receipt; reports the refusing rules otherwise', async () => {
    const port = await reservePort();
    const origin = `http://127.0.0.1:${port}`;
    const world = await createWorld({ mandate: { allowedResources: [`${origin}/research/*`] } });
    const seller = await startFakeSeller({
      chain: world.chain, facilitator: world.keys.facilitator, payTo: world.keys.merchant.publicKey, mint: world.mandate.scope.limits.mint, port,
      routes: { '/research/summary': { amount: '10000', body: { ok: true } }, '/research/drain': { amount: '10000', payTo: world.keys.attacker.publicKey, body: {} } },
    });
    closers.push(seller.close);
    const pay = wrapFetch(fetch, {
      mandateId: world.mandate.id,
      gate: new LocalGateClient({ organizationId: WORLD_ORG, gate: world.gate, store: world.store, receiptService: world.receiptService }),
      wallet: world.keys.agent, trustedInstanceKeys: [world.keys.instance.publicKey], chain: world.chain, clock: () => world.clock.now,
    });
    expect(await payTool(pay, `${origin}/research/summary`)).toMatch(/HTTP 200[\s\S]*Receipt: rcp_/);
    expect(await payTool(pay, `${origin}/research/drain`)).toMatch(/REFUSED[\s\S]*PAYTO_ALLOWED/);
  });
});

const SERVER = join(__dirname, '..', 'dist', 'main.js');

// Needs the built server; `pnpm typecheck` builds it first (apps/mcp/turbo.json), as CI does.
describe('atlas-rail-mcp over stdio', () => {
  it.skipIf(!existsSync(SERVER))('starts and advertises exactly one tool, pay(url)', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [SERVER],
      env: {
        ...(process.env as Record<string, string>),
        ATLAS_GATE_URL: 'http://127.0.0.1:1',
        ATLAS_API_KEY: 'test',
        ATLAS_MANDATE_ID: 'mnd_test',
        ATLAS_TRUSTED_INSTANCE_KEY: '11111111111111111111111111111111',
        ATLAS_AGENT_SECRET_KEY: '11111111111111111111111111111112',
      },
    });
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(transport);
    closers.push(() => client.close());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['pay']);
    expect(tools[0].inputSchema.required).toEqual(['url']);
  }, 30_000);
});
