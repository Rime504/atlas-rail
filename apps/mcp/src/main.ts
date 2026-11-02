#!/usr/bin/env node
/**
 * atlas-rail-mcp: one tool, pay(url). Exact x402 fetch is gone; channel vouchers are requested
 * through Atlas Rail. The process still requires ATLAS_GATE_URL, ATLAS_API_KEY, and ATLAS_MANDATE_ID.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { AtlasFetch } from '@atlas-rail/agent';
import { payTool } from './pay';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`atlas-rail-mcp: ${name} is not set`);
    process.exit(2);
  }
  return value;
}

async function main() {
  required('ATLAS_MANDATE_ID');
  required('ATLAS_GATE_URL');
  required('ATLAS_API_KEY');
  const pay: AtlasFetch = async () => {
    throw new Error('Exact x402 fetch is no longer in this server. Ask Atlas Rail for a channel voucher.');
  };

  const server = new Server({ name: 'atlas-rail', version: '0.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'pay',
        description:
          'Fetch a URL, paying for it if the server asks (HTTP 402 / x402). The payment only happens if the signed Atlas Rail mandate allows it; otherwise the tool reports which rules refused it. Payments above the approval threshold need a human and are not made.',
        inputSchema: {
          type: 'object' as const,
          properties: { url: { type: 'string', description: 'The resource to fetch' } },
          required: ['url'],
        },
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
