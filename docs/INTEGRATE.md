# Integrate Atlas Rail

Three ways in: wrap your agent's `fetch`, give an AI assistant a `pay` tool over MCP, or verify any payment. Devnet only.

## Before you start: a gate

The first two paths talk to an Atlas Rail gate (`apps/api`). It is not hosted publicly yet, so run it locally:

```bash
pnpm install
pnpm demo:offline   # or `pnpm demo` for real Solana devnet
```

This starts the gate on `http://localhost:3001`, creates an API key and a mandate for a research agent, and leaves the console on `http://localhost:3000`. You need five values:

| Value | Where |
|---|---|
| Gate URL | `http://localhost:3001` |
| API key | `apiKey` in `.demo/state.json` |
| Mandate id | the active mandate on `http://localhost:3000/mandates` |
| Gate instance key | `instance` in `.demo/state.json` |
| Solana RPC | `http://127.0.0.1:8899` (the in-memory cluster) for `demo:offline`; `https://api.devnet.solana.com` for `pnpm demo` |

## 1. Wrap fetch (`@atlas-rail/agent`)

```ts
import { AtlasDenied, HttpSignerClient, wrapFetch } from '@atlas-rail/agent';

const pay = wrapFetch(fetch, {
  mandateId: 'mnd_...',
  gate: { url: 'http://localhost:3001', apiKey: process.env.ATLAS_API_KEY! },
  // The agent key lives in the signer service, another process; this agent only has its URL.
  signer: await HttpSignerClient.connect({ url: 'http://127.0.0.1:3012', token: process.env.ATLAS_SIGNER_TOKEN }),
  rpcUrl: 'http://127.0.0.1:8899', // the Solana RPC from the table above
});

try {
  const res = await pay('http://localhost:4402/research/summary');
  console.log(await res.json(), res.atlas?.receipt?.id);
} catch (error) {
  if (error instanceof AtlasDenied) console.log('refused by', error.reasons); // nothing was signed
}
```

**The signer service** (`apps/signer`, `atlas-rail-signer`) holds the agent key and signs a transaction only with a gate authorisation for its exact bytes, and messages only in the Atlas Rail agent-request and mandate-acceptance forms. It has no route that signs arbitrary bytes. `pnpm demo` starts it for you; to run it yourself:

```bash
pnpm turbo run build --filter=@atlas-rail/signer...
ATLAS_AGENT_SECRET_KEY=<devnet agent secret key> ATLAS_TRUSTED_INSTANCE_KEY=<gate instance key> \
  ATLAS_SIGNER_TOKEN=<any long random string> node apps/signer/dist/main.js   # listens on 127.0.0.1:3012
```

For tests and quick local experiments you can pass `wallet` (any `SignerAdapter`) with `trustedInstanceKeys` instead of `signer`; `wrapFetch` then wraps it in the same check inside your process. Don't do that in production: an agent that can read its key can sign anything.

Requests that don't ask for payment pass straight through. Above the approval threshold the call waits for a human by default; pass `escalation: { mode: 'fail' }` to get an `EscalationRequiredError` instead.

If the seller never answers the paid request (a timeout or dropped connection), `wrapFetch` asks the gate, which checks the chain for that exact transaction, and throws `PaymentUnconfirmedError`. Its `resolution.status` is `SETTLED` (the money moved; `txSignature` names the payment, and it counts against the mandate), `RELEASED` (it never landed; the budget is free again) or `PENDING` (the chain cannot tell yet; the budget stays reserved).

## 2. A `pay` tool for AI assistants (`atlas-rail-mcp`)

`apps/mcp` is an MCP server with one tool, `pay(url)`. The assistant can ask for a payment; it can never see the key or sign anything itself. Point it at the signer service with `ATLAS_SIGNER_URL` (and `ATLAS_SIGNER_TOKEN`) and the key is not in the MCP server's process either. Without them it falls back to `ATLAS_AGENT_SECRET_KEY` plus `ATLAS_TRUSTED_INSTANCE_KEY`, holding a devnet key itself.

Build it once: `pnpm turbo run build --filter=@atlas-rail/mcp...`. Then add it to your MCP client.

**Claude Desktop** (`claude_desktop_config.json`) or any client that takes the same shape:

```json
{
  "mcpServers": {
    "atlas-rail": {
      "command": "node",
      "args": ["/path/to/atlas-rail/apps/mcp/dist/main.js"],
      "env": {
        "ATLAS_GATE_URL": "http://localhost:3001",
        "ATLAS_API_KEY": "<api key>",
        "ATLAS_MANDATE_ID": "mnd_...",
        "ATLAS_SIGNER_URL": "http://127.0.0.1:3012",
        "ATLAS_SIGNER_TOKEN": "<the signer service token>",
        "SOLANA_RPC_URL": "http://127.0.0.1:8899"
      }
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add atlas-rail \
  -e ATLAS_GATE_URL=http://localhost:3001 -e ATLAS_API_KEY=<api key> -e ATLAS_MANDATE_ID=mnd_... \
  -e ATLAS_SIGNER_URL=http://127.0.0.1:3012 -e ATLAS_SIGNER_TOKEN=<the signer service token> \
  -e SOLANA_RPC_URL=http://127.0.0.1:8899 \
  -- node /path/to/atlas-rail/apps/mcp/dist/main.js
```

Then ask the assistant to fetch `http://localhost:4402/research/summary`. It pays $0.01 and reports the receipt. Ask it to pay anything outside the mandate and it gets `REFUSED`, with the rules that refused it. Payments above the approval threshold are not made by this tool.

Agent keys must be devnet keys; the signer service and the MCP server's local-key fallback refuse to run with `NODE_ENV=production`. With `pnpm demo`, the signer runs on `http://127.0.0.1:3012`; set `ATLAS_SIGNER_TOKEN` before starting it to choose the token (otherwise one is generated per run).

## 3. Verify a payment

Anyone can check any devnet payment, with no account and no trust in us:

- **In a browser:** [atlas-rail-playground.vercel.app/verify](https://atlas-rail-playground.vercel.app/verify), paste the transaction signature.
- **In a terminal:**

  ```bash
  pnpm turbo run build --filter=@atlas-rail/cli...
  node apps/cli/dist/main.js verify --tx <signature>
  ```

  Exit code 0 means PROVEN, 1 means NO PROOF or INVALID.

- **In code** (`@atlas-rail/receipt`):

  ```ts
  import { provePayment } from '@atlas-rail/receipt';
  import { Web3ChainClient } from '@atlas-rail/solana';

  const proof = await provePayment(signature, {
    chain: Web3ChainClient.fromUrl('https://api.devnet.solana.com'),
    loadReceipt: async (id) => {
      const res = await fetch(`https://atlas-rail-playground.vercel.app/api/receipts/${id}`);
      return res.ok ? res.json() : null;
    },
  });
  console.log(proof.verdict); // PROVEN | NO_PROOF | INVALID | NOT_FOUND
  ```

How it works: the payment's memo names its receipt (`atlasrail:receipt:<id>`). The verifier loads that receipt, checks that it names this exact transaction back, then re-runs every check: the mandate's three signatures, the gate's decision against the mandate, the settlement on-chain, and the receipt's Merkle proof against the root written by `anchor_root`.

The packages are not published to npm yet; use them from this repository.
