/**
 * Devnet proof that createAtlasRail.openChannel and refundRemainder broadcast.
 *   node scripts/devnet-client-open-refund.mjs --execute
 */
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { serviceEnv } from './launch-voucher-services.mjs';
import { EVIDENCE_CHANNEL, FORBIDDEN_CHANNEL, PAYER, assertSafeChannel } from './devnet-mandate-package.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const requireAtlas = createRequire(join(root, 'packages/atlasrails/package.json'));
const requireMandate = createRequire(join(root, 'packages/mandate/package.json'));
const { Keypair } = requireAtlas('@solana/web3.js');
const { createMandate, hashMandate, LocalEd25519Signer, signMandate } = requireMandate('@atlas-rail/mandate');
const { createAtlasRail, keypairWallet } = await import(pathToFileURL(join(root, 'packages/atlasrails/dist/index.js')).href);

const MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const DEPOSIT = 10_000n;
const CAP = 1000n;

function messageSigner(keypair) {
  const signer = new LocalEd25519Signer(keypair.secretKey.subarray(0, 32));
  if (signer.publicKey !== keypair.publicKey.toBase58()) throw new Error('Ed25519 signer does not match the Solana key');
  return signer;
}

function seedKeypair(hex, name) {
  if (!/^[0-9a-fA-F]{64}$/.test(hex ?? '')) throw new Error(`${name} must be 32 bytes of hex`);
  return Keypair.fromSeed(Uint8Array.from(Buffer.from(hex, 'hex')));
}

if (!process.argv.includes('--execute')) {
  console.error('Refusing to broadcast. Re-run with --execute to use the funder wallet on Devnet.');
  process.exit(1);
}

const env = serviceEnv();
const funderPath = env.ATLAS_FUNDER_KEY_PATH;
if (!funderPath) throw new Error('ATLAS_FUNDER_KEY_PATH is required');
const funderFile = funderPath.includes(':') ? funderPath : join(root, funderPath);
const owner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(funderFile, 'utf8'))));
if (owner.publicKey.toBase58() !== PAYER) throw new Error('Loaded fee payer does not match the expected payer');
const approver = seedKeypair(env.ATLAS_APPROVER_SEED, 'ATLAS_APPROVER_SEED');
const gate = seedKeypair(env.ATLAS_INSTANCE_SEED, 'ATLAS_INSTANCE_SEED');
const agent = Keypair.generate();
const payee = Keypair.generate();
mkdirSync(join(root, '.demo'), { recursive: true });
writeFileSync(join(root, '.demo', 'client-open-refund-agent.json'), JSON.stringify(Array.from(agent.secretKey)), { mode: 0o600 });
writeFileSync(join(root, '.demo', 'client-open-refund-payee.json'), JSON.stringify(Array.from(payee.secretKey)), { mode: 0o600 });

const now = Math.floor(Date.now() / 1000);
const network = env.ATLAS_NETWORK || 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
const resourceUrl = 'http://localhost/research';
let mandate = createMandate({
  id: `mnd_${randomBytes(10).toString('hex').toUpperCase()}`,
  nonce: randomBytes(16).toString('hex'),
  issuer: { organizationId: 'org_client_open', name: 'Atlas Rail Client' },
  agent: { publicKey: agent.publicKey.toBase58(), label: 'Channel signer' },
  delegation: { requiredApprovals: 1 },
  scope: {
    allowedNetworks: [network],
    allowedAssets: [MINT],
    allowedPayTo: [payee.publicKey.toBase58()],
    allowedResources: [resourceUrl],
    limits: { mint: MINT, maxPerPayment: CAP.toString(), maxPerWindow: '10000', windowSeconds: 3600, maxTotal: '10000' },
    priceLimits: [],
  },
  escalation: { thresholdBaseUnits: '1000', approverRoles: ['OWNER', 'APPROVER'], resources: [], approvalTtlSeconds: 600 },
  notBefore: now - 60,
  expiresAt: now + 86_400,
});
mandate = await signMandate(mandate, { role: 'OWNER', signer: messageSigner(owner) });
mandate = await signMandate(mandate, { role: 'APPROVER', signer: messageSigner(approver) });
mandate = await signMandate(mandate, { role: 'AGENT', signer: messageSigner(agent) });

const { connection } = (await import(pathToFileURL(join(root, 'packages/atlasrails/dist/index.js')).href)).connect({
  path: funderFile,
  rpcUrl: env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
});
const atlas = createAtlasRail({
  apiUrl: env.ATLAS_API_URL || 'http://127.0.0.1:9',
  connection,
  wallet: keypairWallet({ path: funderFile }),
  execution: 'autoExecute',
  agent,
  gate,
});

