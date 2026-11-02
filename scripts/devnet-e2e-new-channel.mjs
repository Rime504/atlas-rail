/**
 * Phased Devnet e2e for a NEW Atlas Rail channel (real USDC mint).
 * Never touches the recovery channel. Default phases do not broadcast.
 *
 *   node scripts/devnet-e2e-new-channel.mjs <phase>
 *   node scripts/devnet-e2e-new-channel.mjs open --approve-broadcast open
 *
 * Phases: preflight | local | ensure-signer | prepare-open | open | deny | allow |
 *         settle | distribute | verify | anchor
 */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { serviceEnv } from './launch-voucher-services.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const requireAtlas = createRequire(join(root, 'packages/atlasrails/package.json'));
const requireX402 = createRequire(join(root, 'packages/x402-client/package.json'));
const requireMandate = createRequire(join(root, 'packages/mandate/package.json'));
const requireReceipt = createRequire(join(root, 'packages/receipt/package.json'));
const { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } = requireAtlas('@solana/web3.js');
const { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } = requireAtlas('@solana/spl-token');
const { encodeVoucherMessage } = requireX402('@atlas-rail/x402');
const { ed25519 } = requireMandate('@noble/curves/ed25519');
const { buildReceipt, verifyReceipt, hashResponseBody } = requireReceipt('@atlas-rail/receipt');

const payment = await import(pathToFileURL(join(root, 'packages/atlasrails/payment.mjs')).href);
const fund = await import(pathToFileURL(join(root, 'packages/atlasrails/channel-fund.mjs')).href);

export const FORBIDDEN_CHANNEL = 'GEMPoRi8Si9peeMnCg6jDp36mKjT1oQLeqwm3VaveFuz';
export const E2E_PAYER = '2Qy24Ut2fDfj1SXBQbzBpvEEX8QZcStcZng6M3ravpsb';
export const E2E_PAYEE = 'Ayc7LB6Mw9pHp5e3ZH38HdLErHrpztnuyb9aT2g4nhGM';
export const E2E_TREASURY_OWNER = '4zTeC5mVqWLruDexgU2mV66p9t5vCA9JyiZqdGDUspap';
export const E2E_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
export const E2E_PROGRAM = 'CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX';
export const E2E_DEPOSIT = 10_000n;
export const E2E_PAYMENT = 1_000n;
export const E2E_RPC = 'https://api.devnet.solana.com';
export const DEVNET_GENESIS = payment.DEVNET_GENESIS;
export const STATE_PATH = join(root, '.tmp', 'devnet-e2e-new-channel-state.json');
export const SIGNER_SECRET_PATH = join(root, '.demo', 'e2e-new-channel-voucher.json');

const APPROVALS = {
  open: 'open',
  settle: 'settle',
  distribute: 'distribute',
  anchor: 'anchor',
};

function loadDotEnv() {
  return serviceEnv();
}

function readJson(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

export function loadState() {
  return readJson(STATE_PATH, {});
}

export function saveState(patch) {
  const next = { ...loadState(), ...patch, updatedAt: new Date().toISOString() };
  if (next.channel === FORBIDDEN_CHANNEL) throw new Error('Recovery channel is forbidden for this e2e');
  writeJson(STATE_PATH, next);
  return next;
}

export function assertNotRecoveryChannel(channel) {
  if (!channel) return;
  if (channel === FORBIDDEN_CHANNEL) throw new Error('Recovery channel is forbidden for this e2e');
}

export function voucherSessionPath() {
  return payment.voucherSessionPath();
}

/** Persist a voucher key into the established voucher-sessions keyring format. Never logs the secret. */
export function persistVoucherSigner({
  mandateId,
  secretKey,
  path = voucherSessionPath(),
  secretPath = SIGNER_SECRET_PATH,
}) {
  if (!/^mnd_[A-Za-z0-9]{10,40}$/.test(mandateId)) throw new Error('mandate id is required');
  const keypair = Keypair.fromSecretKey(Uint8Array.from(secretKey));
  const label = `voucher:${mandateId}`;
  const file = readJson(path, { version: 1, keys: {} });
  if (!file.keys || typeof file.keys !== 'object') throw new Error('voucher session file is corrupt');
  const existing = file.keys[label];
  if (existing && existing.publicKey !== keypair.publicKey.toBase58()) {
    throw new Error('Signer configuration mismatch: mandate already has a different voucher key');
  }
  file.keys[label] = {
    publicKey: keypair.publicKey.toBase58(),
    secretKey: Array.from(keypair.secretKey),
  };
  writeJson(path, file);
  if (secretPath) writeJson(secretPath, Array.from(keypair.secretKey));
  return { mandateId, publicKey: keypair.publicKey.toBase58(), path, secretPath };
}

export function loadPersistedVoucherPublicKey(mandateId, path = voucherSessionPath()) {
  const file = readJson(path, { version: 1, keys: {} });
  const entry = file.keys?.[`voucher:${mandateId}`];
  return entry?.publicKey ?? null;
}

export function generateAndPersistVoucherSigner(mandateId = `mnd_${randomBytes(10).toString('hex').toUpperCase()}`) {
  const keypair = Keypair.generate();
  return persistVoucherSigner({ mandateId, secretKey: keypair.secretKey });
}

export async function verifySignerServicePublicKey({ signerUrl, mandateId, expectedPublicKey, fetchImpl = fetch, token }) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const listed = await fetchImpl(`${signerUrl.replace(/\/$/, '')}/v1/voucher-key?mandateId=${encodeURIComponent(mandateId)}`, { headers });
  if (!listed.ok) {
    const body = await listed.json().catch(() => ({}));
    throw new Error(`Signer service does not expose mandate voucher key (${listed.status}: ${body.error ?? 'unknown'})`);
  }
  const body = await listed.json();
  if (body.publicKey !== expectedPublicKey) {
    throw new Error('Signer configuration mismatch: service public key does not match persisted voucher signer');
  }
  return { publicKey: body.publicKey, matched: true };
}

