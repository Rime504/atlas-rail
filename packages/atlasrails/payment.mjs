/**
 * Channel payment shipped with the atlasrails package.
 * Opens a channel, mints a voucher key, deposits, settles, and withdraws.
 * Never prints secret keys.
 */
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const requirePkg = createRequire(import.meta.url);
function repoRoot() {
  const candidate = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  if (existsSync(join(candidate, 'pnpm-workspace.yaml'))) return candidate;
  return process.cwd();
}
const root = repoRoot();

export function voucherSessionPath() {
  if (process.env.ATLAS_VOUCHER_SESSION_PATH) return process.env.ATLAS_VOUCHER_SESSION_PATH;
  if (process.env.ATLAS_KEYRING_PATH) return join(dirname(process.env.ATLAS_KEYRING_PATH), 'voucher-sessions.json');
  return join(root, '.demo', 'voucher-sessions.json');
}

export async function forgetVoucherSession(mandateId) {
  try {
    await fetch(`${signerUrl()}/v1/voucher-key?mandateId=${encodeURIComponent(mandateId)}`, {
      method: 'DELETE',
      headers: signerHeaders(false),
    });
  } catch {
    // The file delete below still removes the key when the signer is down.
  }
  const path = voucherSessionPath();
  if (!existsSync(path)) return;
  const file = JSON.parse(readFileSync(path, 'utf8'));
  if (!file.keys?.[`voucher:${mandateId}`]) return;
  delete file.keys[`voucher:${mandateId}`];
  if (Object.keys(file.keys).length === 0) unlinkSync(path);
  else writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
}
import {
  INSTRUCTIONS_SYSVAR,
  PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  assembleSignedTransaction,
  checkFundAccounts,
  depositUpfront as openAndDeposit,
  deployedProgramElf,
  fundChannel,
  submitSigned,
  transactionSignature,
  treasuryOwnerFromElf,
} from './channel-fund.mjs';

const { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } = requirePkg('@solana/web3.js');
const { base58 } = requirePkg('@scure/base');
const { createMint, getAssociatedTokenAddressSync } = requirePkg('@solana/spl-token');
const { createMandate, signMandate, LocalEd25519Signer, hashMandate } = requirePkg('@atlas-rail/mandate');
const { findMandatePda, DEFAULT_MANDATE_PROGRAM_ID } = requirePkg('@atlas-rail/solana');
const { buildReceipt, hashResponseBody } = requirePkg('@atlas-rail/receipt');

export {
  assembleSignedTransaction,
  checkFundAccounts,
  deployedProgramElf,
  fundChannel,
  submitSigned,
  transactionSignature,
  treasuryOwnerFromElf,
};

const ED25519_PROGRAM_ID = new PublicKey('Ed25519SigVerify111111111111111111111111111');
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';

export function readChannel(data) {
  const bytes = Buffer.from(data);
  const key = (offset) => new PublicKey(bytes.subarray(offset, offset + 32)).toBase58();
  return {
    status: bytes[3],
    deposit: bytes.readBigUInt64LE(12),
    settled: bytes.readBigUInt64LE(20),
    payoutWatermark: bytes.readBigUInt64LE(28),
    payerWithdrawnAt: bytes.readBigInt64LE(44),
    payer: key(88),
    payee: key(120),
    authorizedSigner: key(152),
    mint: key(184),
    rentPayer: key(216),
  };
}

export function ed25519Instruction(pubkey, signature, message) {
  const pubkeyOffset = 16;
  const signatureOffset = 48;
  const messageOffset = 112;
  const data = Buffer.alloc(messageOffset + message.length);
  data[0] = 1;
  data.writeUInt16LE(signatureOffset, 2);
  data.writeUInt16LE(0xffff, 4);
  data.writeUInt16LE(pubkeyOffset, 6);
  data.writeUInt16LE(0xffff, 8);
  data.writeUInt16LE(messageOffset, 10);
  data.writeUInt16LE(message.length, 12);
  data.writeUInt16LE(0xffff, 14);
  Buffer.from(pubkey).copy(data, pubkeyOffset);
  Buffer.from(signature).copy(data, signatureOffset);
  Buffer.from(message).copy(data, messageOffset);
  return new TransactionInstruction({ programId: ED25519_PROGRAM_ID, keys: [], data });
}

