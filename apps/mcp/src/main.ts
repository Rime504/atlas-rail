#!/usr/bin/env node
/**
 * atlas-rail-mcp: gives an AI assistant one tool, pay(url), that can buy x402 resources only within
 * a signed Atlas Rail mandate. The agent key lives in this server's process, never in the assistant:
 * the model can ask for a payment, it can never read the key or sign anything itself.
 *
 * Environment: ATLAS_GATE_URL, ATLAS_API_KEY, ATLAS_MANDATE_ID, optional SOLANA_RPC_URL, and the wallet:
 * ATLAS_SIGNER_URL (+ optional ATLAS_SIGNER_TOKEN) for the agent signer service, so the key is not in
 * this process at all (recommended); or ATLAS_AGENT_SECRET_KEY (base58, devnet only) with
 * ATLAS_TRUSTED_INSTANCE_KEY to keep it here.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { HttpSignerClient, wrapFetch } from '@atlas-rail/agent';
import { fromBase58 } from '@atlas-rail/mandate';
import { DevnetKeypairSigner } from '@atlas-rail/solana';
import { payTool } from './pay';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`atlas-rail-mcp: ${name} is not set`);
    process.exit(2);
  }
  return value;
}

function localWallet(): { wallet: DevnetKeypairSigner; trustedInstanceKeys: string[] } {
  process.env.ATLAS_ALLOW_MOCK_SIGNER ??= 'true'; // devnet-only key; DevnetKeypairSigner refuses NODE_ENV=production
  const secret = fromBase58(required('ATLAS_AGENT_SECRET_KEY'));
  return {
    wallet: new DevnetKeypairSigner(secret.length === 64 ? secret.slice(0, 32) : secret),
    trustedInstanceKeys: required('ATLAS_TRUSTED_INSTANCE_KEY').split(','),
  };
}

async function main() {
  const base = {
    mandateId: required('ATLAS_MANDATE_ID'),
    gate: { url: required('ATLAS_GATE_URL'), apiKey: required('ATLAS_API_KEY') },
    escalation: { mode: 'fail' as const },
  };
  const signerUrl = process.env.ATLAS_SIGNER_URL;
  const pay = signerUrl
    ? wrapFetch(fetch, { ...base, signer: await HttpSignerClient.connect({ url: signerUrl, token: process.env.ATLAS_SIGNER_TOKEN }) })
    : wrapFetch(fetch, { ...base, ...localWallet() });

  const server = new Server({ name: 'atlas-rail', version: '0.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'pay',
        description:
          'Fetch a URL, paying for it if the server asks (HTTP 402 / x402). The payment only happens if the signed Atlas Rail mandate allows it; otherwise the tool reports which rules refused it. Payments above the approval threshold need a human and are not made.',
        inputSchema: { type: 'object' as const, properties: { url: { type: 'string', description: 'The resource to fetch' } }, required: ['url'] },
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== 'pay') return { content: [{ type: 'text', text: `Unknown tool ${request.params.name}` }], isError: true };
    const url = String(request.params.arguments?.url ?? '');
    if (!/^https?:\/\//.test(url)) return { content: [{ type: 'text', text: 'url must be an http(s) URL' }], isError: true };
    return { content: [{ type: 'text', text: await payTool(pay, url) }] };
  });
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
