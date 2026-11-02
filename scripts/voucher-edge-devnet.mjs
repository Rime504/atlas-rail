/**
 * Live v2 voucher edge cases against POST /v1/channel-voucher and devnet.
 * The script asks Atlas Rail for every voucher. It does not sign voucher bytes.
 * It does not print keys or env. Anchor owner/instance already hold SOL, so this does not fund 0.1 SOL.
 *
 * Run from the repo root: node scripts/voucher-edge-devnet.mjs
 */
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { serviceEnv } from './launch-voucher-services.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
Object.assign(process.env, serviceEnv());
const requireX402 = createRequire(join(root, 'packages/x402-client/package.json'));
const requireSolana = createRequire(join(root, 'packages/solana/package.json'));
const requireReceipt = createRequire(join(root, 'packages/receipt/package.json'));
const { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction, sendAndConfirmTransaction } = requireSolana('@solana/web3.js');
const { createMint, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount, mintTo } = requireSolana('@solana/spl-token');
const { createMandate, signMandate, SOLANA_DEVNET_CAIP2, fromBase58, toBase58, hashMandate, LocalEd25519Signer } = requireX402('@atlas-rail/mandate');
const { DevnetKeyring, Web3ChainClient, buildCreateMandateTransaction, fetchMandateAccount, findMandatePda, findRootPda, decodeRootAccount } = requireSolana('@atlas-rail/solana');
const { buildReceipt, hashResponseBody, AnchorService, InMemoryReceiptStore } = requireReceipt('@atlas-rail/receipt');
const { treasuryOwnerFromElf, deployedProgramElf, loadFeePayer } = await import('./channel-voucher-devnet.mjs');

const PROGRAM_ID = new PublicKey('CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX');
const MANDATE_PROGRAM = 'CnGoTE5Bxc8MFGaeK5LDv5uAZ7pNiktMunYy8JZcLY4k';
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SYSTEM_PROGRAM_ID = new PublicKey('11111111111111111111111111111111');
const RENT_SYSVAR = new PublicKey('SysvarRent111111111111111111111111111111111');
const ED25519_PROGRAM_ID = new PublicKey('Ed25519SigVerify111111111111111111111111111');
const INSTRUCTIONS_SYSVAR = new PublicKey('Sysvar1nstructions1111111111111111111111111');
const RPC = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const FLOOR = 200_000_000n;
const CHANNEL_BUDGET = 40_000_000n;
const RESOURCE = 'http://localhost:4402/research/summary';
const REPORT_JSON = join(root, 'reports', 'voucher-edge-devnet-2026-10-17.json');
const REPORT_MD = join(root, 'reports', 'voucher-edge-devnet-2026-10-17.md');

const cases = [];
const nowSec = () => Math.floor(Date.now() / 1000);
function apiUrl() {
  return (process.env.ATLAS_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
}
function signerHeaders(json) {
  const headers = {};
  if (json) headers['content-type'] = 'application/json';
  if (process.env.ATLAS_SIGNER_TOKEN) headers.authorization = `Bearer ${process.env.ATLAS_SIGNER_TOKEN}`;
  return headers;
}
function seed(label) {
  const out = new Uint8Array(32);
  new TextEncoder().encode(label).forEach((byte, index) => {
    out[index] = byte;
  });
  return out;
}
function explorer(signature) {
  return signature ? `https://explorer.solana.com/tx/${signature}?cluster=devnet` : null;
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function scratch() {
  return Keypair.generate().publicKey.toBase58();
}
function flush(extra = {}) {
  mkdirSync(dirname(REPORT_JSON), { recursive: true });
  const landed = [...new Map(cases.flatMap((row) => row.transactions ?? []).filter((tx) => tx.signature).map((tx) => [tx.signature, tx])).values()];
  const body = {
    ...extra,
    generatedAt: new Date().toISOString(),
    programId: PROGRAM_ID.toBase58(),
    mandateProgramId: MANDATE_PROGRAM,
    path: 'POST /v1/channel-voucher -> gate -> signer :3012 -> payment-channels settle -> anchor_root',
    counts: {
      cases: cases.length,
      pass: cases.filter((row) => row.pass === true).length,
      fail: cases.filter((row) => row.pass === false).length,
      notRun: cases.filter((row) => row.skipped).length,
      devnetTxSubmitted: landed.length,
    },
    cases,
  };
  writeFileSync(REPORT_JSON, JSON.stringify(body, null, 2));
  return body;
}

function record(row) {
  cases.push(row);
  flush();
  const mark = row.skipped ? 'SKIP' : row.pass ? 'PASS' : 'FAIL';
  console.log(`${row.id} ${mark} ${row.name}`);
}

async function postChannel(body, raw) {
  const response = await fetch(`${apiUrl()}/v1/channel-voucher`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(process.env.ATLAS_VOUCHER_TOKEN ? { authorization: `Bearer ${process.env.ATLAS_VOUCHER_TOKEN}` } : {}),
    },
    body: raw !== undefined ? raw : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { unparsed: text.slice(0, 180) };
  }
  return { status: response.status, json };
}

function hasSignature(json) {
  return typeof json?.signatureBase64 === 'string' && json.signatureBase64.length > 0;
}

function describeHttp(http) {
  const json = http.json ?? {};
  const bits = [`HTTP ${http.status}`, `signed ${json.signed === true}`];
  if (typeof json.message === 'string') bits.push(json.message);
  if (typeof json.error === 'string') bits.push(json.error.slice(0, 180));
  const scheme = json.decision?.record?.offer?.scheme;
  if (scheme) bits.push(`scheme ${scheme}`);
  return bits.join(' | ');
}

function judgeHttp(id, name, expected, http, rule) {
  const json = http.json ?? {};
  const signed = json.signed === true;
  const problems = [];
  if (rule.signed !== undefined && signed !== rule.signed) problems.push(`signed was ${signed}`);
  if (rule.signed === false && hasSignature(json)) problems.push('response included a signature');
  if (rule.signed === true && !hasSignature(json)) problems.push('allow had no signature');
  if (rule.status !== undefined && http.status !== rule.status) problems.push(`status ${http.status}`);
  if (rule.includes) {
    const blob = JSON.stringify(json);
    for (const part of rule.includes) if (!blob.includes(part)) problems.push(`body missing ${part}`);
  }
  if (rule.scheme && json.decision?.record?.offer?.scheme !== rule.scheme) problems.push(`offer scheme ${json.decision?.record?.offer?.scheme ?? 'missing'}`);
  const pass = problems.length === 0;
  record({
    id,
    name,
    expected,
    actual: pass ? describeHttp(http) : `${describeHttp(http)} (${problems.join('; ')})`,
    pass,
    signed,
    skipped: false,
    channel: null,
    amounts: null,
    transactions: [],
  });
  return json;
}

function tamper(mandate, role) {
  const copy = structuredClone(mandate);
  const link = copy.delegationChain.find((item) => item.role === role);
  const bytes = Uint8Array.from(fromBase58(link.signature));
  bytes[0] ^= 0xff;
  link.signature = toBase58(bytes);
  return copy;
}

function dropRole(mandate, role) {
  const copy = structuredClone(mandate);
  copy.delegationChain = copy.delegationChain.filter((item) => item.role !== role);
  return copy;
}

function listenerPid(port) {
  const out = execFileSync(
    'powershell',
    ['-NoProfile', '-Command', `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess)`],
    { encoding: 'utf8' },
  ).trim();
  return out ? Number(out) : null;
}

function ed25519Instruction(pubkey, signature, message) {
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

function openData(salt, deposit, grace, openSlot) {
  const data = Buffer.alloc(1 + 8 + 8 + 4 + 8 + 4);
  let offset = 0;
  data.writeUInt8(1, offset);
  offset += 1;
  data.writeBigUInt64LE(salt, offset);
  offset += 8;
  data.writeBigUInt64LE(deposit, offset);
  offset += 8;
  data.writeUInt32LE(grace, offset);
  offset += 4;
  data.writeBigUInt64LE(openSlot, offset);
  offset += 8;
  data.writeUInt32LE(0, offset);
  return data;
}

async function landed(connection, signature) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const tx = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    if (tx) return { signature, slot: tx.slot, err: tx.meta?.err ?? null, explorer: explorer(signature) };
    await sleep(400);
  }
  return { signature, slot: null, err: 'unconfirmed', explorer: explorer(signature) };
}

