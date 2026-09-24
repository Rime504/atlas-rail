import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { SOLANA_DEVNET_CAIP2 } from '@atlas-rail/mandate';
import { ChainClient, DevnetKeypairSigner } from '@atlas-rail/solana';

export interface FakeSellerRoute {
  amount: string;
  /** Recipient; defaults to the seller's own address. Lets tests model a malicious seller. */
  payTo?: string;
  body: unknown;
  /** What the seller claims its resource URL is in the 402 body (a lie, in adversarial tests). */
  claimedResource?: string;
}

export interface FakeSellerOptions {
  chain: ChainClient;
  /** Fee payer and settler, standing in for an x402 facilitator. */
  facilitator: DevnetKeypairSigner;
  payTo: string;
  mint: string;
  routes: Record<string, FakeSellerRoute>;
  /** Advertise no `extra.feePayer` (invalid for SVM). */
  omitFeePayer?: boolean;
  /** Advertise a different network than devnet. */
  network?: string;
  /** Reject every payment with 402 after receiving it. */
  rejectPayments?: boolean;
  /** Listen on this port (see {@link reservePort}); random if omitted. */
  port?: number;
}

export interface FakeSeller {
  url: string;
  close(): Promise<void>;
  /** Number of payments the seller settled. */
  settled: string[];
}

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64');

/**
 * A minimal x402 v2 seller for client tests: answers 402 with PAYMENT-REQUIRED, and when a
 * PAYMENT-SIGNATURE arrives it co-signs as fee payer, submits to the cluster and returns the paid
 * body with a PAYMENT-RESPONSE header. It is NOT the official facilitator; `apps/demo-api` tests run
 * the real `@x402/svm` scheme against the same client.
 */
export async function startFakeSeller(options: FakeSellerOptions): Promise<FakeSeller> {
  const settled: string[] = [];
  let baseUrl = '';

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? '/').split('?')[0];
    const route = options.routes[path];
    if (!route) {
      res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'not found' }));
      return;
    }
    const requirement = {
      scheme: 'exact',
      network: options.network ?? SOLANA_DEVNET_CAIP2,
      amount: route.amount,
      asset: options.mint,
      payTo: route.payTo ?? options.payTo,
      maxTimeoutSeconds: 60,
      extra: options.omitFeePayer ? {} : { feePayer: options.facilitator.publicKey },
    };
    const paymentRequired = {
      x402Version: 2,
      error: 'PAYMENT-SIGNATURE header is required',
      resource: { url: route.claimedResource ?? `${baseUrl}${path}` },
      accepts: [requirement],
    };
    const header = req.headers['payment-signature'];
    if (typeof header !== 'string') {
      res.writeHead(402, { 'content-type': 'application/json', 'PAYMENT-REQUIRED': b64(paymentRequired) }).end(JSON.stringify(paymentRequired));
      return;
    }
    if (options.rejectPayments) {
      res.writeHead(402, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'payment rejected' }));
      return;
    }
    try {
      const payload = JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as {
        accepted: { amount: string; payTo: string; asset: string };
        payload: { transaction: string };
      };
      if (payload.accepted.amount !== requirement.amount || payload.accepted.payTo !== requirement.payTo || payload.accepted.asset !== requirement.asset) {
        res.writeHead(402, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'payment does not match requirements' }));
        return;
      }
      const signed = await options.facilitator.signTransaction(payload.payload.transaction);
      const signature = await options.chain.sendAndConfirm(signed.signedBase64);
      settled.push(signature);
      res
        .writeHead(200, {
          'content-type': 'application/json',
          'PAYMENT-RESPONSE': b64({ success: true, transaction: signature, network: requirement.network, payer: 'agent' }),
        })
        .end(JSON.stringify(route.body));
    } catch (error) {
      res.writeHead(402, { 'content-type': 'application/json' }).end(JSON.stringify({ error: error instanceof Error ? error.message : 'settlement failed' }));
    }
  };

  const server: Server = createServer((req, res) => {
    void handle(req, res);
  });
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    url: baseUrl,
    settled,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Finds a free local port so tests can build a mandate scoped to the seller's origin before it starts. */
export async function reservePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}