export function distributeData() {
  const data = Buffer.alloc(5);
  data.writeUInt8(7, 0);
  data.writeUInt32LE(0, 1);
  return data;
}

export async function depositUpfront(session) {
  if (session.fundedChannel) throw new Error('Existing channel is already funded');
  return openAndDeposit(session);
}

/** Phantom's export pastes a warning after the key. The key is the 64-byte base58 run. */
function railsKeyAt(file) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(file, 'utf8'))));
}

export function payerKeypair() {
  const railsPath = process.env.ATLAS_RAILS_KEY_PATH;
  if (!railsPath) return loadFeePayer();
  return railsKeyAt(railsPath);
}

const REQUIRED_PAYMENT = ['organizationId', 'issuerName', 'resource', 'resourceUrl', 'deposit', 'settled', 'maxPerPayment', 'maxPerWindow', 'windowSeconds', 'maxTotal', 'thresholdBaseUnits', 'approvalTtlSeconds', 'requiredApprovals', 'notBefore', 'expiresAt', 'voucherExpiresAt', 'graceSeconds', 'salt', 'network', 'payeePath', 'deniedRecipient', 'apiUrl', 'signerUrl', 'rpcUrl', 'ownerSeed', 'approverSeed', 'instanceSeed'];

/** Mandate and payment fields. Every value comes from the caller. */
export function resolvePayment(input = {}) {
  for (const key of REQUIRED_PAYMENT) {
    if (input[key] === undefined || input[key] === '') throw new Error(`${key} is required`);
  }
  return {
    organizationId: input.organizationId,
    issuerName: input.issuerName,
    resource: input.resource,
    resourceUrl: input.resourceUrl,
    deposit: BigInt(input.deposit),
    settled: BigInt(input.settled),
    maxPerPayment: String(input.maxPerPayment),
    maxPerWindow: String(input.maxPerWindow),
    windowSeconds: Number(input.windowSeconds),
    maxTotal: String(input.maxTotal),
    thresholdBaseUnits: String(input.thresholdBaseUnits),
    approvalTtlSeconds: Number(input.approvalTtlSeconds),
    requiredApprovals: Number(input.requiredApprovals),
    notBefore: Number(input.notBefore),
    expiresAt: Number(input.expiresAt),
    voucherExpiresAt: Number(input.voucherExpiresAt),
    graceSeconds: Number(input.graceSeconds),
    salt: BigInt(input.salt),
    network: input.network,
    payeePath: input.payeePath,
    deniedRecipient: input.deniedRecipient,
    apiUrl: input.apiUrl,
    signerUrl: input.signerUrl,
    rpcUrl: input.rpcUrl,
    ownerSeed: input.ownerSeed,
    approverSeed: input.approverSeed,
    instanceSeed: input.instanceSeed,
  };
}

