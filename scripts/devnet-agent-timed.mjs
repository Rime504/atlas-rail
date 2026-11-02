/**
 * What an agent does on Devnet, through createAtlasRail, with a clock on every step.
 *   node scripts/devnet-agent-timed.mjs --execute
 *
 * Creates a mandate, opens a channel, denies an over-cap voucher and an unlisted recipient,
 * pays five times, then stores all five receipts in one anchor_root, then refunds.
 * Does not touch the recovery or evidence channels.
 */
import { performance } from 'node:perf_hooks';
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
const { Keypair, PublicKey, SystemProgram, Transaction } = requireAtlas('@solana/web3.js');
const { decodeRootAccount } = requireAtlas('@atlas-rail/solana');
const { getAssociatedTokenAddressSync } = requireAtlas('@solana/spl-token');
const { createMandate, hashMandate, LocalEd25519Signer, signMandate } = requireMandate('@atlas-rail/mandate');
const sdk = await import(pathToFileURL(join(root, 'packages/atlasrails/dist/index.js')).href);

const MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const DEPOSIT = 10_000n;
const CAP = 1_000n;
const VOUCHERS = 5;
const DELTA = 500n;

function messageSigner(keypair) {
  const signer = new LocalEd25519Signer(keypair.secretKey.subarray(0, 32));
  if (signer.publicKey !== keypair.publicKey.toBase58()) throw new Error('Ed25519 signer does not match the Solana key');
  return signer;
}

function seedKeypair(hex, name) {
  if (!/^[0-9a-fA-F]{64}$/.test(hex ?? '')) throw new Error(`${name} must be 32 bytes of hex`);
  return Keypair.fromSeed(Uint8Array.from(Buffer.from(hex, 'hex')));
}

function ms(started) {
  return Math.round((performance.now() - started) * 10) / 10;
}