function connection(env = loadDotEnv()) {
  return new Connection(env.SOLANA_RPC_URL || E2E_RPC, 'confirmed');
}

function payerKeypair(env = loadDotEnv()) {
  const configured = env.ATLAS_FUNDER_KEY_PATH;
  if (!configured) throw new Error('ATLAS_FUNDER_KEY_PATH is required');
  const path = existsSync(configured) ? configured : join(root, configured);
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))));
  if (payer.publicKey.toBase58() !== E2E_PAYER) throw new Error('Loaded fee payer does not match the expected payer');
  return payer;
}

function paymentFields(env, now = Math.floor(Date.now() / 1000)) {
  return {
    organizationId: env.ATLAS_ORGANIZATION_ID || 'org_e2e_new_channel',
    issuerName: env.ATLAS_ISSUER_NAME || 'Atlas Rail E2E',
    resource: env.ATLAS_RESOURCE || 'research',
    resourceUrl: env.ATLAS_RESOURCE_URL || 'http://localhost:4402/research/summary',
    deposit: E2E_DEPOSIT.toString(),
    settled: E2E_PAYMENT.toString(),
    maxPerPayment: env.ATLAS_MAX_PER_PAYMENT || '1000',
    maxPerWindow: env.ATLAS_MAX_PER_WINDOW || '10000',
    windowSeconds: Number(env.ATLAS_WINDOW_SECONDS || 3600),
    maxTotal: env.ATLAS_MAX_TOTAL || '10000',
    thresholdBaseUnits: env.ATLAS_THRESHOLD || '1000',
    approvalTtlSeconds: Number(env.ATLAS_APPROVAL_TTL_SECONDS || 600),
    requiredApprovals: Number(env.ATLAS_REQUIRED_APPROVALS || 1),
    notBefore: now - Number(env.ATLAS_VALID_AFTER_SECONDS || 60),
    expiresAt: now + Number(env.ATLAS_VALID_FOR_SECONDS || 86_400),
    voucherExpiresAt: now + Number(env.ATLAS_VOUCHER_TTL_SECONDS || 3_600),
    graceSeconds: Number(env.ATLAS_GRACE_SECONDS || 3600),
    salt: env.ATLAS_CHANNEL_SALT_E2E || String(BigInt(env.ATLAS_CHANNEL_SALT || '1') + 100n),
    network: env.ATLAS_NETWORK || 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    payeePath: env.ATLAS_PAYEE_KEY_PATH || join(root, '.demo', 'atlasrails-payee.json'),
    deniedRecipient: env.ATLAS_DENIED_RECIPIENT || Keypair.generate().publicKey.toBase58(),
    ownerSeed: env.ATLAS_OWNER_SEED,
    approverSeed: env.ATLAS_APPROVER_SEED,
    instanceSeed: env.ATLAS_INSTANCE_SEED,
    apiUrl: env.ATLAS_API_URL || 'http://127.0.0.1:3001',
    signerUrl: env.ATLAS_SIGNER_URL || 'http://127.0.0.1:3012',
    rpcUrl: env.SOLANA_RPC_URL || E2E_RPC,
  };
}