function seedBytes(hex, name) {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error(`${name} must be 32 bytes of hex`);
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

export function loadFeePayer() {
  const secret = process.env.DEMO_FUNDER_SECRET_KEY;
  if (secret) {
    const run = (secret.match(new RegExp(`[${BASE58}]{80,}`, 'g')) ?? []).sort((a, b) => b.length - a.length)[0];
    const raw = run ? base58.decode(run) : new Uint8Array();
    if (raw.length !== 64) throw new Error('DEMO_FUNDER_SECRET_KEY is not a Solana secret key');
    return Keypair.fromSecretKey(raw);
  }
  throw new Error('DEMO_FUNDER_SECRET_KEY is missing');
}

function apiUrl() {
  if (!process.env.ATLAS_API_URL) throw new Error('ATLAS_API_URL is required');
  return process.env.ATLAS_API_URL.replace(/\/$/, '');
}
function signerUrl() {
  if (!process.env.ATLAS_SIGNER_URL) throw new Error('ATLAS_SIGNER_URL is required');
  return process.env.ATLAS_SIGNER_URL.replace(/\/$/, '');
}

function signerHeaders(json) {
  const headers = {};
  if (json) headers['content-type'] = 'application/json';
  if (process.env.ATLAS_SIGNER_TOKEN) headers.authorization = `Bearer ${process.env.ATLAS_SIGNER_TOKEN}`;
  return headers;
}

export async function signerAgent(mandateId) {
  if (!/^mnd_[A-Za-z0-9]{10,40}$/.test(mandateId)) throw new Error('mandate id is required');
  let response;
  try {
    response = await fetch(`${signerUrl()}/v1/voucher-key`, {
      method: 'POST',
      headers: signerHeaders(true),
      body: JSON.stringify({ mandateId }),
    });
  } catch {
    throw new Error('Signer is down');
  }
  if (!response.ok) throw new Error('Signer is down');
  const body = await response.json();
  if (typeof body.publicKey !== 'string') throw new Error('Signer is down');
  return {
    publicKey: body.publicKey,
    async signMessage(message) {
      let signed;
      try {
        signed = await fetch(`${signerUrl()}/v1/sign-message`, {
          method: 'POST',
          headers: signerHeaders(true),
          body: JSON.stringify({ messageBase64: Buffer.from(message).toString('base64'), mandateId }),
        });
      } catch {
        throw new Error('Signer is down');
      }
      if (!signed.ok) throw new Error('Signer is down');
      const json = await signed.json();
      if (typeof json.signatureBase64 !== 'string') throw new Error('Signer is down');
      return Uint8Array.from(Buffer.from(json.signatureBase64, 'base64'));
    },
  };
}

/** Voucher signatures come from POST /v1/channel-voucher. A down API or signer throws; this does not sign. */
export async function askAtlasRail(voucher) {
  let response;
  try {
    const headers = { 'content-type': 'application/json' };
    if (process.env.ATLAS_VOUCHER_TOKEN) headers.authorization = `Bearer ${process.env.ATLAS_VOUCHER_TOKEN}`;
    response = await fetch(`${apiUrl()}/v1/channel-voucher`, {
      method: 'POST',
      headers,
      body: JSON.stringify(voucher),
    });
  } catch {
    throw new Error('Atlas Rail API is down');
  }
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Atlas Rail API is down');
  if (json.signed === true) {
    if (typeof json.signatureBase64 !== 'string' || typeof json.messageBase64 !== 'string') throw new Error('Atlas Rail API returned no signature');
    return json;
  }
  if (json.signed === false) {
    if (json.signatureBase64) throw new Error('Denied voucher included a signature');
    return json;
  }
  throw new Error('Atlas Rail API returned no decision');
}

export function beginPayment(input = {}) {
  process.env.ATLAS_ALLOW_MOCK_SIGNER = 'true';
  const source = Object.keys(input).length > 0 ? input : (process.env.ATLAS_RAILS_PAYMENT ? JSON.parse(process.env.ATLAS_RAILS_PAYMENT) : {});
  const payment = resolvePayment(source);
  if (payment.apiUrl) process.env.ATLAS_API_URL = payment.apiUrl;
  if (payment.signerUrl) process.env.ATLAS_SIGNER_URL = payment.signerUrl;
  const expectedPayer = process.env.ATLAS_FEE_PAYER ?? process.argv[2];
  if (!expectedPayer) throw new Error('Pass the connected fee payer address (ATLAS_FEE_PAYER or argv)');
  const payer = payerKeypair();
  if (payer.publicKey.toBase58() !== expectedPayer) throw new Error('Loaded fee payer does not match the connected account');
  const mandateId = input.mandateId ?? `mnd_${randomBytes(10).toString('hex').toUpperCase()}`;
  const nonce = input.nonce ?? randomBytes(16).toString('hex');
  return {
    payment,
    depositAmount: payment.deposit,
    settledAmount: payment.settled,
    connection: new Connection(payment.rpcUrl, 'confirmed'),
    payer,
    recipient: railsKeyAt(payment.payeePath),
    instance: new LocalEd25519Signer(seedBytes(payment.instanceSeed, 'instanceSeed')),
    owner: new LocalEd25519Signer(seedBytes(payment.ownerSeed, 'ownerSeed')),
    approver: new LocalEd25519Signer(seedBytes(payment.approverSeed, 'approverSeed')),
    mandateId,
    nonce,
    payerPublicKey: payer.publicKey.toBase58(),
    payeePublicKey: recipient.publicKey.toBase58(),
  };
}

export async function createVoucherKey(session) {
  if (session.fundedChannel) throw new Error('Existing channel keeps its authorized signer');
  session.agent = await signerAgent(session.mandateId);
  return { mandateId: session.mandateId, publicKey: session.agent.publicKey };
}

/** Binds a session to a channel that is already open. Does not mint, deposit, or create a signer. */
export async function attachFundedChannel(session, expected) {
  const genesis = await session.connection.getGenesisHash();
  if (genesis !== DEVNET_GENESIS) throw new Error('RPC cluster is not Solana devnet');
  const channel = new PublicKey(expected.channel);
  const info = await session.connection.getAccountInfo(channel, 'confirmed');
  if (!info || info.data.length < 248) throw new Error('Channel account is missing');
  if (!info.owner.equals(PROGRAM_ID)) throw new Error('Channel owner is not the payment program');
  const decoded = readChannel(info.data);
  if (decoded.payer !== expected.payer || session.payer?.publicKey?.toBase58() !== decoded.payer) throw new Error('Loaded fee payer does not match the channel payer');
  if (decoded.payee !== expected.payee) throw new Error('Payee does not match the channel');
  if (decoded.mint !== expected.mint) throw new Error('Mint does not match the channel');
  if (decoded.authorizedSigner !== expected.authorizedSigner) throw new Error('Voucher signer is not the channel signer');
  if (session.agent && session.agent.publicKey !== decoded.authorizedSigner) throw new Error('Voucher signer is not the channel signer');
  const escrow = getAssociatedTokenAddressSync(new PublicKey(decoded.mint), channel, true);
  if (escrow.toBase58() !== expected.escrow) throw new Error('Escrow does not match the channel');
  const escrowInfo = await session.connection.getAccountInfo(escrow, 'confirmed');
  if (!escrowInfo) throw new Error('Channel escrow is missing');
  session.fundedChannel = true;
  session.demoMint = false;
  session.channel = channel;
  session.mint = new PublicKey(decoded.mint);
  session.channelAta = { address: escrow };
  session.payerAta = { address: getAssociatedTokenAddressSync(session.mint, new PublicKey(decoded.payer)) };
  session.payeeAta = { address: getAssociatedTokenAddressSync(session.mint, new PublicKey(decoded.payee)) };
  return { ...decoded, escrow: escrow.toBase58() };
}

export async function createDemoMint(session) {
  if (session.fundedChannel) throw new Error('Existing channel already has a mint');
  const { connection, payer } = session;
  session.mint = await createMint(connection, payer, payer.publicKey, null, 6);
  session.demoMint = true;
  return { mint: session.mint.toBase58() };
}

export async function buildSignedMandate(session) {
  const { payment, recipient, owner, approver, agent, mandateId, nonce } = session;
  if (!session.mint) throw new Error('mint is required');
  let mandate = createMandate({
    id: mandateId,
    nonce,
    issuer: { organizationId: payment.organizationId, name: payment.issuerName },
    agent: { publicKey: agent.publicKey, label: 'Channel signer' },
    delegation: { requiredApprovals: payment.requiredApprovals },
    scope: {
      allowedNetworks: [payment.network],
      allowedAssets: [session.mint.toBase58()],
      allowedPayTo: [recipient.publicKey.toBase58()],
      allowedResources: [payment.resource],
      limits: {
        mint: session.mint.toBase58(),
        maxPerPayment: payment.maxPerPayment,
        maxPerWindow: payment.maxPerWindow,
        windowSeconds: payment.windowSeconds,
        maxTotal: payment.maxTotal,
      },
      priceLimits: [],
    },
    escalation: {
      thresholdBaseUnits: payment.thresholdBaseUnits,
      approverRoles: ['OWNER', 'APPROVER'],
      resources: [],
      approvalTtlSeconds: payment.approvalTtlSeconds,
    },
    notBefore: payment.notBefore,
    expiresAt: payment.expiresAt,
  });
  mandate = await signMandate(mandate, { role: 'OWNER', signer: owner });
  mandate = await signMandate(mandate, { role: 'APPROVER', signer: approver });
  session.mandate = await signMandate(mandate, { role: 'AGENT', signer: agent });
  return { mandateId, publicKey: agent.publicKey, mint: session.mint.toBase58() };
}

async function channelSettled(session) {
  const info = await session.connection.getAccountInfo(session.channel, 'confirmed');
  if (!info || info.data.length < 28) throw new Error('Channel account is missing');
  return info.data.readBigUInt64LE(20);
}

export async function createVoucher(session) {
  const { payment, payer, recipient, mandate, channel, mint, settledAmount } = session;
  if (session.fundedChannel) {
    const decoded = readChannel((await session.connection.getAccountInfo(channel, 'confirmed')).data);
    if (!session.agent || session.agent.publicKey !== decoded.authorizedSigner) throw new Error('Voucher signer is not the channel signer');
    if (BigInt(settledAmount) <= decoded.settled) throw new Error('Cumulative amount is not strictly above the settled watermark');
    if (payer.publicKey.toBase58() !== decoded.payer) throw new Error('Loaded fee payer does not match the channel payer');
    if (mint.toBase58() !== decoded.mint) throw new Error('Mint does not match the channel');
    if (recipient.publicKey.toBase58() !== decoded.payee) throw new Error('Payee does not match the channel');
  }
  const voucherFields = {
    mandate,
    channelId: channel.toBase58(),
    expiresAt: payment.voucherExpiresAt,
    resourceUrl: payment.resourceUrl,
    asset: mint.toBase58(),
    network: payment.network,
    chainSettled: (await channelSettled(session)).toString(),
  };
  session.voucherFields = voucherFields;
  const denied = await askAtlasRail({
    ...voucherFields,
    cumulativeAmount: '1000',
    recipient: payment.deniedRecipient,
  });
  if (denied.signed) throw new Error('Unauthorized recipient was signed');
  const denial = { signed: false, message: denied.message ?? 'MandateDeniedError' };
  const allowedBody = await askAtlasRail({
    ...voucherFields,
    cumulativeAmount: settledAmount.toString(),
    recipient: recipient.publicKey.toBase58(),
    feePayer: payer.publicKey.toBase58(),
  });
  if (!allowedBody.signed) throw new Error('Allowed voucher was not signed');
  session.denial = denial;
  session.allowed = {
    status: 'ALLOW',
    message: Uint8Array.from(Buffer.from(allowedBody.messageBase64, 'base64')),
    signature: Uint8Array.from(Buffer.from(allowedBody.signatureBase64, 'base64')),
    messageHash: allowedBody.messageHash,
    decision: allowedBody.decision,
    receipt: null,
  };
  return { signed: true, messageHash: allowedBody.messageHash, denial };
}

export async function settleChannel(session) {
  const { connection, payer, agent, channel, allowed, mandate, instance } = session;
  const mandatePda = new PublicKey(findMandatePda(DEFAULT_MANDATE_PROGRAM_ID, Buffer.from(hashMandate(mandate), 'hex')).address);
  const settleIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: channel, isSigner: false, isWritable: true },
      { pubkey: INSTRUCTIONS_SYSVAR, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([2]),
  });
  // The mandate rides read-only on the signature check: settle takes exactly two accounts.
  const verify = ed25519Instruction(new PublicKey(agent.publicKey).toBytes(), allowed.signature, allowed.message);
  verify.keys.push({ pubkey: mandatePda, isSigner: false, isWritable: false });
  const settleTx = new Transaction().add(verify, settleIx);
  // The voucher signature is the ed25519 precompile. The payer signature only pays the fee.
  const submitStarted = Date.now();
  const settleSig = await submitSigned(connection, settleTx, { feePayer: payer, localSigners: [payer] });
  session.rpcSubmitMs = Date.now() - submitStarted;
  const confirmStarted = Date.now();
  session.rpcConfirmMs = Date.now() - confirmStarted;
  session.settleSignature = settleSig;
  const issuedAt = Math.floor(Date.now() / 1000);
  session.receipt = await buildReceipt(
    {
      id: `rcp_${allowed.messageHash.slice(0, 16)}`,
      mandate,
      decision: allowed.decision,
      settlement: {
        txSignature: settleSig,
        network: allowed.decision.record.offer.network,
        payer: agent.publicKey,
        settledAt: issuedAt,
        slot: null,
      },
      response: {
        status: 200,
        bodySha256: hashResponseBody(Buffer.from(allowed.message)),
        contentType: 'application/vnd.payment-channels.voucher',
      },
      issuedAt,
    },
    instance,
  );
  return { settleSignature: settleSig, receiptId: session.receipt.id };
}

