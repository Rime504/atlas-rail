import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Keypair, type Transaction } from '@solana/web3.js';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function readEnv(envFile: string): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(envFile, 'utf8');
  } catch {
    throw new Error('DEMO_FUNDER_SECRET_KEY is missing');
  }
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const body = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const eq = body.indexOf('=');
    if (eq < 1) continue;
    let value = body.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[body.slice(0, eq).trim()] = value;
  }
  return values;
}

function decodeBase58(value: string): Uint8Array {
  const bytes = [0];
  for (const char of value) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) throw new Error('DEMO_FUNDER_SECRET_KEY is not a Solana secret key');
    let carry = digit;
    for (let index = 0; index < bytes.length; index++) {
      carry += bytes[index] * 58;
      bytes[index] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const char of value) {
    if (char !== '1') break;
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}

function secretFromEnv(value: string): Uint8Array {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('DEMO_FUNDER_SECRET_KEY is missing');
  if (trimmed.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error('DEMO_FUNDER_SECRET_KEY is not a Solana secret key');
    }
    if (!Array.isArray(parsed) || parsed.length !== 64 || parsed.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
      throw new Error('DEMO_FUNDER_SECRET_KEY is not a Solana secret key');
    }
    return Uint8Array.from(parsed);
  }
  const run = (trimmed.match(new RegExp(`[${ALPHABET}]{80,}`, 'g')) ?? []).sort((left, right) => right.length - left.length)[0];
  if (!run) throw new Error('DEMO_FUNDER_SECRET_KEY is not a Solana secret key');
  const raw = decodeBase58(run);
  if (raw.length !== 64) throw new Error('DEMO_FUNDER_SECRET_KEY is not a Solana secret key');
  return raw;
}

function storedPublicKey(path: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 64) return null;
    return Keypair.fromSecretKey(Uint8Array.from(parsed)).publicKey.toBase58();
  } catch {
    return null;
  }
}

function writeSecret(path: string, secret: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(Array.from(secret)), { mode: 0o600 });
}

const PAYMENT_FIELDS = [
  'organizationId',
  'issuerName',
  'resource',
  'resourceUrl',
  'deposit',
  'settled',
  'maxPerPayment',
  'maxPerWindow',
  'windowSeconds',
  'maxTotal',
  'thresholdBaseUnits',
  'approvalTtlSeconds',
  'requiredApprovals',
  'notBefore',
  'expiresAt',
  'voucherExpiresAt',
  'graceSeconds',
  'salt',
  'network',
  'payeePath',
  'deniedRecipient',
  'ownerSeed',
  'approverSeed',
  'instanceSeed',
  'apiUrl',
  'signerUrl',
  'rpcUrl',
] as const;

export interface MandatePayment {
  path: string;
  envFile: string;
  organizationId: string;
  issuerName: string;
  resource: string;
  resourceUrl: string;
  deposit: string;
  settled: string;
  maxPerPayment: string;
  maxPerWindow: string;
  windowSeconds: number;
  maxTotal: string;
  thresholdBaseUnits: string;
  approvalTtlSeconds: number;
  requiredApprovals: number;
  notBefore: number;
  expiresAt: number;
  voucherExpiresAt: number;
  graceSeconds: number;
  salt: string;
  network: string;
  payeePath: string;
  deniedRecipient: string;
  ownerSeed: string;
  approverSeed: string;
  instanceSeed: string;
  apiUrl: string;
  signerUrl: string;
  rpcUrl: string;
}

/** Checks the mandate and backend fields the caller has to pass. */
export function mandatePayment(options: MandatePayment): Omit<MandatePayment, 'path' | 'envFile'> {
  for (const key of PAYMENT_FIELDS) {
    const value = options[key];
    if (value === undefined || value === '') throw new Error(`${key} is required`);
  }
  if (BigInt(options.settled) > BigInt(options.deposit)) throw new Error('settled is above the deposit');
  const { path: _path, envFile: _envFile, ...payment } = options;
  return payment;
}

/** Reads an env file and fills any variables that are not already set. Does not print values. */
export function loadEnv(options: { path: string }): Record<string, string> {
  const values = readEnv(options.path);
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return values;
}

/** Stores DEMO_FUNDER_SECRET_KEY from `envFile` at `path`. Does not print the secret. */
export function importFunder(options: { path: string; envFile: string }): { publicKey: string; created: boolean } {
  const secret = secretFromEnv(readEnv(options.envFile).DEMO_FUNDER_SECRET_KEY ?? '');
  let keypair: Keypair;
  try {
    keypair = Keypair.fromSecretKey(secret);
  } catch {
    throw new Error('DEMO_FUNDER_SECRET_KEY is not a Solana secret key');
  }
  const publicKey = keypair.publicKey.toBase58();
  if (existsSync(options.path) && storedPublicKey(options.path) === publicKey) return { publicKey, created: false };
  writeSecret(options.path, secret);
  return { publicKey, created: true };
}

export interface PaymentSession {
  payerPublicKey: string;
  payeePublicKey: string;
  mandateId: string;
  nonce: string;
  [key: string]: unknown;
}

async function paymentModule(): Promise<Record<string, (session?: PaymentSession) => Promise<Record<string, unknown>>>> {
  const href = pathToFileURL(join(__dirname, '..', 'payment.mjs')).href;
  const load = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<Record<string, (session?: PaymentSession) => Promise<Record<string, unknown>>>>;
  return load(href);
}