export function buildE2eSession(env = loadDotEnv(), state = loadState()) {
  for (const key of ['ATLAS_OWNER_SEED', 'ATLAS_APPROVER_SEED', 'ATLAS_INSTANCE_SEED']) {
    if (!env[key]) throw new Error(`${key} is required`);
  }
  process.env.ATLAS_ALLOW_MOCK_SIGNER = 'true';
  process.env.ATLAS_API_URL = env.ATLAS_API_URL || 'http://127.0.0.1:3001';
  process.env.ATLAS_SIGNER_URL = env.ATLAS_SIGNER_URL || 'http://127.0.0.1:3012';
  process.env.ATLAS_KEYRING_PATH = env.ATLAS_KEYRING_PATH || join(root, '.demo', 'keyring.json');
  if (env.ATLAS_VOUCHER_SESSION_PATH) process.env.ATLAS_VOUCHER_SESSION_PATH = env.ATLAS_VOUCHER_SESSION_PATH;
  process.env.ATLAS_FEE_PAYER = E2E_PAYER;
  const fields = paymentFields(env);
  if (state.deniedRecipient) fields.deniedRecipient = state.deniedRecipient;
  const mandateId = state.mandateId ?? `mnd_${randomBytes(10).toString('hex').toUpperCase()}`;
  const resolved = payment.resolvePayment(fields);
  const payer = payerKeypair(env);
  const { LocalEd25519Signer } = requireMandate('@atlas-rail/mandate');
  const seedBytes = (hex, name) => {
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error(`${name} must be 32 bytes of hex`);
    return Uint8Array.from(Buffer.from(hex, 'hex'));
  };
  const mint = new PublicKey(E2E_MINT);
  const channel = state.channel ? new PublicKey(state.channel) : null;
  assertNotRecoveryChannel(state.channel);
  return {
    payment: resolved,
    depositAmount: E2E_DEPOSIT,
    settledAmount: E2E_PAYMENT,
    connection: connection(env),
    payer,
    recipient: { publicKey: new PublicKey(E2E_PAYEE) },
    instance: new LocalEd25519Signer(seedBytes(fields.instanceSeed, 'instanceSeed')),
    owner: new LocalEd25519Signer(seedBytes(fields.ownerSeed, 'ownerSeed')),
    approver: new LocalEd25519Signer(seedBytes(fields.approverSeed, 'approverSeed')),
    mandateId,
    nonce: state.nonce ?? randomBytes(16).toString('hex'),
    payerPublicKey: E2E_PAYER,
    payeePublicKey: E2E_PAYEE,
    mint,
    demoMint: false,
    fundedChannel: false,
    channel,
    channelAta: state.escrow ? { address: new PublicKey(state.escrow) } : null,
    payerAta: { address: getAssociatedTokenAddressSync(mint, payer.publicKey) },
    payeeAta: { address: getAssociatedTokenAddressSync(mint, new PublicKey(E2E_PAYEE)) },
    treasuryAta: { address: getAssociatedTokenAddressSync(mint, new PublicKey(E2E_TREASURY_OWNER)) },
    agent: state.authorizedSigner ? { publicKey: state.authorizedSigner } : null,
    deniedRecipient: fields.deniedRecipient,
  };
}

async function bindAgentFromSigner(session, state) {
  if (!state.authorizedSigner || !state.mandateId) throw new Error('ensure-signer first');
  const agent = await payment.signerAgent(state.mandateId);
  if (agent.publicKey !== state.authorizedSigner) {
    throw new Error('Signer configuration mismatch: minted key does not match persisted voucher signer');
  }
  session.agent = agent;
  return agent;
}

export async function phasePreflight(env = loadDotEnv()) {
  const rpc = connection(env);
  const genesis = await rpc.getGenesisHash();
  if (genesis !== DEVNET_GENESIS) throw new Error('RPC cluster is not Solana devnet');
  const program = await rpc.getAccountInfo(new PublicKey(E2E_PROGRAM), 'confirmed');
  if (!program?.executable) throw new Error('Payment program is not executable');
  const mintInfo = await rpc.getAccountInfo(new PublicKey(E2E_MINT), 'confirmed');
  if (!mintInfo || !mintInfo.owner.equals(TOKEN_PROGRAM_ID)) throw new Error('Mint is not the original SPL Token program');
  const payer = payerKeypair(env);
  const payerAta = getAssociatedTokenAddressSync(new PublicKey(E2E_MINT), payer.publicKey);
  const token = await rpc.getAccountInfo(payerAta, 'confirmed');
  if (!token) throw new Error('Payer token account is missing');
  const balance = token.data.readBigUInt64LE(64);
  const sol = await rpc.getBalance(payer.publicKey, 'confirmed');
  const recovery = await rpc.getAccountInfo(new PublicKey(FORBIDDEN_CHANNEL), 'confirmed');
  const payeeAta = getAssociatedTokenAddressSync(new PublicKey(E2E_MINT), new PublicKey(E2E_PAYEE));
  const treasuryAta = getAssociatedTokenAddressSync(new PublicKey(E2E_MINT), new PublicKey(E2E_TREASURY_OWNER));
  const [payeeAtaInfo, treasuryAtaInfo] = await Promise.all([
    rpc.getAccountInfo(payeeAta, 'confirmed'),
    rpc.getAccountInfo(treasuryAta, 'confirmed'),
  ]);
  const channelRent = await rpc.getMinimumBalanceForRentExemption(256);
  const tokenRent = await rpc.getMinimumBalanceForRentExemption(165);
  let apiOk = false;
  let signerOk = false;
  try {
    apiOk = (await fetch(`${(env.ATLAS_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '')}/health/live`)).ok;
  } catch {
    apiOk = false;
  }
  try {
    signerOk = (await fetch(`${(env.ATLAS_SIGNER_URL || 'http://127.0.0.1:3012').replace(/\/$/, '')}/health`)).ok;
  } catch {
    signerOk = false;
  }
  const report = {
    phase: 'preflight',
    genesisOk: true,
    program: E2E_PROGRAM,
    mint: E2E_MINT,
    payer: E2E_PAYER,
    payee: E2E_PAYEE,
    treasuryOwner: E2E_TREASURY_OWNER,
    payerAta: payerAta.toBase58(),
    payeeAta: payeeAta.toBase58(),
    treasuryAta: treasuryAta.toBase58(),
    usdcBalance: balance.toString(),
    deposit: E2E_DEPOSIT.toString(),
    payment: E2E_PAYMENT.toString(),
    balanceCoversDeposit: balance >= E2E_DEPOSIT,
    solLamports: sol,
    channelRentLamports: channelRent,
    tokenRentLamports: tokenRent,
    openFeeCapLamports: fund.OPEN_FEE_CAP_LAMPORTS,
    maxSolDebitLamports: channelRent + tokenRent + fund.OPEN_FEE_CAP_LAMPORTS,
    payeeAtaExists: Boolean(payeeAtaInfo),
    treasuryAtaExists: Boolean(treasuryAtaInfo),
    recoveryChannel: FORBIDDEN_CHANNEL,
    recoveryStatus: recovery ? recovery.data[3] : null,
    recoveryUntouched: true,
    apiHealth: apiOk,
    signerHealth: signerOk,
    broadcast: false,
  };
  if (!report.balanceCoversDeposit) throw new Error('Payer USDC balance is below the deposit');
  return report;
}