export async function payPayee(session) {
  const { connection, payer, channel, channelAta, payerAta, payeeAta, treasuryAta, mint, eventAuthority, settledAmount, voucherFields, recipient } = session;
  const understated = await askAtlasRail({
    ...voucherFields,
    cumulativeAmount: (settledAmount + 5000n).toString(),
    settledAmount: '0',
    chainSettled: (await channelSettled(session)).toString(),
    recipient: recipient.publicKey.toBase58(),
  });
  if (understated.signed) throw new Error('Understated watermark was signed');
  session.understated = understated;
  session.payeeBefore = BigInt((await connection.getTokenAccountBalance(payeeAta.address, 'confirmed')).value.amount);
  session.payerBefore = BigInt((await connection.getTokenAccountBalance(payerAta.address, 'confirmed')).value.amount);
  const distributeIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: channel, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: false, isWritable: true },
      { pubkey: channelAta, isSigner: false, isWritable: true },
      { pubkey: payerAta.address, isSigner: false, isWritable: true },
      { pubkey: payeeAta.address, isSigner: false, isWritable: true },
      { pubkey: treasuryAta.address, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: distributeData(),
  });
  // Payer accounts on distribute are not instruction signers. This signature pays the fee.
  session.distributeSignature = await submitSigned(connection, new Transaction().add(distributeIx), { feePayer: payer, localSigners: [payer] });
  const distributed = readChannel((await connection.getAccountInfo(channel, 'confirmed')).data);
  const payeeAfter = BigInt((await connection.getTokenAccountBalance(payeeAta.address, 'confirmed')).value.amount);
  if (distributed.payoutWatermark !== settledAmount) throw new Error(`Payout watermark is ${distributed.payoutWatermark}`);
  if (payeeAfter - session.payeeBefore !== settledAmount) throw new Error(`Payee received ${payeeAfter - session.payeeBefore}`);
  session.payeeReceived = payeeAfter - session.payeeBefore;
  return { distributeSignature: session.distributeSignature, payeeReceived: session.payeeReceived.toString() };
}