async function main() {
  const connection = new Connection(RPC, 'confirmed');
  const payer = loadFeePayer();
  if (payer.publicKey.toBase58() !== '2Qy24Ut2fDfj1SXBQbzBpvEEX8QZcStcZng6M3ravpsb') throw new Error('Fee payer is not the connected devnet account');
  const balanceBefore = BigInt(await connection.getBalance(payer.publicKey, 'confirmed'));
  console.log(`fee payer ${payer.publicKey.toBase58()} lamports ${balanceBefore}`);
  const keyResponse = await fetch('http://127.0.0.1:3012/v1/public-key', { headers: signerHeaders(false) });
  if (!keyResponse.ok) throw new Error('Signer is down');
  const agentKey = (await keyResponse.json()).publicKey;
  const health = await fetch(`${apiUrl()}/health/live`);
  if (!health.ok) throw new Error('Atlas Rail API is down');

  const ownerSigner = new LocalEd25519Signer(seed('channel-owner'));
  const approverSigner = new LocalEd25519Signer(seed('channel-approver'));
  const owner = Keypair.fromSeed(seed('channel-owner'));
  const approver = Keypair.fromSeed(seed('channel-approver'));
  const keyring = DevnetKeyring.load();
  const instance = keyring.signer('instance');
  const agentWallet = Keypair.fromSecretKey(keyring.signer('agent').exportSecretKey());
  if (agentWallet.publicKey.toBase58() !== agentKey) throw new Error('Signer public key is not the keyring agent');
  if (owner.publicKey.toBase58() !== ownerSigner.publicKey) throw new Error('Owner key mismatch');

  const agent = {
    publicKey: agentKey,
    async signMessage(message) {
      const signed = await fetch('http://127.0.0.1:3012/v1/sign-message', {
        method: 'POST',
        headers: signerHeaders(true),
        body: JSON.stringify({ messageBase64: Buffer.from(message).toString('base64') }),
      });
      if (!signed.ok) throw new Error('Agent mandate acceptance was refused');
      const json = await signed.json();
      return Uint8Array.from(Buffer.from(json.signatureBase64, 'base64'));
    },
  };

  const payeeA = Keypair.generate();
  const payeeB = Keypair.generate();
  const stranger = Keypair.generate();
  const mint = await createMint(connection, payer, payer.publicKey, null, 6);
  const payerAta = await getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey);
  await mintTo(connection, payer, mint, payerAta.address, payer, 1_000_000n);
  const mintAddress = mint.toBase58();
  const openedAt = nowSec();

  async function mandateOf({ id, payTo, limits, escalation, notBefore, expiresAt, priceLimits = [] }) {
    let mandate = createMandate({
      id,
      nonce: randomBytes(16).toString('hex'),
      issuer: { organizationId: 'org_channel', name: 'Channel prototype' },
      agent: { publicKey: agent.publicKey, label: 'Channel signer' },
      delegation: { requiredApprovals: 1 },
      scope: {
        allowedNetworks: [SOLANA_DEVNET_CAIP2],
        allowedAssets: [mintAddress],
        allowedPayTo: payTo,
        allowedResources: ['http://localhost:4402/research/*'],
        limits: { mint: mintAddress, ...limits },
        priceLimits,
      },
      escalation,
      notBefore,
      expiresAt,
    });
    mandate = await signMandate(mandate, { role: 'OWNER', signer: ownerSigner });
    mandate = await signMandate(mandate, { role: 'APPROVER', signer: approverSigner });
    mandate = await signMandate(mandate, { role: 'AGENT', signer: agent });
    return mandate;
  }

  const payTo = [payeeA.publicKey.toBase58(), payeeB.publicKey.toBase58(), payer.publicKey.toBase58()];
  const wide = { maxPerPayment: '20000', maxPerWindow: '100000', windowSeconds: 86400, maxTotal: '100000' };
  const noEscalate = { thresholdBaseUnits: '20000', approverRoles: ['OWNER', 'APPROVER'], resources: [], approvalTtlSeconds: 900 };
  const payMandate = await mandateOf({
    id: 'mnd_EDGEPAY000000000001',
    payTo,
    limits: wide,
    escalation: noEscalate,
    notBefore: openedAt - 60,
    expiresAt: openedAt + 7200,
  });
  const capMandate = await mandateOf({
    id: 'mnd_EDGECAP000000000001',
    payTo,
    limits: { maxPerPayment: '1000', maxPerWindow: '100000', windowSeconds: 86400, maxTotal: '100000' },
    escalation: { thresholdBaseUnits: '1000', approverRoles: ['OWNER', 'APPROVER'], resources: [], approvalTtlSeconds: 900 },
    notBefore: openedAt - 60,
    expiresAt: openedAt + 7200,
  });
  const lifeMandate = await mandateOf({
    id: 'mnd_EDGELIF000000000001',
    payTo,
    limits: { maxPerPayment: '1000', maxPerWindow: '1000', windowSeconds: 86400, maxTotal: '1000' },
    escalation: { thresholdBaseUnits: '1000', approverRoles: ['OWNER', 'APPROVER'], resources: [], approvalTtlSeconds: 900 },
    notBefore: openedAt - 60,
    expiresAt: openedAt + 7200,
  });
  const windowMandate = await mandateOf({
    id: 'mnd_EDGEWIN000000000001',
    payTo,
    limits: { maxPerPayment: '100000', maxPerWindow: '100', windowSeconds: 86400, maxTotal: '100000' },
    escalation: noEscalate,
    notBefore: openedAt - 60,
    expiresAt: openedAt + 7200,
  });
  const thresholdMandate = await mandateOf({
    id: 'mnd_EDGETHR000000000001',
    payTo,
    limits: { maxPerPayment: '1000', maxPerWindow: '100000', windowSeconds: 86400, maxTotal: '100000' },
    escalation: { thresholdBaseUnits: '100', approverRoles: ['OWNER', 'APPROVER'], resources: [], approvalTtlSeconds: 900 },
    notBefore: openedAt - 60,
    expiresAt: openedAt + 7200,
  });
  const expiredMandate = await mandateOf({
    id: 'mnd_EDGEEXP000000000001',
    payTo,
    limits: wide,
    escalation: noEscalate,
    notBefore: openedAt - 7200,
    expiresAt: openedAt - 30,
  });
  const futureMandate = await mandateOf({
    id: 'mnd_EDGEFUT000000000001',
    payTo,
    limits: wide,
    escalation: noEscalate,
    notBefore: openedAt + 3600,
    expiresAt: openedAt + 7200,
  });
  const priceMandate = await mandateOf({
    id: 'mnd_EDGEPRC000000000001',
    payTo,
    limits: { maxPerPayment: '10000', maxPerWindow: '10000', windowSeconds: 86400, maxTotal: '10000' },
    escalation: { thresholdBaseUnits: '10000', approverRoles: ['OWNER', 'APPROVER'], resources: [], approvalTtlSeconds: 900 },
    notBefore: openedAt - 60,
    expiresAt: openedAt + 7200,
    priceLimits: [{ resource: 'http://localhost:4402/research/*', expectedPriceBaseUnits: '100', tolerancePct: 0, hardMaxBaseUnits: '150' }],
  });

  function fields(mandate, extra = {}) {
    return {
      mandate,
      channelId: scratch(),
      cumulativeAmount: '1000',
      chainSettled: '0',
      expiresAt: nowSec() + 300,
      recipient: payeeA.publicKey.toBase58(),
      resourceUrl: RESOURCE,
      asset: mintAddress,
      network: SOLANA_DEVNET_CAIP2,
      feePayer: payer.publicKey.toBase58(),
      ...extra,
    };
  }

  async function httpCase(id, name, expected, body, rule, raw) {
    try {
      const http = await postChannel(body, raw);
      return judgeHttp(id, name, expected, http, rule);
    } catch (error) {
      record({
        id,
        name,
        expected,
        actual: error instanceof Error ? error.message : String(error),
        pass: false,
        signed: false,
        skipped: false,
        channel: null,
        amounts: null,
        transactions: [],
      });
      return null;
    }
  }

  const base = () => fields(payMandate);
  await httpCase('e01', 'empty body', 'HTTP 400, no signature, no settle', undefined, { signed: false, status: 400 }, '');
  await httpCase('e02', 'empty object', 'HTTP 400 Invalid voucher request, no signature', {}, { signed: false, status: 400, includes: ['Invalid voucher request'] });
  await httpCase('e03', 'malformed json', 'HTTP 400, no signature', undefined, { signed: false, status: 400 }, '{');
  await httpCase('e04', 'missing mandate', 'HTTP 400, no signature', { ...base(), mandate: undefined }, { signed: false, status: 400 });
  await httpCase('e05', 'missing resource, so no offer can be built', 'HTTP 400, no signature', (() => { const body = base(); delete body.resourceUrl; return body; })(), { signed: false, status: 400 });
  await httpCase('e06', 'missing asset', 'HTTP 400, no signature', (() => { const body = base(); delete body.asset; return body; })(), { signed: false, status: 400 });
  await httpCase('e07', 'missing recipient', 'HTTP 400, no signature', (() => { const body = base(); delete body.recipient; return body; })(), { signed: false, status: 400 });
  await httpCase('e08', 'negative amount', 'HTTP 400, no signature', fields(payMandate, { cumulativeAmount: '-5' }), { signed: false, status: 400 });
  await httpCase('e09', 'fractional amount', 'HTTP 400, no signature', fields(payMandate, { cumulativeAmount: '1.5' }), { signed: false, status: 400 });
  await httpCase('e10', 'leading-zero amount', 'HTTP 400, no signature', fields(payMandate, { cumulativeAmount: '0001' }), { signed: false, status: 400 });
  await httpCase('e11', 'amount 0', 'signed false, no settle', fields(payMandate, { cumulativeAmount: '0' }), { signed: false, includes: ['UnsupportedPaymentError'] });
  await httpCase('e12', 'amount above u64', 'signed false, no settle', fields(payMandate, { cumulativeAmount: '18446744073709551616' }), { signed: false, includes: ['UnsupportedPaymentError'] });
  await httpCase('e13', 'u64 max cumulative against a small cap', 'signed false MandateDeniedError, no settle', fields(capMandate, { cumulativeAmount: '18446744073709551615' }), { signed: false, includes: ['MandateDeniedError'] });
  await httpCase('e14', 'random disallowed payee', 'signed false MandateDeniedError, no settle', fields(payMandate, { recipient: stranger.publicKey.toBase58() }), { signed: false, includes: ['MandateDeniedError'] });
  await httpCase('e15', 'wrong network', 'signed false MandateDeniedError, no settle', fields(payMandate, { network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' }), { signed: false, includes: ['MandateDeniedError'] });
  await httpCase('e16', 'network alias solana-devnet', 'signed false, no settle', fields(payMandate, { network: 'solana-devnet' }), { signed: false, includes: ['MandateDeniedError'] });
  await httpCase('e17', 'wrong asset', 'signed false MandateDeniedError, no settle', fields(payMandate, { asset: stranger.publicKey.toBase58() }), { signed: false, includes: ['MandateDeniedError'] });
  await httpCase('e18', 'wrong resource', 'signed false MandateDeniedError, no settle', fields(payMandate, { resourceUrl: 'http://localhost:4402/admin/drain' }), { signed: false, includes: ['MandateDeniedError'] });
  await httpCase('e19', 'query string on an allowed resource is still allowed', 'signed true, query ignored, no settle', fields(payMandate, { resourceUrl: `${RESOURCE}?user=1` }), { signed: true });
  await httpCase('e20', 'resource is not a url', 'signed false, no settle', fields(payMandate, { resourceUrl: 'not a url' }), { signed: false, includes: ['MandateDeniedError'] });
  await httpCase('e21', 'https resource when the mandate allows http', 'signed false, no settle', fields(payMandate, { resourceUrl: 'https://localhost:4402/research/summary' }), { signed: false, includes: ['MandateDeniedError'] });
  await httpCase('e22', 'expired mandate', 'signed false MandateDeniedError, no settle', fields(expiredMandate), { signed: false, includes: ['MandateDeniedError'] });
  await httpCase('e23', 'mandate not yet valid', 'signed false MandateDeniedError, no settle', fields(futureMandate), { signed: false, includes: ['MandateDeniedError'] });
  await httpCase('e24', 'voucher expiry already passed', 'signed false, no settle', fields(payMandate, { expiresAt: nowSec() - 30 }), { signed: false, includes: ['UnsupportedPaymentError'] });
  await httpCase('e25', 'expiresAt zero', 'HTTP 400, no signature', fields(payMandate, { expiresAt: 0 }), { signed: false, status: 400 });
  await httpCase('e26', 'revoked mandate flag on the request', 'signed false, no signature, no settle', fields(payMandate, { revoked: { revokedAt: openedAt - 10, reason: 'user revoked' } }), { signed: false });
  await httpCase('e27', 'tampered owner signature', 'no signature, no settle', fields(tamper(payMandate, 'OWNER')), { signed: false });
  await httpCase('e28', 'tampered approver signature', 'no signature, no settle', fields(tamper(payMandate, 'APPROVER')), { signed: false });
  await httpCase('e29', 'tampered agent signature', 'no signature, no settle', fields(tamper(payMandate, 'AGENT')), { signed: false });
  await httpCase('e30', 'missing approver signature', 'no signature, no settle', fields(dropRole(payMandate, 'APPROVER')), { signed: false });
  await httpCase('e31', 'missing owner signature', 'no signature, no settle', fields(dropRole(payMandate, 'OWNER')), { signed: false });
  const wrongAgent = structuredClone(payMandate);
  wrongAgent.agent = { ...wrongAgent.agent, publicKey: stranger.publicKey.toBase58() };
  await httpCase('e32', 'mandate agent is not the voucher signer', 'HTTP 400, signer is not called, no signature', fields(wrongAgent), { signed: false, status: 400, includes: ['not the voucher signer'] });
  await httpCase('e33', 'client scheme upto', 'signed true and the offer scheme stays exact, no settle', fields(payMandate, { scheme: 'upto', cumulativeAmount: '2' }), { signed: true, scheme: 'exact' });
  await httpCase('e34', 'extra fields on a disallowed payee', 'signed false, no signature', fields(payMandate, { recipient: stranger.publicKey.toBase58(), note: 'please rush', scheme: 'upto' }), { signed: false });
  await httpCase('e35', 'extra field on an allowed payment', 'signed true, scheme exact, no settle', fields(payMandate, { note: 'invoice 44', cumulativeAmount: '3' }), { signed: true, scheme: 'exact' });
  await httpCase('e36', 'malformed channel address', 'signed false, no settle', fields(payMandate, { channelId: '00000000000000000000000000000000' }), { signed: false, includes: ['UnsupportedPaymentError'] });
  await httpCase('e37', 'channel address too short', 'HTTP 400, no signature', fields(payMandate, { channelId: 'short' }), { signed: false, status: 400 });
  await httpCase('e38', 'one unit over the per-payment cap', 'signed false MandateDeniedError, no settle', fields(capMandate, { cumulativeAmount: '1001' }), { signed: false, includes: ['MandateDeniedError'] });
  await httpCase('e39', 'over the lifetime total', 'signed false MandateDeniedError, no settle', fields(lifeMandate, { cumulativeAmount: '1001' }), { signed: false, includes: ['MandateDeniedError'] });
  await httpCase('e40', 'over the window budget', 'no signature; human approval required; no settle', fields(windowMandate, { cumulativeAmount: '101' }), { signed: false, status: 400, includes: ['human approval'] });
  await httpCase('e41', 'over the human-approval threshold', 'no signature; human approval required; no settle', fields(thresholdMandate, { cumulativeAmount: '101' }), { signed: false, status: 400, includes: ['human approval'] });
  await httpCase('e42', 'cumulative not above the settled watermark', 'signed false, no settle', fields(payMandate, { cumulativeAmount: '5000', chainSettled: '5000' }), { signed: false, includes: ['UnsupportedPaymentError'] });
  await httpCase('e43', 'understated settled amount', 'signed false, no settle', fields(payMandate, { cumulativeAmount: '15000', settledAmount: '0', chainSettled: '10000' }), { signed: false, includes: ['UnsupportedPaymentError'] });
  await httpCase('e44', 'replay of a cumulative already at the watermark', 'signed false, no settle', fields(payMandate, { cumulativeAmount: '10000', chainSettled: '10000' }), { signed: false, includes: ['UnsupportedPaymentError'] });
  // shortcut: channel left open by the 2026-10-17 run, so this ask can read the payer without opening another
  const existingChannel = 'B9hBrPXPX9y6Q63AahHfEMkAiJyqqKU4nQV7YCcvRyTq';
  await httpCase('e45', 'fee payer is not the channel payer', 'signed false, no signature, no settle', fields(payMandate, { feePayer: stranger.publicKey.toBase58(), cumulativeAmount: '4', channelId: existingChannel }), { signed: false });
  await httpCase('e46', 'fee payer is not an address', 'HTTP 400, no signature', fields(payMandate, { feePayer: 'not-a-key' }), { signed: false, status: 400 });
  await httpCase('e47', 'price above the hard maximum', 'signed false MandateDeniedError, no settle', fields(priceMandate, { cumulativeAmount: '200' }), { signed: false, includes: ['MandateDeniedError'] });
  await httpCase('e48', 'amount exactly the cap is still a gate allow before settlement', 'signed true, scheme exact, settlement is the later devnet case', fields(capMandate, { cumulativeAmount: '1000' }), { signed: true, scheme: 'exact' });

  const signerBad = await fetch('http://127.0.0.1:3012/v1/sign-voucher', {
    method: 'POST',
    headers: signerHeaders(true),
    body: JSON.stringify({ messageBase64: Buffer.from([1, 2, 3]).toString('base64'), authorization: null, decision: null, mandate: null }),
  });
  const signerBadJson = await signerBad.json().catch(() => ({}));
  const signerBadHasSig = hasSignature(signerBadJson);
  record({
    id: 'e49',
    name: 'malformed voucher bytes presented to the signer',
    expected: 'signer refuses, no signature',
    actual: `HTTP ${signerBad.status} | ${JSON.stringify(signerBadJson).slice(0, 180)}`,
    pass: signerBad.status === 403 && !signerBadHasSig,
    signed: false,
    skipped: false,
    channel: null,
    amounts: null,
    transactions: [],
  });
  const signerAuth = await fetch('http://127.0.0.1:3012/v1/sign-voucher', {
    method: 'POST',
    headers: signerHeaders(true),
    body: JSON.stringify({
      messageBase64: Buffer.alloc(50, 7).toString('base64'),
      authorization: { type: 'atlasrail.gate-authorization', version: '0.1' },
      decision: null,
      mandate: null,
    }),
  });
  const signerAuthJson = await signerAuth.json().catch(() => ({}));
  record({
    id: 'e50',
    name: 'signer presented a voucher without a valid gate authorization',
    expected: 'signer refuses, no signature',
    actual: `HTTP ${signerAuth.status} | ${JSON.stringify(signerAuthJson).slice(0, 180)}`,
    pass: signerAuth.status === 403 && !hasSignature(signerAuthJson),
    signed: false,
    skipped: false,
    channel: null,
    amounts: null,
    transactions: [],
  });

  const downBody = fields(payMandate, { cumulativeAmount: '5' });
  let signerPid = null;
  try {
    signerPid = listenerPid(3012);
    if (signerPid) process.kill(signerPid);
    await sleep(500);
    const down = await postChannel(downBody);
    const downSigned = down.json?.signed === true || hasSignature(down.json);
    record({
      id: 'e51',
      name: 'signer down',
      expected: 'HTTP 503 Signer is down, no signature, no settle',
      actual: describeHttp(down),
      pass: down.status === 503 && !downSigned && JSON.stringify(down.json).includes('Signer is down'),
      signed: down.json?.signed === true,
      skipped: false,
      channel: null,
      amounts: null,
      transactions: [],
    });
  } catch (error) {
    record({
      id: 'e51',
      name: 'signer down',
      expected: 'HTTP 503 Signer is down, no signature, no settle',
      actual: error instanceof Error ? error.message : String(error),
      pass: false,
      signed: false,
      skipped: false,
      channel: null,
      amounts: null,
      transactions: [],
    });
  } finally {
    spawn(process.execPath, [join(root, 'scripts', 'launch-voucher-services.mjs'), 'signer'], { cwd: root, detached: true, stdio: 'ignore' }).unref();
    let back = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const again = await fetch('http://127.0.0.1:3012/v1/public-key', { headers: signerHeaders(false) });
        if (again.ok && (await again.json()).publicKey === agentKey) {
          back = true;
          break;
        }
      } catch {
        // signer is still down
      }
      await sleep(300);
    }
    if (!back) throw new Error('Signer did not come back');
  }

  const treasury = treasuryOwnerFromElf(await deployedProgramElf(connection));
  const treasuryAta = await getOrCreateAssociatedTokenAccount(connection, payer, mint, treasury);
  const [eventAuthority] = PublicKey.findProgramAddressSync([Buffer.from('event_authority')], PROGRAM_ID);
  let salt = 1n;
  const channels = [];

  async function canOpen() {
    const bal = BigInt(await connection.getBalance(payer.publicKey, 'confirmed'));
    return bal - CHANNEL_BUDGET >= FLOOR;
  }

  async function submit(tx, signers, expectErr) {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.feePayer = payer.publicKey;
    tx.sign(...signers);
    const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: expectErr });
    try {
      await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
    } catch (error) {
      if (!expectErr) throw error;
    }
    return landed(connection, signature);
  }

  async function openChannel(recipient, deposit) {
    const slot = BigInt(await connection.getSlot('confirmed'));
    const [channel] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('channel'),
        payer.publicKey.toBuffer(),
        recipient.publicKey.toBuffer(),
        mint.toBuffer(),
        new PublicKey(agent.publicKey).toBuffer(),
        Buffer.from(new BigUint64Array([salt]).buffer),
        Buffer.from(new BigUint64Array([slot]).buffer),
      ],
      PROGRAM_ID,
    );
    salt += 1n;
    const channelAta = getAssociatedTokenAddressSync(mint, channel, true);
    const payeeAta = recipient.publicKey.equals(payer.publicKey)
      ? payerAta.address
      : (await getOrCreateAssociatedTokenAccount(connection, payer, mint, recipient.publicKey)).address;
    const openIx = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: recipient.publicKey, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: new PublicKey(agent.publicKey), isSigner: false, isWritable: false },
        { pubkey: channel, isSigner: false, isWritable: true },
        { pubkey: payerAta.address, isSigner: false, isWritable: true },
        { pubkey: channelAta, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: RENT_SYSVAR, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: eventAuthority, isSigner: false, isWritable: false },
        { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: openData(salt - 1n, deposit, 120, slot),
    });
    const tx = await submit(new Transaction().add(openIx), [payer], false);
    return { channel, channelAta, payeeAta, deposit, recipient, open: tx };
  }

  async function readSettled(channel) {
    const info = await connection.getAccountInfo(channel, 'confirmed');
    if (!info || info.data.length < 28) throw new Error('Channel account is missing');
    return info.data.readBigUInt64LE(20);
  }

  async function askSettle(id, name, expected, { channel, recipient, cumulative, mandate, includeOpen = false }) {
    const chainSettled = (await readSettled(channel.channel)).toString();
    const http = await postChannel(fields(mandate, {
      channelId: channel.channel.toBase58(),
      recipient: recipient.publicKey.toBase58(),
      cumulativeAmount: cumulative,
      chainSettled,
      feePayer: payer.publicKey.toBase58(),
    }));
    if (http.json?.signed !== true || !hasSignature(http.json)) {
      record({
        id,
        name,
        expected,
        actual: `gate did not sign: ${describeHttp(http)}`,
        pass: false,
        signed: false,
        skipped: false,
        channel: channel.channel.toBase58(),
        amounts: { deposit: channel.deposit.toString(), chainSettled, cumulative },
        transactions: includeOpen ? [channel.open] : [],
      });
      return null;
    }
    const message = Uint8Array.from(Buffer.from(http.json.messageBase64, 'base64'));
    const signature = Uint8Array.from(Buffer.from(http.json.signatureBase64, 'base64'));
    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: channel.channel, isSigner: false, isWritable: true },
        { pubkey: INSTRUCTIONS_SYSVAR, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([2]),
    });
    const settled = await submit(new Transaction().add(ed25519Instruction(new PublicKey(agent.publicKey).toBytes(), signature, message), ix), [payer], false);
    const after = (await readSettled(channel.channel)).toString();
    const pass = settled.err === null && after === cumulative;
    record({
      id,
      name,
      expected,
      actual: pass ? `settled ${after} on ${channel.channel.toBase58()}` : `settled ${after}, err ${JSON.stringify(settled.err)}`,
      pass,
      signed: true,
      skipped: false,
      channel: channel.channel.toBase58(),
      amounts: { deposit: channel.deposit.toString(), chainSettled, cumulative, settled: after, payee: recipient.publicKey.toBase58() },
      transactions: [...(includeOpen ? [channel.open] : []), { ...settled, kind: 'settle' }],
      decisionScheme: http.json.decision?.record?.offer?.scheme ?? null,
    });
    return { http: http.json, message, signature, settled };
  }

  async function skip(id, name, expected, reason) {
    record({ id, name, expected, actual: reason, pass: null, signed: false, skipped: true, channel: null, amounts: null, transactions: [] });
  }

  let primary = null;
  let voucher1 = null;
  let voucherCap = null;
  if (!(await canOpen())) {
    await skip('e52', 'amount 1 on an allowed payee', 'devnet settle of cumulative 1', 'not run: fee payer would drop below 0.2 SOL');
  } else {
    try {
      primary = await openChannel(payeeA, 100_000n);
      channels.push(primary);
      voucher1 = await askSettle('e52', 'amount 1 on an allowed payee', 'signed true, settle cumulative 1, scheme exact', {
        channel: primary,
        recipient: payeeA,
        cumulative: '1',
        mandate: payMandate,
        includeOpen: true,
      });
      if (voucher1 && voucher1.http.decision?.record?.offer?.scheme !== 'exact') {
        cases[cases.length - 1].pass = false;
        cases[cases.length - 1].actual += ' scheme was not exact';
        flush();
      }
    } catch (error) {
      record({
        id: 'e52',
        name: 'amount 1 on an allowed payee',
        expected: 'signed true, settle cumulative 1, scheme exact',
        actual: error instanceof Error ? error.message : String(error),
        pass: false,
        signed: false,
        skipped: false,
        channel: primary?.channel?.toBase58() ?? null,
        amounts: null,
        transactions: primary ? [primary.open] : [],
      });
    }
  }

  if (!primary || !voucher1) {
    await skip('e53', 'second cumulative strictly above the settled watermark, under the cap', 'signed true and settle cumulative 10001', 'not run: amount-1 channel did not settle');
    await skip('e54', 'cumulative exactly the per-payment cap', 'signed true and settle delta 20000', 'not run: prior settle did not land');
  } else {
    try {
      await askSettle('e53', 'second cumulative strictly above the settled watermark, under the cap', 'signed true and settle cumulative 10001', {
        channel: primary,
        recipient: payeeA,
        cumulative: '10001',
        mandate: payMandate,
      });
    } catch (error) {
      record({
        id: 'e53',
        name: 'second cumulative strictly above the settled watermark, under the cap',
        expected: 'signed true and settle cumulative 10001',
        actual: error instanceof Error ? error.message : String(error),
        pass: false,
        signed: false,
        skipped: false,
        channel: primary.channel.toBase58(),
        amounts: null,
        transactions: [],
      });
    }
    if (cases.some((row) => row.id === 'e53' && row.pass)) {
      try {
        voucherCap = await askSettle('e54', 'cumulative exactly the per-payment cap', 'signed true and settle cumulative 30001 (delta 20000)', {
          channel: primary,
          recipient: payeeA,
          cumulative: '30001',
          mandate: payMandate,
        });
      } catch (error) {
        record({
          id: 'e54',
          name: 'cumulative exactly the per-payment cap',
          expected: 'signed true and settle cumulative 30001 (delta 20000)',
          actual: error instanceof Error ? error.message : String(error),
          pass: false,
          signed: false,
          skipped: false,
          channel: primary.channel.toBase58(),
          amounts: null,
          transactions: [],
        });
      }
    } else {
      await skip('e54', 'cumulative exactly the per-payment cap', 'signed true and settle delta 20000', 'not run: prior settle did not land');
    }
  }

  if (primary && voucherCap?.signature) {
    const chainSettled = (await readSettled(primary.channel)).toString();
    const replayAsk = await postChannel(fields(payMandate, {
      channelId: primary.channel.toBase58(),
      cumulativeAmount: chainSettled,
      chainSettled,
      recipient: payeeA.publicKey.toBase58(),
    }));
    const replaySigned = replayAsk.json?.signed === true || hasSignature(replayAsk.json);
    let replayTx = null;
    try {
      const ix = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: primary.channel, isSigner: false, isWritable: true },
          { pubkey: INSTRUCTIONS_SYSVAR, isSigner: false, isWritable: false },
        ],
        data: Buffer.from([2]),
      });
      replayTx = await submit(
        new Transaction().add(ed25519Instruction(new PublicKey(agent.publicKey).toBytes(), voucherCap.signature, voucherCap.message), ix),
        [payer],
        true,
      );
    } catch (error) {
      replayTx = { signature: null, slot: null, err: error instanceof Error ? error.message : String(error), explorer: null, kind: 'settle-replay' };
    }
    const after = (await readSettled(primary.channel)).toString();
    record({
      id: 'e55',
      name: 'replay of an already-settled cumulative',
      expected: 'gate signed false and the resubmitted settle does not move the watermark',
      actual: `${describeHttp(replayAsk)}; chain settled stayed ${after}; tx err ${JSON.stringify(replayTx?.err)}`,
      pass: !replaySigned && after === chainSettled && replayTx?.err,
      signed: replayAsk.json?.signed === true,
      skipped: false,
      channel: primary.channel.toBase58(),
      amounts: { settled: after },
      transactions: replayTx?.signature ? [{ ...replayTx, kind: 'settle-replay' }] : [],
    });
  } else {
    await skip('e55', 'replay of an already-settled cumulative', 'gate denies and chain rejects the replay', 'not run: no settled voucher to replay');
  }

  if (primary && voucher1) {
    const before = (await readSettled(primary.channel)).toString();
    const payeeBefore = BigInt((await connection.getTokenAccountBalance(primary.payeeAta, 'confirmed')).value.amount);
    const payerBefore = BigInt((await connection.getTokenAccountBalance(payerAta.address, 'confirmed')).value.amount);
    const txs = [];
    try {
      const distributeIx = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: primary.channel, isSigner: false, isWritable: true },
          { pubkey: payer.publicKey, isSigner: false, isWritable: true },
          { pubkey: payer.publicKey, isSigner: false, isWritable: true },
          { pubkey: primary.channelAta, isSigner: false, isWritable: true },
          { pubkey: payerAta.address, isSigner: false, isWritable: true },
          { pubkey: primary.payeeAta, isSigner: false, isWritable: true },
          { pubkey: treasuryAta.address, isSigner: false, isWritable: true },
          { pubkey: mint, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: eventAuthority, isSigner: false, isWritable: false },
          { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([Buffer.from([7]), Buffer.from([0, 0, 0, 0])]),
      });
      txs.push({ ...(await submit(new Transaction().add(distributeIx), [payer], false)), kind: 'distribute' });
      const sealIx = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: payeeA.publicKey, isSigner: true, isWritable: false },
          { pubkey: primary.channel, isSigner: false, isWritable: true },
          { pubkey: INSTRUCTIONS_SYSVAR, isSigner: false, isWritable: false },
        ],
        data: Buffer.from([4, 0]),
      });
      txs.push({ ...(await submit(new Transaction().add(sealIx), [payer, payeeA], false)), kind: 'seal' });
      const withdrawIx = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: primary.channel, isSigner: false, isWritable: true },
          { pubkey: primary.channelAta, isSigner: false, isWritable: true },
          { pubkey: payerAta.address, isSigner: false, isWritable: true },
          { pubkey: mint, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: Buffer.from([8]),
      });
      txs.push({ ...(await submit(new Transaction().add(withdrawIx), [payer], false)), kind: 'withdraw' });
      const info = await connection.getAccountInfo(primary.channel, 'confirmed');
      const payerWithdrawnAt = info.data.readBigInt64LE(44);
      const payeeAfter = BigInt((await connection.getTokenAccountBalance(primary.payeeAta, 'confirmed')).value.amount);
      const payerAfter = BigInt((await connection.getTokenAccountBalance(payerAta.address, 'confirmed')).value.amount);
      const payeeReceived = payeeAfter - payeeBefore;
      const remainder = payerAfter - payerBefore;
      const pass = txs.every((tx) => tx.err === null) && payerWithdrawnAt !== 0n && payeeReceived === BigInt(before) && remainder === 100_000n - BigInt(before);
      record({
        id: 'e56',
        name: 'distribute, seal, then withdraw the leftover',
        expected: 'payee receives the settled tokens and the payer receives deposit minus settled',
        actual: `payee ${payeeReceived} remainder ${remainder} payerWithdrawnAt ${payerWithdrawnAt}`,
        pass,
        signed: false,
        skipped: false,
        channel: primary.channel.toBase58(),
        amounts: { deposit: '100000', settled: before, payee: payeeReceived.toString(), remainder: remainder.toString() },
        transactions: txs,
      });
    } catch (error) {
      record({
        id: 'e56',
        name: 'distribute, seal, then withdraw the leftover',
        expected: 'payee receives the settled tokens and the payer receives deposit minus settled',
        actual: error instanceof Error ? error.message : String(error),
        pass: false,
        signed: false,
        skipped: false,
        channel: primary.channel.toBase58(),
        amounts: { deposit: '100000', settled: before },
        transactions: txs,
      });
    }
  } else {
    await skip('e56', 'distribute, seal, then withdraw the leftover', 'payee receives settled tokens and payer receives the remainder', 'not run: channel was not settled');
  }

  if (voucher1 && (await canOpen())) {
    try {
      const wrong = Keypair.generate().publicKey;
      const ix = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: wrong, isSigner: false, isWritable: true },
          { pubkey: INSTRUCTIONS_SYSVAR, isSigner: false, isWritable: false },
        ],
        data: Buffer.from([2]),
      });
      const tx = await submit(
        new Transaction().add(ed25519Instruction(new PublicKey(agent.publicKey).toBytes(), voucher1.signature, voucher1.message), ix),
        [payer],
        true,
      );
      record({
        id: 'e57',
        name: 'settle against the wrong channel address',
        expected: 'transaction fails and no second channel is credited',
        actual: `err ${JSON.stringify(tx.err)}`,
        pass: Boolean(tx.signature) && tx.err,
        signed: true,
        skipped: false,
        channel: wrong.toBase58(),
        amounts: null,
        transactions: [{ ...tx, kind: 'settle-wrong-channel' }],
      });
    } catch (error) {
      record({
        id: 'e57',
        name: 'settle against the wrong channel address',
        expected: 'transaction fails and no second channel is credited',
        actual: error instanceof Error ? error.message : String(error),
        pass: false,
        signed: true,
        skipped: false,
        channel: null,
        amounts: null,
        transactions: [],
      });
    }
  } else {
    await skip('e57', 'settle against the wrong channel address', 'transaction fails', 'not run: no voucher or balance too low');
  }

  async function otherPayee(id, name, expected, recipient, deposit, cumulative) {
    if (!(await canOpen())) {
      await skip(id, name, expected, 'not run: fee payer would drop below 0.2 SOL');
      return;
    }
    try {
      const channel = await openChannel(recipient, deposit);
      channels.push(channel);
      await askSettle(id, name, expected, { channel, recipient, cumulative, mandate: payMandate, includeOpen: true });
    } catch (error) {
      record({
        id,
        name,
        expected,
        actual: error instanceof Error ? error.message : String(error),
        pass: false,
        signed: false,
        skipped: false,
        channel: null,
        amounts: null,
        transactions: [],
      });
    }
  }

  await otherPayee('e58', 'second payee on a different channel', 'signed true and settle 2000 to the other allowlisted payee', payeeB, 5_000n, '2000');

  const selfPayExpected = 'open simulation fails with 0x7d1 and no transaction is sent';
  if (!(await canOpen())) {
    await skip('e59', 'self-pay, payer is the payee', selfPayExpected, 'not run: fee payer would drop below 0.2 SOL');
  } else {
    try {
      const channel = await openChannel(payer, 5_000n);
      channels.push(channel);
      record({
        id: 'e59',
        name: 'self-pay, payer is the payee',
        expected: selfPayExpected,
        actual: `opened ${channel.channel.toBase58()}`,
        pass: false,
        signed: false,
        skipped: false,
        channel: channel.channel.toBase58(),
        amounts: null,
        transactions: channel.open?.signature ? [channel.open] : [],
      });
    } catch (error) {
      const actual = error instanceof Error ? error.message : String(error);
      record({
        id: 'e59',
        name: 'self-pay, payer is the payee',
        expected: selfPayExpected,
        actual,
        pass: actual.includes('0x7d1'),
        signed: false,
        skipped: false,
        channel: null,
        amounts: null,
        transactions: [],
      });
    }
  }

  const anchorReceipt = voucherCap?.http
    ? await buildReceipt(
        {
          id: `rcp_${voucherCap.http.messageHash.slice(0, 16)}`,
          mandate: payMandate,
          decision: voucherCap.http.decision,
          settlement: {
            txSignature: voucherCap.settled.signature,
            network: SOLANA_DEVNET_CAIP2,
            payer: agent.publicKey,
            settledAt: nowSec(),
            slot: voucherCap.settled.slot,
          },
          response: {
            status: 200,
            bodySha256: hashResponseBody(Buffer.from(voucherCap.message)),
            contentType: 'application/vnd.payment-channels.voucher',
          },
          issuedAt: nowSec(),
        },
        instance,
      )
    : null;

  if (!anchorReceipt) {
    await skip('e60', 'anchor_root skipped when the mandate account is missing', 'no anchor transaction', 'not run: no settled receipt');
    await skip('e61', 'create_mandate then anchor_root', 'both transactions land', 'not run: no settled receipt');
  } else {
    const store = new InMemoryReceiptStore();
    await store.insert({ organizationId: 'org_channel', receipt: anchorReceipt, createdAt: nowSec(), batchId: null });
    const anchor = () =>
      new AnchorService({
        receipts: store,
        chain: Web3ChainClient.fromUrl(RPC),
        signer: instance,
        clock: nowSec,
        newId: (prefix) => `${prefix}_edge`,
        rpcUrl: RPC,
        programId: MANDATE_PROGRAM,
        network: SOLANA_DEVNET_CAIP2,
      }).run();
    const skipped = await anchor();
    const mandateHash = hashMandate(payMandate);
    const { address: mandatePda } = findMandatePda(MANDATE_PROGRAM, Buffer.from(mandateHash, 'hex'));
    const missing = await fetchMandateAccount(RPC, mandatePda);
    record({
      id: 'e60',
      name: 'anchor_root skipped when the mandate account is missing',
      expected: 'no transaction; receipt stays pending',
      actual: skipped ? `anchored ${skipped.batch.txSignature}` : `skipped, mandate account ${missing ? 'present' : 'absent'}`,
      pass: skipped == null && missing == null,
      signed: false,
      skipped: false,
      channel: primary?.channel?.toBase58() ?? null,
      amounts: null,
      transactions: [],
    });
    try {
      const { blockhash } = await connection.getLatestBlockhash('confirmed');
      const createRaw = buildCreateMandateTransaction({
        programId: MANDATE_PROGRAM,
        mandateHash: Buffer.from(mandateHash, 'hex'),
        gateAuthority: instance.publicKey,
        mint: mintAddress,
        maxPerPayment: 20_000n,
        maxPerWindow: 100_000n,
        windowSeconds: 86_400n,
        maxTotal: 100_000n,
        escalationThreshold: 100_000n,
        notBefore: BigInt(openedAt - 60),
        expiresAt: BigInt(openedAt + 7200),
        owner: owner.publicKey.toBase58(),
        approver: approver.publicKey.toBase58(),
        agent: agent.publicKey,
        recentBlockhash: blockhash,
      });
      const createTx = VersionedTransaction.deserialize(Buffer.from(createRaw, 'base64'));
      createTx.sign([owner, approver, agentWallet]);
      const createSig = await connection.sendRawTransaction(createTx.serialize());
      await connection.confirmTransaction(createSig, 'confirmed');
      const createLanded = await landed(connection, createSig);
      const anchored = await anchor();
      const anchorSig = anchored?.batch?.txSignature ?? null;
      const anchorLanded = anchorSig ? await landed(connection, anchorSig) : { signature: null, slot: null, err: 'no signature', explorer: null };
      const { address: rootPda } = findRootPda(MANDATE_PROGRAM, mandatePda, 0n);
      const rootInfo = await connection.getAccountInfo(new PublicKey(rootPda), 'confirmed');
      const rooted = rootInfo ? decodeRootAccount(rootInfo.data) : null;
      const pass = createLanded.err === null && anchorLanded.err === null && rooted?.merkleRoot === anchored?.batch?.merkleRoot;
      record({
        id: 'e61',
        name: 'create_mandate then anchor_root',
        expected: 'mandate account is created and anchor_root lands with the receipt root',
        actual: pass ? `root ${rooted.merkleRoot}` : `create ${JSON.stringify(createLanded.err)} anchor ${JSON.stringify(anchorLanded.err)}`,
        pass,
        signed: false,
        skipped: false,
        channel: primary.channel.toBase58(),
        amounts: null,
        transactions: [
          { ...createLanded, kind: 'create_mandate' },
          { ...anchorLanded, kind: 'anchor_root' },
        ],
        mandatePda,
        rootPda,
      });
    } catch (error) {
      record({
        id: 'e61',
        name: 'create_mandate then anchor_root',
        expected: 'mandate account is created and anchor_root lands with the receipt root',
        actual: error instanceof Error ? error.message : String(error),
        pass: false,
        signed: false,
        skipped: false,
        channel: primary?.channel?.toBase58() ?? null,
        amounts: null,
        transactions: [],
      });
    }
  }

  const balanceAfter = BigInt(await connection.getBalance(payer.publicKey, 'confirmed'));
  const body = flush({
    feePayer: payer.publicKey.toBase58(),
    balanceLamportsBefore: balanceBefore.toString(),
    balanceLamportsAfter: balanceAfter.toString(),
    balanceSolBefore: Number(balanceBefore) / 1e9,
    balanceSolAfter: Number(balanceAfter) / 1e9,
    mint: mintAddress,
    channels: channels.map((channel) => channel.channel.toBase58()),
    anchorFundTransferLamports: 0,
    floorLamports: FLOOR.toString(),
  });
  const lines = [
    '# Voucher edge cases on devnet, 2026-10-17',
    '',
    `Fee payer \`${body.feePayer}\` went from ${body.balanceSolBefore} SOL to ${body.balanceSolAfter} SOL.`,
    `Pass ${body.counts.pass}, fail ${body.counts.fail}, not run ${body.counts.notRun}. Devnet transactions submitted: ${body.counts.devnetTxSubmitted}.`,
    'No 0.1 SOL anchor fund transfer was sent. Owner and instance keys already held SOL.',
    '',
    '| id | result | signed | name | explorer |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const row of cases) {
    const result = row.skipped ? 'not run' : row.pass ? 'pass' : 'fail';
    const links = (row.transactions ?? []).map((tx) => tx.explorer).filter(Boolean).join('<br>');
    lines.push(`| ${row.id} | ${result} | ${row.signed} | ${row.name} | ${links || ''} |`);
  }
  const notRun = cases.filter((row) => row.skipped);
  if (notRun.length) {
    lines.push('', '## Not run', '');
    for (const row of notRun) lines.push(`- ${row.id} ${row.name}: ${row.actual}`);
  }
  writeFileSync(REPORT_MD, `${lines.join('\n')}\n`);
  console.log(REPORT_JSON);
  console.log(`pass ${body.counts.pass} fail ${body.counts.fail} notRun ${body.counts.notRun} txs ${body.counts.devnetTxSubmitted}`);
  if (cases.length < 50) throw new Error(`only ${cases.length} cases`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    flush({ crashed: error instanceof Error ? error.message : String(error) });
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