function applyPaymentEnv(options: MandatePayment): { publicKey: string } {
  const payment = mandatePayment(options);
  for (const [key, value] of Object.entries(readEnv(options.envFile))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  const account = importFunder(options);
  if (storedPublicKey(options.path) !== account.publicKey) throw new Error('Connected account is not the stored key');
  process.env.SOLANA_RPC_URL = options.rpcUrl;
  process.env.ATLAS_API_URL = options.apiUrl;
  process.env.ATLAS_SIGNER_URL = options.signerUrl;
  process.env.ATLAS_RAILS_KEY_PATH = options.path;
  process.env.ATLAS_FEE_PAYER = account.publicKey;
  process.env.ATLAS_RAILS_PAYMENT = JSON.stringify(payment);
  return account;
}

/** One public key. On browser funding this key pays the fee and signs the open. */
export interface WalletSigner {
  publicKey: string;
  signTransaction(transaction: Transaction): Promise<Transaction>;
}

/** Demo and test adapter. The returned object does not expose `secretKey`. */
export function keypairWallet(options: { path: string }): WalletSigner {
  const parsed = JSON.parse(readFileSync(options.path, 'utf8')) as unknown;
  if (!Array.isArray(parsed) || parsed.length !== 64) throw new Error('Account file is not a Solana secret key');
  const signer = Keypair.fromSecretKey(Uint8Array.from(parsed));
  return {
    publicKey: signer.publicKey.toBase58(),
    async signTransaction(transaction) {
      transaction.partialSign(signer);
      return transaction;
    },
  };
}

/** Starts a payment session from the caller's mandate fields and wallet. */
export async function beginPayment(options: MandatePayment): Promise<PaymentSession> {
  applyPaymentEnv(options);
  const api = await paymentModule();
  return api.beginPayment() as unknown as PaymentSession;
}

/** Binds the session to an open channel. Does not mint, deposit, or create a signer. */
export async function attachFundedChannel(session: PaymentSession, expected: { channel: string; escrow: string; mint: string; payer: string; payee: string; authorizedSigner: string }): Promise<Record<string, unknown>> {
  const api = await paymentModule();
  const attach = api.attachFundedChannel as unknown as (session: PaymentSession, expected: object) => Promise<Record<string, unknown>>;
  return attach(session, expected);
}

/** Mints the voucher key for this mandate. */
export async function createVoucherKey(session: PaymentSession): Promise<{ mandateId: string; publicKey: string }> {
  const api = await paymentModule();
  return api.createVoucherKey(session) as Promise<{ mandateId: string; publicKey: string }>;
}

/** Creates a demo mint and marks the session so depositUpfront may mint supply. */
export async function createDemoMint(session: PaymentSession): Promise<{ mint: string }> {
  const api = await paymentModule();
  return api.createDemoMint(session) as Promise<{ mint: string }>;
}

/** Locks an existing mint. A wallet funds without a local payer secret. Does not mint tokens. */
export async function fundChannel(session: PaymentSession, mint: string, wallet?: WalletSigner): Promise<{ channel: string; deposit: string; openSignature: string; ataSignature?: string }> {
  const api = await paymentModule();
  const fund = api.fundChannel as unknown as (session: PaymentSession, mint: string, wallet?: WalletSigner) => Promise<{ channel: string; deposit: string; openSignature: string }>;
  return fund(session, mint, wallet);
}

/** Builds and signs the mandate with the caller's scope and limits. */
export async function buildSignedMandate(session: PaymentSession): Promise<{ mandateId: string; publicKey: string; mint: string }> {
  const api = await paymentModule();
  return api.buildSignedMandate(session) as Promise<{ mandateId: string; publicKey: string; mint: string }>;
}

/** Mints the asset and locks the upfront deposit in the channel. */
export async function depositUpfront(session: PaymentSession): Promise<{ channel: string; deposit: string; openSignature: string }> {
  const api = await paymentModule();
  return api.depositUpfront(session) as Promise<{ channel: string; deposit: string; openSignature: string }>;
}

/** Asks the API to refuse a random payee, then sign the voucher for the settled amount. */
export async function createVoucher(session: PaymentSession): Promise<{ signed: boolean; messageHash: string }> {
  const api = await paymentModule();
  return api.createVoucher(session) as Promise<{ signed: boolean; messageHash: string }>;
}

/** Settles the signed voucher on devnet. */
export async function settleChannel(session: PaymentSession): Promise<{ settleSignature: string; receiptId: string }> {
  const api = await paymentModule();
  return api.settleChannel(session) as Promise<{ settleSignature: string; receiptId: string }>;
}

/** Sends the settled amount to the payee. */
export async function payPayee(session: PaymentSession): Promise<{ distributeSignature: string; payeeReceived: string }> {
  const api = await paymentModule();
  return api.payPayee(session) as Promise<{ distributeSignature: string; payeeReceived: string }>;
}

/** Returns the undeposited remainder to the wallet. */
export async function withdrawRemainder(session: PaymentSession): Promise<{ withdrawSignature: string; payerRemainder: string }> {
  const api = await paymentModule();
  return api.withdrawRemainder(session) as Promise<{ withdrawSignature: string; payerRemainder: string }>;
}

/** Runs every payment step. A failure deletes the voucher key. */
export async function createMandateAndTransfer(options: MandatePayment): Promise<{ publicKey: string }> {
  const session = await beginPayment(options);
  try {
    await createVoucherKey(session);
    await createDemoMint(session);
    await buildSignedMandate(session);
    await depositUpfront(session);
    await createVoucher(session);
    await settleChannel(session);
    await payPayee(session);
    await withdrawRemainder(session);
    return { publicKey: String(session.payerPublicKey) };
  } catch (error) {
    const api = await paymentModule();
    await api.forgetVoucherSession(session.mandateId as unknown as PaymentSession);
    throw error;
  }
}