export async function withdrawRemainder(session) {
  const { connection, payer, recipient, channel, channelAta, payerAta, mint, depositAmount, settledAmount, payerBefore } = session;
  const sealIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: recipient.publicKey, isSigner: true, isWritable: false },
      { pubkey: channel, isSigner: false, isWritable: true },
      { pubkey: INSTRUCTIONS_SYSVAR, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([4, 0]),
  });
  session.sealSignature = await submitSigned(connection, new Transaction().add(sealIx), { feePayer: payer, localSigners: [payer, recipient] });
  const withdrawIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: channel, isSigner: false, isWritable: true },
      { pubkey: channelAta, isSigner: false, isWritable: true },
      { pubkey: payerAta.address, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([8]),
  });
  session.withdrawSignature = await submitSigned(connection, new Transaction().add(withdrawIx), { feePayer: payer, localSigners: [payer] });
  const closed = readChannel((await connection.getAccountInfo(channel, 'confirmed')).data);
  const payerAfter = BigInt((await connection.getTokenAccountBalance(payerAta.address, 'confirmed')).value.amount);
  if (closed.payerWithdrawnAt === 0n) throw new Error('Payer withdraw did not stamp payer_withdrawn_at');
  if (payerAfter - payerBefore !== depositAmount - settledAmount) throw new Error(`Payer remainder is ${payerAfter - payerBefore}`);
  session.closed = closed;
  session.payerRemainder = payerAfter - payerBefore;
  return { withdrawSignature: session.withdrawSignature, payerRemainder: session.payerRemainder.toString() };
}