export async function phaseEnsureSigner(env = loadDotEnv()) {
  const state = loadState();
  const mandateId = state.mandateId ?? `mnd_${randomBytes(10).toString('hex').toUpperCase()}`;
  const deniedRecipient = state.deniedRecipient ?? Keypair.generate().publicKey.toBase58();
  let persisted;
  if (state.authorizedSigner) {
    const existing = loadPersistedVoucherPublicKey(mandateId);
    if (existing !== state.authorizedSigner) {
      throw new Error('Signer configuration mismatch: state public key is not in voucher-sessions');
    }
    persisted = { mandateId, publicKey: state.authorizedSigner, path: voucherSessionPath() };
  } else if (existsSync(SIGNER_SECRET_PATH) && state.mandateId) {
    persisted = persistVoucherSigner({
      mandateId,
      secretKey: Uint8Array.from(JSON.parse(readFileSync(SIGNER_SECRET_PATH, 'utf8'))),
    });
  } else {
    persisted = generateAndPersistVoucherSigner(mandateId);
  }
  let serviceMatch = null;
  try {
    const minted = await payment.signerAgent(mandateId);
    if (minted.publicKey !== persisted.publicKey) {
      throw new Error('Signer configuration mismatch: POST /v1/voucher-key returned a different key');
    }
    serviceMatch = await verifySignerServicePublicKey({
      signerUrl: env.ATLAS_SIGNER_URL || 'http://127.0.0.1:3012',
      mandateId,
      expectedPublicKey: persisted.publicKey,
      token: env.ATLAS_SIGNER_TOKEN,
    });
  } catch (error) {
    serviceMatch = { matched: false, error: error instanceof Error ? error.message : String(error) };
  }
  const next = saveState({
    mandateId,
    nonce: state.nonce ?? randomBytes(16).toString('hex'),
    authorizedSigner: persisted.publicKey,
    deniedRecipient,
    salt: paymentFields(env).salt,
  });
  return {
    phase: 'ensure-signer',
    mandateId: next.mandateId,
    authorizedSigner: next.authorizedSigner,
    persistedInVoucherSessions: true,
    secretPath: SIGNER_SECRET_PATH,
    serviceMatch,
    broadcast: false,
  };
}

export async function phasePrepareOpen(env = loadDotEnv()) {
  const state = loadState();
  if (!state.authorizedSigner) throw new Error('ensure-signer first');
  const session = buildE2eSession(env, state);
  await bindAgentFromSigner(session, state);
  const { createMandate, signMandate } = requireMandate('@atlas-rail/mandate');
  // Mandate is signed locally for prepare; API deny/allow re-validate it.
  let mandate = createMandate({
    id: session.mandateId,
    nonce: session.nonce,
    issuer: { organizationId: session.payment.organizationId, name: session.payment.issuerName },
    agent: { publicKey: session.agent.publicKey, label: 'Channel signer' },
    delegation: { requiredApprovals: session.payment.requiredApprovals },
    scope: {
      allowedNetworks: [session.payment.network],
      allowedAssets: [E2E_MINT],
      allowedPayTo: [E2E_PAYEE],
      allowedResources: [session.payment.resource],
      limits: {
        mint: E2E_MINT,
        maxPerPayment: session.payment.maxPerPayment,
        maxPerWindow: session.payment.maxPerWindow,
        windowSeconds: session.payment.windowSeconds,
        maxTotal: session.payment.maxTotal,
      },
      priceLimits: [],
    },
    escalation: {
      thresholdBaseUnits: session.payment.thresholdBaseUnits,
      approverRoles: ['OWNER', 'APPROVER'],
      resources: [],
      approvalTtlSeconds: session.payment.approvalTtlSeconds,
    },
    notBefore: session.payment.notBefore,
    expiresAt: session.payment.expiresAt,
  });
  mandate = await signMandate(mandate, { role: 'OWNER', signer: session.owner });
  mandate = await signMandate(mandate, { role: 'APPROVER', signer: session.approver });
  session.mandate = await signMandate(mandate, { role: 'AGENT', signer: session.agent });
  const prepared = await fund.prepareChannelOpen(session);
  assertNotRecoveryChannel(prepared.channel);
  saveState({
    mandate: session.mandate,
    preparedOpen: {
      channel: prepared.channel,
      escrow: prepared.channelAta,
      deposit: prepared.deposit,
      feeLamports: prepared.feeLamports,
      channelRentLamports: prepared.channelRentLamports,
      tokenRentLamports: prepared.tokenRentLamports,
      agent: prepared.agent,
      slotBound: true,
    },
    channel: prepared.channel,
    escrow: prepared.channelAta,
  });
  return {
    phase: 'prepare-open',
    awaitingApproval: true,
    broadcast: false,
    approvalCommand: 'node scripts/devnet-e2e-new-channel.mjs open --approve-broadcast open',
    forbiddenChannel: FORBIDDEN_CHANNEL,
    ...prepared,
    requiredSigners: [E2E_PAYER],
    effect: 'Opens a new channel and deposits 10000 base units of Devnet USDC into escrow. Does not touch the recovery channel.',
  };
}