function failText(result) {
  if (!result) return 'missing result';
  if (result.status === 'failed' || result.status === 'unknown') return result.error.message;
  return `status ${result.status}`;
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
const stranger = Keypair.generate();

const now = Math.floor(Date.now() / 1000);
const network = env.ATLAS_NETWORK || 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
const resourceUrl = 'http://localhost/research';
let mandate = createMandate({
  id: `mnd_${randomBytes(10).toString('hex').toUpperCase()}`,
  nonce: randomBytes(16).toString('hex'),
  issuer: { organizationId: 'org_agent_timed', name: 'Atlas Rail Agent' },
  agent: { publicKey: agent.publicKey.toBase58(), label: 'Timed agent' },
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

const { connection } = sdk.connect({
  path: funderFile,
  rpcUrl: env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
});
const atlas = sdk.createAtlasRail({
  apiUrl: env.ATLAS_API_URL || 'http://127.0.0.1:9',
  connection,
  wallet: sdk.keypairWallet({ path: funderFile }),
  execution: 'autoExecute',
  agent,
  gate,
});

const timingsMs = {};
const steps = [];
let channel = null;
const reportPath = join(root, 'reports', 'devnet-agent-batch-2026-10-20.json');

function remember(step, started, extra) {
  const elapsed = ms(started);
  timingsMs[step] = elapsed;
  steps.push({ step, ms: elapsed, ...extra });
  console.log(JSON.stringify({ step, ms: elapsed, ...extra }));
}

async function writeReport(extra) {
  const report = {
    generatedAt: new Date().toISOString(),
    via: 'createAtlasRail',
    network: 'devnet',
    graceSeconds: 900,
    deposit: DEPOSIT.toString(),
    timingsMs,
    steps,
    ...extra,
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

try {
  const usdc = getAssociatedTokenAddressSync(new PublicKey(MINT), owner.publicKey);
  const balance = await connection.getTokenAccountBalance(usdc, 'confirmed').catch(() => null);
  if (!balance || BigInt(balance.value.amount) < DEPOSIT) {
    throw new Error('Funder USDC balance is below the 10000 base-unit deposit');
  }

  let started = performance.now();
  const gateLamports = await connection.getBalance(gate.publicKey, 'confirmed');
  if (gateLamports < 20_000_000) {
    const tx = new Transaction().add(SystemProgram.transfer({
      fromPubkey: owner.publicKey,
      toPubkey: gate.publicKey,
      lamports: 50_000_000,
    }));
    tx.feePayer = owner.publicKey;
    const fundSignature = await connection.sendTransaction(tx, [owner], { preflightCommitment: 'confirmed' });
    const fundResult = await connection.confirmTransaction(fundSignature, 'confirmed');
    if (fundResult.value.err) throw new Error('Funding the gate key for anchor_root rent failed');
    remember('fundGate', started, { signature: fundSignature, lamports: 50_000_000 });
  } else {
    remember('fundGate', started, { skipped: true, lamports: gateLamports });
  }

  started = performance.now();
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
  if (created.status !== 'confirmed') throw new Error(failText(created));
  remember('createMandate', started, { mandatePda: created.mandatePda, signature: created.signature });

  started = performance.now();
  const opened = await atlas.openChannel({
    payee: payee.publicKey.toBase58(),
    mint: MINT,
    agent: agent.publicKey.toBase58(),
    deposit: DEPOSIT,
    graceSeconds: 900,
    salt: BigInt(Date.now()),
    submit: true,
  });
  if (opened.status !== 'confirmed') throw new Error(failText(opened));
  assertSafeChannel(opened.channel);
  if (opened.channel === FORBIDDEN_CHANNEL || opened.channel === EVIDENCE_CHANNEL) throw new Error('Refusing a preserved channel');
  channel = opened.channel;
  remember('openChannel', started, { channel: opened.channel, escrow: opened.escrow, signature: opened.openSignature });

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

  started = performance.now();
  const overCap = await atlas.requestPayment({ ...payment, amount: CAP + 1n });
  const overCapBlocked = overCap.status === 'denied'
    ? overCap.broadcast === false
    : overCap.status === 'failed' && overCap.error.broadcast === false;
  if (!overCapBlocked) throw new Error(failText(overCap));
  remember('denyOverCap', started, { status: overCap.status, broadcast: false });

  started = performance.now();
  const unlisted = await atlas.requestPayment({ ...payment, recipient: stranger.publicKey.toBase58(), amount: DELTA });
  const unlistedBlocked = unlisted.status === 'denied'
    ? unlisted.broadcast === false
    : unlisted.status === 'failed' && unlisted.error.broadcast === false;
  if (!unlistedBlocked) throw new Error(failText(unlisted));
  remember('denyUnlistedRecipient', started, { status: unlisted.status, broadcast: false });

  const pays = [];
  for (let index = 1; index <= VOUCHERS; index += 1) {
    started = performance.now();
    const paid = await atlas.pay({ ...payment, amount: DELTA * BigInt(index) });
    if (paid.status !== 'paid') throw new Error(failText(paid));
    if (paid.receipt.anchor) throw new Error('pay() stored a root before the batch');
    pays.push({ settleSignature: paid.settleSignature, distributeSignature: paid.distributeSignature, payeeDelta: paid.payeeDelta });
    remember(`pay${index}`, started, pays[index - 1]);
  }

  started = performance.now();
  const anchored = await atlas.anchorVouchers(created.mandatePda);
  if (anchored.status !== 'anchored') throw new Error(failText(anchored));
  if (anchored.leafCount !== VOUCHERS) throw new Error(`anchor_root leaf count is ${anchored.leafCount}`);
  const missing = pays.filter((pay) => !anchored.settlements.includes(pay.settleSignature));
  if (missing.length > 0) throw new Error('anchor result is missing a settlement signature');
  const rootInfo = await connection.getAccountInfo(new PublicKey(anchored.rootPda), 'confirmed');
  if (!rootInfo) throw new Error('Root account is missing');
  const root = decodeRootAccount(rootInfo.data);
  if (root.merkleRoot !== anchored.merkleRoot || root.leafCount !== VOUCHERS) {
    throw new Error('Root account does not match the batch');
  }
  const anchorTx = await connection.getTransaction(anchored.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
  const accountKeys = anchorTx.transaction.message.staticAccountKeys ?? anchorTx.transaction.message.accountKeys;
  const memoProgramIndex = accountKeys.findIndex((key) => key.toBase58() === 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
  if (memoProgramIndex !== -1) throw new Error('anchor_root must not include a memo instruction');
  remember('anchorVouchers', started, {
    rootPda: anchored.rootPda,
    signature: anchored.signature,
    leafCount: anchored.leafCount,
    seq: anchored.seq,
    merkleRoot: anchored.merkleRoot,
    settlements: anchored.settlements,
  });

  started = performance.now();
  const refund = await atlas.refundRemainder({ channel: opened.channel, payee, submit: true });
  if (refund.status !== 'refunded') throw new Error(failText(refund));
  if (refund.escrowAmount !== '0') throw new Error(`Escrow still holds ${refund.escrowAmount}`);
  if (refund.anchor) throw new Error('refund sent a second anchor_root');
  remember('refund', started, { signatures: refund.signatures, payerDelta: refund.payerDelta, escrowAmount: refund.escrowAmount });

  const signatureRows = [
    ['createMandate', created.signature],
    ['openChannel', opened.openSignature],
    ...pays.flatMap((pay, index) => [
      [`pay${index + 1}Settle`, pay.settleSignature],
      [`pay${index + 1}Distribute`, pay.distributeSignature],
    ]),
    ['anchor', anchored.signature],
    ...refund.signatures.map((signature, index) => [`refund${index}`, signature]),
  ];
  const totalMs = Math.round(Object.values(timingsMs).reduce((sum, value) => sum + value, 0) * 10) / 10;
  const outcome = {
    mandatePda: created.mandatePda,
    channel: opened.channel,
    escrow: opened.escrow,
    vouchers: VOUCHERS,
    anchor: {
      rootPda: anchored.rootPda,
      signature: anchored.signature,
      leafCount: anchored.leafCount,
      seq: anchored.seq,
      merkleRoot: anchored.merkleRoot,
      settlements: anchored.settlements,
    },
    payerDelta: refund.payerDelta,
    escrowAmount: refund.escrowAmount,
    totalMs,
  };
  const confirmed = [];
  let lookupError = null;
  for (const [step, signature] of signatureRows) {
    const looked = performance.now();
    let tx = null;
    for (let attempt = 0; attempt < 6 && !tx; attempt += 1) {
      try {
        tx = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/429/.test(message) || attempt === 5) {
          lookupError = message;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
      }
    }
    if (!tx || tx.meta?.err) {
      lookupError = lookupError ?? `Signature for ${step} was not re-read`;
      break;
    }
    confirmed.push({
      step,
      signature,
      slot: tx.slot,
      lookupMs: ms(looked),
      explorer: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
    });
  }
  await writeReport({ ...outcome, confirmed, ...(lookupError ? { lookupError } : {}) });
  console.log(JSON.stringify({ reportPath, totalMs, channel: opened.channel, confirmed: confirmed.length, lookupError }, null, 2));
} catch (error) {
  await writeReport({ error: error instanceof Error ? error.message : String(error), channel });
  if (channel && !timingsMs.refund) {
    try {
      const refund = await atlas.refundRemainder({ channel, payee, submit: true });
      console.error(JSON.stringify({ cleanup: refund.status, escrowAmount: refund.escrowAmount ?? null }));
    } catch (cleanup) {
      console.error(cleanup instanceof Error ? cleanup.message : 'cleanup refund failed');
    }
  }
  console.error(error instanceof Error ? error.stack ?? error.message : 'agent run failed');
  process.exit(1);
}