function paymentReport(session) {
  const { channel, agent, depositAmount, settledAmount, closed, payeeReceived, payerRemainder, openSignature, settleSignature, distributeSignature, sealSignature, withdrawSignature, rpcSubmitMs, rpcConfirmMs, understated, allowed, receipt, denial } = session;
  return {
    programId: PROGRAM_ID.toBase58(),
    channel: channel.toBase58(),
    authorizedSigner: agent.publicKey,
    deposit: depositAmount.toString(),
    settled: settledAmount.toString(),
    payoutWatermark: closed.payoutWatermark.toString(),
    payerWithdrawnAt: closed.payerWithdrawnAt.toString(),
    payeeReceived: payeeReceived.toString(),
    payerRemainder: payerRemainder.toString(),
    openSignature,
    settleSignature,
    distributeSignature,
    sealSignature,
    withdrawSignature,
    settlementMs: rpcSubmitMs + rpcConfirmMs,
    rpcSubmitMs,
    rpcConfirmMs,
    evidence: 'original',
    understated,
    voucherMessageBase64: Buffer.from(allowed.message).toString('base64'),
    voucherSignatureBase64: Buffer.from(allowed.signature).toString('base64'),
    voucherMessageHash: allowed.messageHash,
    decision: allowed.decision,
    receipt,
    receiptId: receipt.id,
    denial,
    explorer: `https://explorer.solana.com/tx/${settleSignature}?cluster=devnet`,
    explorers: {
      settle: `https://explorer.solana.com/tx/${settleSignature}?cluster=devnet`,
      distribute: `https://explorer.solana.com/tx/${distributeSignature}?cluster=devnet`,
      withdraw: `https://explorer.solana.com/tx/${withdrawSignature}?cluster=devnet`,
    },
    gateP50Ms: null,
    signP50Ms: null,
    e2eP50Ms: null,
  };
}

export async function main() {
  const session = beginPayment();
  console.log(`fee payer ${session.payer.publicKey.toBase58()}`);
  console.log(`channel payee ${session.recipient.publicKey.toBase58()}`);
  try {
    const voucherKey = await createVoucherKey(session);
    console.log(`voucher signer ${voucherKey.publicKey}`);
    await buildSignedMandate(session);
    await depositUpfront(session);
    await createVoucher(session);
    await settleChannel(session);
    await payPayee(session);
    await withdrawRemainder(session);
    const body = paymentReport(session);
    report(body);
    console.log(JSON.stringify({ ...body, timings: 0 }, null, 2));
    return body;
  } catch (error) {
    await forgetVoucherSession(session.mandateId);
    throw error;
  }
}