export async function phaseOpen(env, approval) {
  if (approval !== APPROVALS.open) throw new Error('Explicit approval is required before broadcasting open');
  const state = loadState();
  if (!state.preparedOpen?.channel) throw new Error('prepare-open first');
  assertNotRecoveryChannel(state.preparedOpen.channel);
  const session = buildE2eSession(env, state);
  await bindAgentFromSigner(session, state);
  session.mandate = state.mandate;
  const pre = await phasePreflight(env);
  if (!pre.payeeAtaExists || !pre.treasuryAtaExists) {
    throw new Error('Payee or treasury ATA is missing; create those accounts before open');
  }
  // Channel PDA includes the current slot. Rebuild immediately before send; do not reuse a stale prepare.
  const prepared = await fund.prepareChannelOpen(session);
  assertNotRecoveryChannel(prepared.channel);
  if (prepared.agent !== state.authorizedSigner) throw new Error('Prepared agent does not match the voucher signer');
  if (prepared.mint !== E2E_MINT || prepared.deposit !== E2E_DEPOSIT.toString()) throw new Error('Prepared deposit mismatch');
  if (prepared.payer !== E2E_PAYER || prepared.payee !== E2E_PAYEE) throw new Error('Prepared party mismatch');
  const opened = await fund.submitPreparedOpen(session, prepared);
  assertNotRecoveryChannel(opened.channel);
  const info = await session.connection.getAccountInfo(new PublicKey(opened.channel), 'confirmed');
  const decoded = payment.readChannel(info.data);
  if (decoded.authorizedSigner !== state.authorizedSigner) throw new Error('On-chain authorized signer mismatch');
  if (decoded.mint !== E2E_MINT || decoded.deposit !== E2E_DEPOSIT) throw new Error('Open deposit mismatch');
  if (decoded.payer !== E2E_PAYER || decoded.payee !== E2E_PAYEE) throw new Error('Open party mismatch');
  const escrow = typeof session.channelAta?.address?.toBase58 === 'function'
    ? session.channelAta.address.toBase58()
    : session.channelAta.toBase58();
  saveState({
    channel: opened.channel,
    escrow,
    openSignature: opened.openSignature,
    status: decoded.status,
    preparedOpen: {
      ...state.preparedOpen,
      channel: prepared.channel,
      escrow: prepared.channelAta,
      feeLamports: prepared.feeLamports,
    },
  });
  return {
    phase: 'open',
    broadcast: true,
    channel: opened.channel,
    escrow,
    openSignature: opened.openSignature,
    authorizedSigner: decoded.authorizedSigner,
    deposit: decoded.deposit.toString(),
    status: decoded.status,
    note: 'Channel address is taken from the slot at broadcast time, not the earlier prepare-open preview.',
  };
}

export async function phaseDeny(env = loadDotEnv()) {
  const state = loadState();
  if (!state.mandate || !state.channel) throw new Error('open a channel and keep mandate state first');
  assertNotRecoveryChannel(state.channel);
  const session = buildE2eSession(env, state);
  await bindAgentFromSigner(session, state);
  session.mandate = state.mandate;
  const body = await payment.askAtlasRail({
    mandate: session.mandate,
    channelId: state.channel,
    cumulativeAmount: E2E_PAYMENT.toString(),
    expiresAt: session.payment.voucherExpiresAt,
    recipient: state.deniedRecipient,
    resourceUrl: session.payment.resourceUrl,
    asset: E2E_MINT,
    network: session.payment.network,
    chainSettled: '0',
  });
  if (body.signed) throw new Error('Unauthorized recipient was signed');
  if (body.signatureBase64) throw new Error('Denied voucher included a signature');
  saveState({ denial: { signed: false, message: body.message ?? 'MandateDeniedError' } });
  return {
    phase: 'deny',
    decision: 'DENY',
    signed: false,
    message: body.message ?? 'MandateDeniedError',
    hasSignature: false,
    channel: state.channel,
    broadcast: false,
  };
}

