import Fastify, { FastifyInstance } from 'fastify';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { paymentMiddleware, x402ResourceServer } from '@x402/fastify';
import { ExactSvmScheme } from '@x402/svm/exact/server';
import { SOLANA_DEVNET } from './facilitator';

export interface DemoApiOptions {
  /** URL of the facilitator (`/verify`, `/settle`, `/supported`). */
  facilitatorUrl: string;
  /** Merchant address that receives payments. */
  payTo: string;
  /** SPL token mint payments are denominated in (the devnet demo mint, or Circle's devnet USDC). */
  mint: string;
  /** Prices in token base units (6 decimals): $0.01 = "10000". */
  prices?: { research: string; inference: string };
  log?: boolean;
}

export const DEFAULT_PRICES = { research: '10000', inference: '40000000' } as const;

/**
 * The paid API used in the demo. Two endpoints, both x402 on Solana devnet:
 *   GET /research/summary  — $0.01
 *   GET /inference/heavy   — $40.00
 * Everything about 402 handling, verification and settlement is the official `@x402/fastify`
 * middleware talking to a facilitator; nothing here is Atlas Rail specific — which is the point.
 */
export async function createDemoApi(options: DemoApiOptions): Promise<FastifyInstance> {
  const prices = options.prices ?? DEFAULT_PRICES;
  const app = Fastify({ logger: options.log ?? false });

  const facilitator = new HTTPFacilitatorClient({ url: options.facilitatorUrl });
  const server = new x402ResourceServer(facilitator).register(SOLANA_DEVNET, new ExactSvmScheme());

  paymentMiddleware(
    app,
    {
      'GET /research/summary': {
        accepts: [
          {
            scheme: 'exact',
            network: SOLANA_DEVNET,
            payTo: options.payTo,
            price: { amount: prices.research, asset: options.mint },
          },
        ],
        description: 'Market research summary',
        mimeType: 'application/json',
      },
      'GET /inference/heavy': {
        accepts: [
          {
            scheme: 'exact',
            network: SOLANA_DEVNET,
            payTo: options.payTo,
            price: { amount: prices.inference, asset: options.mint },
          },
        ],
        description: 'Heavy inference job (GPU minutes)',
        mimeType: 'application/json',
      },
    },
    server,
  );

  app.get('/research/summary', async () => ({
    topic: 'stablecoin settlement on Solana',
    summary:
      'Devnet USDC transfers finalise in well under a second. Agent-initiated payments need scoped, revocable authority and verifiable evidence.',
    generatedAt: new Date().toISOString(),
  }));

  app.get('/inference/heavy', async () => ({
    job: 'heavy-inference',
    result: 'Completed 1,200 GPU-minutes of batch inference.',
    completedAt: new Date().toISOString(),
  }));

  app.get('/health', async () => ({ status: 'ok' }));
  return app;
}
