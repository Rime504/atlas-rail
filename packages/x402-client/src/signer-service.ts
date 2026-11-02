import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { AgentMandate, GateAuthorization, SignedDecision } from '@atlas-rail/mandate';
import { GateAuthorizationRequiredError } from './errors';
import { AuthorizedSigner, GatedSignerAdapter } from './gated-signer';

/*
 * The agent's key, behind HTTP. Run this as its own process (or on its own machine, or inside a
 * custody provider); the agent gets only the URL. None of these operations signs arbitrary bytes:
 *
 *   GET  /v1/public-key      the agent's address
 *   POST /v1/voucher-key     mint the random voucher key for one mandate id
 *   GET  /v1/voucher-key     that mandate's voucher address, if it was already minted
 *   DELETE /v1/voucher-key   drop that mandate's voucher key
 *   POST /v1/sign-message    an Atlas Rail agent request or mandate acceptance, in its exact domain form
 *   POST /v1/sign-authorized a transaction, with the gate authorisation, ALLOW decision and mandate
 *                            that cover its exact message bytes
 *   POST /v1/sign-voucher    the 50-byte payment-channels voucher, with an authorisation for those bytes
 *   POST /v1/sign-mandate-create  one create_mandate naming this key as agent, never as fee payer
 */

const MAX_BODY_BYTES = 64 * 1024;
const MANDATE_ID = /^mnd_[A-Za-z0-9]{10,40}$/;

function mandateIdOf(value: unknown): string {
  if (typeof value !== 'string' || !MANDATE_ID.test(value)) throw new HttpError(400, 'mandate id is required');
  return value;
}

export interface VoucherKeys {
  /** The key already minted for this mandate, or null. */
  get(mandateId: string): GatedSignerAdapter | null;
  /** A new random key on the first call for this mandate. The same key after that. */
  mint(mandateId: string): GatedSignerAdapter;
  /** Drops the key for this mandate. */
  drop(mandateId: string): void;
}

export interface SignerServiceOptions {
  signer: GatedSignerAdapter;
  /** When set, each mandate id has its own voucher key. Absent keeps the single `signer` key. */
  voucherKeys?: VoucherKeys;
  /** Bind address. Defaults to 127.0.0.1: reachable from this machine only. */
  host?: string;
  /** 0 picks a free port. */
  port?: number;
  /** When set, every request must carry `Authorization: Bearer <token>`. */
  token?: string;
}

export interface RunningSignerService {
  url: string;
  close(): Promise<void>;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Request body too large');
    chunks.push(chunk as Buffer);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Body must be a JSON object');
  }
}