export async function phaseAllow(env = loadDotEnv()) {
  const state = loadState();
  if (!state.mandate || !state.channel) throw new Error('open a channel and keep mandate state first');
  assertNotRecoveryChannel(state.channel);
  const session = buildE2eSession(env, state);
  await bindAgentFromSigner(session, state);
  session.mandate = state.mandate;
  const body = await payment.askAtlasRail({
    mandate: session.mandate,
    channelId: state.channel,
    cumulativeAmount: E2E_PAYMENT.toString(),
    expiresAt: session.payment.voucherExpiresAt,
    recipient: E2E_PAYEE,
    resourceUrl: session.payment.resourceUrl,
    asset: E2E_MINT,
    network: session.payment.network,
    feePayer: E2E_PAYER,
    chainSettled: '0',
  });
  if (!body.signed) throw new Error('Allowed voucher was not signed');
  const message = Uint8Array.from(Buffer.from(body.messageBase64, 'base64'));
  const signature = Uint8Array.from(Buffer.from(body.signatureBase64, 'base64'));
  if (message.length !== 50) throw new Error('Voucher message is not 50 bytes');
  const expected = encodeVoucherMessage({
    channelId: state.channel,
    cumulativeAmount: E2E_PAYMENT,
    expiresAt: BigInt(session.payment.voucherExpiresAt),
  });
  if (Buffer.compare(Buffer.from(message), Buffer.from(expected)) !== 0) throw new Error('Voucher bytes do not match the canonical encoding');
  const ok = ed25519.verify(signature, message, new PublicKey(state.authorizedSigner).toBytes());
  if (!ok) throw new Error('Voucher signature does not verify against the authorized signer');
  saveState({
    allowed: {
      messageBase64: body.messageBase64,
      signatureBase64: body.signatureBase64,
      messageHash: body.messageHash,
      deltaAmount: body.deltaAmount,
      decision: body.decision,
    },
  });
  return {
    phase: 'allow',
    decision: 'ALLOW',
    signed: true,
    messageHash: body.messageHash,
    deltaAmount: body.deltaAmount,
    voucherBytes: 50,
    signatureVerified: true,
    authorizedSigner: state.authorizedSigner,
    broadcast: false,
  };
}