const created = await atlas.createMandate({
  owner,
  approver,
  agent,
  mandateHash: Uint8Array.from(Buffer.from(hashMandate(mandate), 'hex')),
  gateAuthority: gate.publicKey.toBase58(),
  mint: MINT,
  maxPerPayment: CAP,
  maxPerWindow: 10_000n,
  windowSeconds: 3600n,
  maxTotal: 10_000n,
  escalationThreshold: 1000n,
  notBefore: BigInt(now - 60),
  expiresAt: BigInt(now + 86_400),
  submit: true,
});
if (created.status !== 'confirmed') throw new Error('createMandate did not confirm');
console.log(JSON.stringify({ phase: 'mandate', mandatePda: created.mandatePda, signature: created.signature, via: 'createAtlasRail.createMandate' }));

const opened = await atlas.openChannel({
  payee: payee.publicKey.toBase58(),
  mint: MINT,
  agent: agent.publicKey.toBase58(),
  deposit: DEPOSIT,
  graceSeconds: 1,
  salt: BigInt(Date.now()),
  submit: true,
});
if (opened.status !== 'confirmed') throw new Error(opened.status === 'failed' ? opened.error.message : 'openChannel did not confirm');
assertSafeChannel(opened.channel);
if (opened.channel === FORBIDDEN_CHANNEL || opened.channel === EVIDENCE_CHANNEL) throw new Error('Refusing a preserved channel');
console.log(JSON.stringify({ phase: 'open', channel: opened.channel, escrow: opened.escrow, signature: opened.openSignature, via: 'createAtlasRail.openChannel' }));

const payment = {
  mandate,
  channel: opened.channel,
  recipient: payee.publicKey.toBase58(),
  mint: MINT,
  resourceUrl,
  network,
  expiresAt: now + 3600,
  mandateAddress: created.mandatePda,
};
const above = await atlas.requestPayment({ ...payment, amount: CAP + 1n });
const aboveBlocked = above.status === 'denied'
  ? above.broadcast === false
  : above.status === 'failed' && above.error.broadcast === false && /maxPerPayment|MandateDenied|cap/i.test(above.error.message);
if (!aboveBlocked) {
  throw new Error(above.status === 'failed' ? above.error.message : `Amount above the cap was ${above.status}`);
}
const paid = await atlas.pay({ ...payment, amount: CAP });
if (paid.status !== 'paid') throw new Error(paid.status === 'failed' || paid.status === 'unknown' ? paid.error.message : `Payment status ${paid.status}`);
console.log(JSON.stringify({ phase: 'pay', settle: paid.settleSignature, distribute: paid.distributeSignature, payeeDelta: paid.payeeDelta, via: 'createAtlasRail.pay' }));

let refund = await atlas.refundRemainder({ channel: opened.channel, payee, submit: true });
if (refund.status === 'failed' || refund.status === 'unknown') {
  refund = await atlas.refundRemainder({ channel: opened.channel, submit: true });
}
if (refund.status === 'closing') {
  const waitMs = Number(refund.graceEndsAt) * 1000 - Date.now() + 1500;
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  refund = await atlas.refundRemainder({ channel: opened.channel, submit: true });
}
if (refund.status !== 'refunded') throw new Error(refund.status === 'failed' || refund.status === 'unknown' ? refund.error.message : `Refund status ${refund.status}`);
if (refund.escrowAmount !== '0') throw new Error(`Escrow still holds ${refund.escrowAmount}`);
console.log(JSON.stringify({ phase: 'refund', signatures: refund.signatures, payerDelta: refund.payerDelta, escrowAmount: refund.escrowAmount, via: 'createAtlasRail.refundRemainder' }));

const signatures = [created.signature, opened.openSignature, paid.settleSignature, paid.distributeSignature, ...refund.signatures];
const confirmedSignatures = [];
for (const signature of signatures) {
  const tx = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
  if (!tx || tx.meta?.err) throw new Error(`Signature ${signature} is not confirmed`);
  confirmedSignatures.push({ signature, slot: tx.slot, explorer: `https://explorer.solana.com/tx/${signature}?cluster=devnet` });
}
const report = {
  generatedAt: new Date().toISOString(),
  via: 'createAtlasRail',
  mandatePda: created.mandatePda,
  channel: opened.channel,
  escrow: opened.escrow,
  graceSeconds: opened.graceSeconds,
  aboveCapBlocked: aboveBlocked,
  payeeDelta: paid.payeeDelta,
  payerDelta: refund.payerDelta,
  escrowAmount: refund.escrowAmount,
  confirmedSignatures,
};
const reportPath = join(root, 'reports', 'devnet-client-open-refund-2026-10-20.json');
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ reportPath, channel: opened.channel, payerDelta: refund.payerDelta, escrowAmount: refund.escrowAmount }, null, 2));
