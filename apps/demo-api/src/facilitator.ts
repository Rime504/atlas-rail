import Fastify, { FastifyInstance } from 'fastify';
import { x402Facilitator } from '@x402/core/facilitator';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { ExactSvmScheme } from '@x402/svm/exact/facilitator';
import type { FacilitatorSvmSigner } from '@x402/svm';

/** CAIP-2 identifier of Solana devnet (the only network Atlas Rail v1 settles on). */
export const SOLANA_DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';

export interface FacilitatorOptions {
  /** Highest priority fee (µ-lamports per CU) the facilitator will pay for on the payer's behalf. */
  maxPriorityFeeMicroLamports?: number;
  maxComputeUnits?: number;
}

/** A facilitator running the official `@x402/svm` exact scheme, registered for Solana devnet only. */
export function createFacilitator(signer: FacilitatorSvmSigner, options: FacilitatorOptions = {}): x402Facilitator {
  const facilitator = new x402Facilitator();
  facilitator.register(
    SOLANA_DEVNET,
    new ExactSvmScheme(signer, undefined, {
      // The facilitator pays fees, so cap what a payer can make it spend.
      maxPriorityFeeMicroLamports: options.maxPriorityFeeMicroLamports ?? 1_000,
      maxComputeUnits: options.maxComputeUnits ?? 100_000,
      maxRequiredSignatures: 2,
    }),
  );
  return facilitator;
}

/** HTTP surface of a facilitator: POST /verify, POST /settle, GET /supported (the x402 facilitator API). */
export function createFacilitatorApp(facilitator: x402Facilitator, log = false): FastifyInstance {
  const app = Fastify({ logger: log });

  app.post('/verify', async (request, reply) => {
    const body = request.body as { paymentPayload?: PaymentPayload; paymentRequirements?: PaymentRequirements } | null;
    if (!body?.paymentPayload || !body.paymentRequirements) {
      return reply.status(400).send({ error: 'Missing paymentPayload or paymentRequirements' });
    }
    try {
      return await facilitator.verify(body.paymentPayload, body.paymentRequirements);
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'verify failed' });
    }
  });

  app.post('/settle', async (request, reply) => {
    const body = request.body as { paymentPayload?: PaymentPayload; paymentRequirements?: PaymentRequirements } | null;
    if (!body?.paymentPayload || !body.paymentRequirements) {
      return reply.status(400).send({ error: 'Missing paymentPayload or paymentRequirements' });
    }
    try {
      return await facilitator.settle(body.paymentPayload, body.paymentRequirements);
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'settle failed' });
    }
  });

  app.get('/supported', async () => facilitator.getSupported());
  app.get('/health', async () => ({ status: 'ok', network: SOLANA_DEVNET }));

  return app;
}