function settleInstruction(channel, agentPubkey, signature, message) {
  const settleIx = new TransactionInstruction({
    programId: fund.PROGRAM_ID,
    keys: [
      { pubkey: new PublicKey(channel), isSigner: false, isWritable: true },
      { pubkey: fund.INSTRUCTIONS_SYSVAR, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([2]),
  });
  return new Transaction().add(
    payment.ed25519Instruction(new PublicKey(agentPubkey).toBytes(), signature, message),
    settleIx,
  );
}

export async function phaseSettle(env, approval = null) {
  const state = loadState();
  if (!state.allowed || !state.channel) throw new Error('allow first');
  assertNotRecoveryChannel(state.channel);
  const session = buildE2eSession(env, state);
  const message = Uint8Array.from(Buffer.from(state.allowed.messageBase64, 'base64'));
  const signature = Uint8Array.from(Buffer.from(state.allowed.signatureBase64, 'base64'));
  const tx = settleInstruction(state.channel, state.authorizedSigner, signature, message);
  tx.feePayer = session.payer.publicKey;
  const latest = await session.connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = latest.blockhash;
  const fee = await session.connection.getFeeForMessage(tx.compileMessage(), 'confirmed');
  if (fee.value == null) throw new Error('Fee estimate is unavailable');
  if (!approval) {
    const simulateOnly = {
      simulateTransaction: (transaction) => session.connection.simulateTransaction(transaction),
      getLatestBlockhash: () => session.connection.getLatestBlockhash('confirmed'),
    };
    tx.partialSign(session.payer);
    const simulated = await simulateOnly.simulateTransaction(tx);
    return {
      phase: 'settle',
      awaitingApproval: true,
      broadcast: false,
      approvalCommand: 'node scripts/devnet-e2e-new-channel.mjs settle --approve-broadcast settle',
      channel: state.channel,
      feeLamports: fee.value,
      simulation: { err: simulated.value?.err ?? null, logs: simulated.value?.logs ?? [], unitsConsumed: simulated.value?.unitsConsumed ?? null },
      instructionData: '02',
      requiredSigners: [E2E_PAYER],
    };
  }
  if (approval !== APPROVALS.settle) throw new Error('Explicit approval is required before broadcasting settle');
  const before = payment.readChannel((await session.connection.getAccountInfo(new PublicKey(state.channel), 'confirmed')).data);
  if (before.settled !== 0n) throw new Error('Channel settled watermark is not zero');
  const settleSig = await fund.submitSigned(session.connection, settleInstruction(state.channel, state.authorizedSigner, signature, message), {
    feePayer: session.payer,
    localSigners: [session.payer],
  });
  const after = payment.readChannel((await session.connection.getAccountInfo(new PublicKey(state.channel), 'confirmed')).data);
  if (after.settled !== E2E_PAYMENT) throw new Error(`Settled watermark is ${after.settled}`);
  const issuedAt = Math.floor(Date.now() / 1000);
  const receipt = await buildReceipt(
    {
      id: `rcp_${state.allowed.messageHash.slice(0, 16)}`,
      mandate: state.mandate,
      decision: state.allowed.decision,
      settlement: {
        txSignature: settleSig,
        network: state.allowed.decision.record.offer.network,
        payer: state.authorizedSigner,
        settledAt: issuedAt,
        slot: null,
      },
      response: {
        status: 200,
        bodySha256: hashResponseBody(Buffer.from(message)),
        contentType: 'application/vnd.payment-channels.voucher',
      },
      issuedAt,
    },
    session.instance,
  );
  saveState({ settleSignature: settleSig, settled: after.settled.toString(), receipt });
  return {
    phase: 'settle',
    broadcast: true,
    settleSignature: settleSig,
    settledBefore: before.settled.toString(),
    settledAfter: after.settled.toString(),
    receiptId: receipt.id,
  };
}

function distributeInstruction(session, channel) {
  return new TransactionInstruction({
    programId: fund.PROGRAM_ID,
    keys: [
      { pubkey: new PublicKey(channel), isSigner: false, isWritable: true },
      { pubkey: session.payer.publicKey, isSigner: false, isWritable: true },
      { pubkey: session.payer.publicKey, isSigner: false, isWritable: true },
      { pubkey: session.channelAta.address, isSigner: false, isWritable: true },
      { pubkey: session.payerAta.address, isSigner: false, isWritable: true },
      { pubkey: session.payeeAta.address, isSigner: false, isWritable: true },
      { pubkey: session.treasuryAta.address, isSigner: false, isWritable: true },
      { pubkey: session.mint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: PublicKey.findProgramAddressSync([Buffer.from('event_authority')], fund.PROGRAM_ID)[0], isSigner: false, isWritable: false },
      { pubkey: fund.PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: payment.distributeData(),
  });
}

export async function phaseDistribute(env, approval = null) {
  const state = loadState();
  if (!state.settleSignature || !state.channel) throw new Error('settle first');
  assertNotRecoveryChannel(state.channel);
  const session = buildE2eSession(env, state);
  session.channelAta = { address: new PublicKey(state.escrow) };
  const ix = distributeInstruction(session, state.channel);
  const tx = new Transaction().add(ix);
  tx.feePayer = session.payer.publicKey;
  const latest = await session.connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = latest.blockhash;
  const fee = await session.connection.getFeeForMessage(tx.compileMessage(), 'confirmed');
  if (fee.value == null) throw new Error('Fee estimate is unavailable');
  if (!approval) {
    tx.partialSign(session.payer);
    const simulated = await session.connection.simulateTransaction(tx);
    return {
      phase: 'distribute',
      awaitingApproval: true,
      broadcast: false,
      approvalCommand: 'node scripts/devnet-e2e-new-channel.mjs distribute --approve-broadcast distribute',
      feeLamports: fee.value,
      simulation: { err: simulated.value?.err ?? null, logs: simulated.value?.logs ?? [], unitsConsumed: simulated.value?.unitsConsumed ?? null },
      instructionDataHex: Buffer.from(payment.distributeData()).toString('hex'),
    };
  }
  if (approval !== APPROVALS.distribute) throw new Error('Explicit approval is required before broadcasting distribute');
  const payeeBefore = BigInt((await session.connection.getTokenAccountBalance(session.payeeAta.address, 'confirmed')).value.amount);
  const treasuryBefore = BigInt((await session.connection.getTokenAccountBalance(session.treasuryAta.address, 'confirmed')).value.amount);
  const sig = await fund.submitSigned(session.connection, new Transaction().add(ix), {
    feePayer: session.payer,
    localSigners: [session.payer],
  });
  const after = payment.readChannel((await session.connection.getAccountInfo(new PublicKey(state.channel), 'confirmed')).data);
  const payeeAfter = BigInt((await session.connection.getTokenAccountBalance(session.payeeAta.address, 'confirmed')).value.amount);
  const treasuryAfter = BigInt((await session.connection.getTokenAccountBalance(session.treasuryAta.address, 'confirmed')).value.amount);
  if (after.payoutWatermark !== E2E_PAYMENT) throw new Error(`Payout watermark is ${after.payoutWatermark}`);
  saveState({
    distributeSignature: sig,
    payoutWatermark: after.payoutWatermark.toString(),
    payeeDelta: (payeeAfter - payeeBefore).toString(),
    treasuryDelta: (treasuryAfter - treasuryBefore).toString(),
  });
  return {
    phase: 'distribute',
    broadcast: true,
    distributeSignature: sig,
    payoutWatermark: after.payoutWatermark.toString(),
    payeeDelta: (payeeAfter - payeeBefore).toString(),
    treasuryDelta: (treasuryAfter - treasuryBefore).toString(),
  };
}

export async function phaseVerify(env = loadDotEnv()) {
  const state = loadState();
  if (!state.channel) throw new Error('no channel in state');
  assertNotRecoveryChannel(state.channel);
  const rpc = connection(env);
  const info = await rpc.getAccountInfo(new PublicKey(state.channel), 'confirmed');
  const decoded = payment.readChannel(info.data);
  const escrow = await rpc.getTokenAccountBalance(new PublicKey(state.escrow), 'confirmed');
  let receiptCheck = null;
  if (state.receipt && state.settleSignature) {
    receiptCheck = await verifyReceipt(state.receipt, {
      trustedInstanceKeys: [state.receipt.instance.publicKey],
    });
  }
  const denialHasNoSuccessReceipt = !state.denial || !state.denial.signed;
  return {
    phase: 'verify',
    channel: state.channel,
    status: decoded.status,
    deposit: decoded.deposit.toString(),
    settled: decoded.settled.toString(),
    payoutWatermark: decoded.payoutWatermark.toString(),
    authorizedSigner: decoded.authorizedSigner,
    escrowAmount: escrow.value.amount,
    openSignature: state.openSignature ?? null,
    settleSignature: state.settleSignature ?? null,
    distributeSignature: state.distributeSignature ?? null,
    receiptId: state.receipt?.id ?? null,
    receiptVerifyPass: receiptCheck?.pass ?? null,
    denialHasNoSuccessReceipt,
    matchesExpected:
      decoded.authorizedSigner === state.authorizedSigner
      && decoded.mint === E2E_MINT
      && decoded.payer === E2E_PAYER
      && decoded.payee === E2E_PAYEE
      && state.channel !== FORBIDDEN_CHANNEL,
    evidenceClass: {
      open: state.openSignature ? 'finalized-devnet' : 'none',
      settle: state.settleSignature ? 'finalized-devnet' : 'none',
      distribute: state.distributeSignature ? 'finalized-devnet' : 'none',
      denial: state.denial ? 'live-api' : 'none',
      allow: state.allowed ? 'live-api' : 'none',
    },
    broadcast: false,
  };
}

export async function phaseAnchor(env, approval = null) {
  const state = loadState();
  if (!state.receipt) throw new Error('settle first so a receipt exists');
  if (env.ATLAS_ANCHOR_ROOT !== 'true' && env.ATLAS_ANCHOR_ROOT !== '1') {
    return {
      phase: 'anchor',
      skipped: true,
      reason: 'ATLAS_ANCHOR_ROOT is not enabled in this environment',
      broadcast: false,
    };
  }
  if (!approval) {
    return {
      phase: 'anchor',
      awaitingApproval: true,
      broadcast: false,
      approvalCommand: 'node scripts/devnet-e2e-new-channel.mjs anchor --approve-broadcast anchor',
      receiptId: state.receipt.id,
      note: 'Prepare uses packages/receipt AnchorService; broadcast stays gated.',
    };
  }
  if (approval !== APPROVALS.anchor) throw new Error('Explicit approval is required before broadcasting anchor');
  throw new Error('Anchor broadcast is not wired in this runner yet; leave ATLAS_ANCHOR_ROOT off or extend AnchorService wiring');
}

export function phaseLocal() {
  const result = spawnSync(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['exec', 'vitest', 'run', 'packages/atlasrails/src/devnet-e2e-new-channel.test.ts', 'packages/atlasrails/src/funded-channel.test.ts', 'packages/atlasrails/src/recover-funded-channel.test.ts'],
    { cwd: root, encoding: 'utf8', env: { ...process.env, TEMP: join(root, '.tmp'), TMP: join(root, '.tmp') } },
  );
  return {
    phase: 'local',
    exitCode: result.status,
    pass: result.status === 0,
    output: (result.stdout || '') + (result.stderr || ''),
    broadcast: false,
  };
}

function approvalFromArgv(argv) {
  const index = argv.indexOf('--approve-broadcast');
  if (index < 0) return null;
  return argv[index + 1] ?? null;
}

export async function main(argv = process.argv.slice(2)) {
  Object.assign(process.env, loadDotEnv());
  const phase = argv[0];
  const approval = approvalFromArgv(argv);
  if (!phase) {
    console.log(JSON.stringify({
      usage: 'node scripts/devnet-e2e-new-channel.mjs <phase> [--approve-broadcast <action>]',
      phases: ['preflight', 'local', 'ensure-signer', 'prepare-open', 'open', 'deny', 'allow', 'settle', 'distribute', 'verify', 'anchor'],
      forbiddenChannel: FORBIDDEN_CHANNEL,
      defaultBroadcast: false,
    }, null, 2));
    return;
  }
  const env = loadDotEnv();
  let result;
  switch (phase) {
    case 'preflight':
      result = await phasePreflight(env);
      break;
    case 'local':
      result = phaseLocal();
      break;
    case 'ensure-signer':
      result = await phaseEnsureSigner(env);
      break;
    case 'prepare-open':
      result = await phasePrepareOpen(env);
      break;
    case 'open':
      result = await phaseOpen(env, approval);
      break;
    case 'deny':
      result = await phaseDeny(env);
      break;
    case 'allow':
      result = await phaseAllow(env);
      break;
    case 'settle':
      result = await phaseSettle(env, approval);
      break;
    case 'distribute':
      result = await phaseDistribute(env, approval);
      break;
    case 'verify':
      result = await phaseVerify(env);
      break;
    case 'anchor':
      result = await phaseAnchor(env, approval);
      break;
    default:
      throw new Error(`Unknown phase ${phase}`);
  }
  console.log(JSON.stringify(result, null, 2));
  return result;
}

const invoked = process.argv[1]?.replaceAll('\\', '/').endsWith('scripts/devnet-e2e-new-channel.mjs');
if (invoked) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'e2e failed');
    process.exit(1);
  });
}