function tokenMatches(header: string | undefined, token: string): boolean {
  const presented = Buffer.from(header?.startsWith('Bearer ') ? header.slice(7) : '', 'utf8');
  const expected = Buffer.from(token, 'utf8');
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

function voucherSigner(options: SignerServiceOptions, mandateId: unknown): GatedSignerAdapter {
  if (!options.voucherKeys) throw new HttpError(400, 'mandate id is required');
  const key = options.voucherKeys.get(mandateIdOf(mandateId));
  if (!key) throw new HttpError(404, 'No voucher key for this mandate');
  return key;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

export function startSignerService(options: SignerServiceOptions): Promise<RunningSignerService> {
  const { signer } = options;
  // Reachable from other machines means anyone there could mint or drop voucher keys: require a token.
  if (!LOOPBACK_HOSTS.has(options.host ?? '127.0.0.1') && !options.token) {
    return Promise.reject(new Error('The signer needs a bearer token (ATLAS_SIGNER_TOKEN) when it listens beyond this machine'));
  }

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    try {
      const path = new URL(req.url ?? '/', 'http://signer').pathname;
      if (req.method === 'GET' && path === '/health') return send(200, { status: 'ok' });
      if (options.token && !tokenMatches(req.headers.authorization, options.token)) throw new HttpError(401, 'Missing or wrong bearer token');

      if (req.method === 'GET' && path === '/v1/public-key') return send(200, { publicKey: signer.publicKey });

      if (path === '/v1/voucher-key') {
        if (!options.voucherKeys) throw new HttpError(404, 'Not found');
        const mandateId = req.method === 'GET'
          ? new URL(req.url ?? '/', 'http://signer').searchParams.get('mandateId')
          : undefined;
        if (req.method === 'GET') {
          const existing = options.voucherKeys.get(mandateIdOf(mandateId));
          if (!existing) throw new HttpError(404, 'No voucher key for this mandate');
          return send(200, { publicKey: existing.publicKey });
        }
        if (req.method === 'POST') {
          const body = await readJson(req);
          return send(200, { publicKey: options.voucherKeys.mint(mandateIdOf(body.mandateId)).publicKey });
        }
        if (req.method === 'DELETE') {
          options.voucherKeys.drop(mandateIdOf(new URL(req.url ?? '/', 'http://signer').searchParams.get('mandateId')));
          return send(200, { deleted: true });
        }
      }

      if (req.method === 'POST' && path === '/v1/sign-message') {
        const body = await readJson(req);
        if (typeof body.messageBase64 !== 'string') throw new HttpError(400, 'messageBase64 is required');
        const messageSigner = body.mandateId === undefined ? signer : voucherSigner(options, body.mandateId);
        const signature = await messageSigner.signMessage(Buffer.from(body.messageBase64, 'base64'));
        return send(200, { signatureBase64: Buffer.from(signature).toString('base64') });
      }

      if (req.method === 'POST' && path === '/v1/sign-authorized') {
        const body = await readJson(req);
        if (typeof body.transactionBase64 !== 'string') throw new HttpError(400, 'transactionBase64 is required');
        const signed = await signer.signWithAuthorization(
          body.transactionBase64,
          (body.authorization ?? null) as GateAuthorization | null,
          (body.decision ?? null) as SignedDecision | null,
          (body.mandate ?? null) as AgentMandate | null,
        );
        return send(200, signed);
      }

      if (req.method === 'POST' && path === '/v1/sign-mandate-create') {
        const body = await readJson(req);
        if (typeof body.transactionBase64 !== 'string') throw new HttpError(400, 'transactionBase64 is required');
        const agent = body.mandateId === undefined ? signer : voucherSigner(options, body.mandateId);
        return send(200, await agent.signMandateCreation(body.transactionBase64));
      }

      if (req.method === 'POST' && path === '/v1/sign-voucher') {
        const body = await readJson(req);
        if (typeof body.messageBase64 !== 'string') throw new HttpError(400, 'messageBase64 is required');
        const mandate = (body.mandate ?? null) as AgentMandate | null;
        const voucher = options.voucherKeys ? voucherSigner(options, mandate?.id) : signer;
        if (options.voucherKeys && voucher.publicKey !== mandate?.agent.publicKey) {
          throw new HttpError(403, 'Voucher key is not this mandate agent');
        }
        const signed = await voucher.signVoucherWithAuthorization(
          Buffer.from(body.messageBase64, 'base64'),
          (body.authorization ?? null) as GateAuthorization | null,
          (body.decision ?? null) as SignedDecision | null,
          mandate,
        );
        return send(200, { signatureBase64: Buffer.from(signed.signature).toString('base64') });
      }

      throw new HttpError(404, 'Not found');
    } catch (error) {
      if (error instanceof GateAuthorizationRequiredError) return send(403, { error: error.message, code: error.code });
      if (error instanceof HttpError) return send(error.status, { error: error.message });
      return send(500, { error: 'Signer error' });
    }
  };

  const server: Server = createServer((req, res) => void handle(req, res));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => {
      const { address, port } = server.address() as AddressInfo;
      const host = address.includes(':') ? `[${address}]` : address;
      resolve({
        url: `http://${host}:${port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

export interface HttpSignerClientOptions {
  /** The signer service, e.g. http://127.0.0.1:3012 */
  url: string;
  token?: string;
  fetch?: typeof fetch;
}

/** The agent's side of {@link startSignerService}: it can ask for signatures, never read the key. */
export class HttpSignerClient implements AuthorizedSigner {
  private constructor(
    readonly publicKey: string,
    private readonly options: HttpSignerClientOptions & { fetch: typeof fetch },
  ) {}

  static async connect(options: HttpSignerClientOptions): Promise<HttpSignerClient> {
    const resolved = { ...options, url: options.url.replace(/\/$/, ''), fetch: options.fetch ?? fetch };
    const { publicKey } = await HttpSignerClient.call<{ publicKey: string }>(resolved, 'GET', '/v1/public-key');
    return new HttpSignerClient(publicKey, resolved);
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    const { signatureBase64 } = await HttpSignerClient.call<{ signatureBase64: string }>(this.options, 'POST', '/v1/sign-message', {
      messageBase64: Buffer.from(message).toString('base64'),
    });
    return new Uint8Array(Buffer.from(signatureBase64, 'base64'));
  }

  signWithAuthorization(
    transactionBase64: string,
    authorization: GateAuthorization | null,
    decision: SignedDecision | null,
    mandate: AgentMandate | null,
  ): Promise<{ signedBase64: string; signature: string }> {
    return HttpSignerClient.call(this.options, 'POST', '/v1/sign-authorized', { transactionBase64, authorization, decision, mandate });
  }

  signVoucher(
    message: Uint8Array,
    authorization: GateAuthorization | null,
    decision: SignedDecision | null,
    mandate: AgentMandate | null,
  ): Promise<{ signatureBase64: string }> {
    return HttpSignerClient.call(this.options, 'POST', '/v1/sign-voucher', {
      messageBase64: Buffer.from(message).toString('base64'),
      authorization,
      decision,
      mandate,
    });
  }

  private static async call<T>(
    options: HttpSignerClientOptions & { fetch: typeof fetch },
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    const response = await options.fetch(`${options.url}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = (await response.json().catch(() => ({}))) as { error?: string };
    if (response.status === 403) throw new GateAuthorizationRequiredError(json.error ?? 'The signer refused');
    if (!response.ok) throw new Error(`Signer service ${path} failed with HTTP ${response.status}: ${json.error ?? 'no detail'}`);
    return json as T;
  }
}
