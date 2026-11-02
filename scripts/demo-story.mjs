#!/usr/bin/env node
/**
 * pnpm demo — the whole Atlas Rail story in one command, on a local Solana validator with the same
 * two programs as Devnet (Atlas Mandate built from this repo, payment-channels copied from Devnet).
 *
 *   1. the owner creates a mandate: $0.05 per call on its own, $1 per day
 *   2. the agent pays an API 5 times; every payment is allowed and gets a receipt
 *   3. the agent tries $5: blocked, the owner is notified on Telegram, a stranger's signature is refused
 *   4. an unusual payment is flagged with the reason; the owner's wallet signs it, and it is paid once
 *   5. the batch is anchored: one transaction, no memo
 *   6. one receipt verifies: PASS; the same receipt with one byte changed: FAIL
 *   7. a channel runs low: the agent pauses, the owner tops up, the agent continues
 *
 * The agent key lives in a signer service (it never enters this script). The voucher service is the
 * API's own code. Approvals are signed by the owner's wallet (here a local key); Telegram only
 * notifies. With TELEGRAM_BOT_TOKEN and TELEGRAM_OWNER_CHAT_ID set, the owner's phone gets the real
 * messages; without them a stand-in shows each message here, and says so.
 *
 * Flags: --quiet (one line per step), --json (machine-readable result at the end).
 */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startLocalValidator } from './local-validator.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUIET = process.argv.includes('--quiet');
const JSON_OUT = process.argv.includes('--json');
process.env.ATLAS_ALLOW_MOCK_SIGNER = 'true'; // throw-away local keys only

// Build what the demo runs, every time. Turbo only rebuilds what changed, so this takes a few
// seconds; skipping it when `dist` exists would run code compiled on another branch after a checkout.
if (!QUIET) console.log('Checking the build…');
const build = spawnSync('pnpm', ['turbo', 'run', 'build', '--filter=atlasrails...', '--filter=@atlas-rail/api...', '--filter=@atlas-rail/signer...'], { cwd: root, stdio: 'ignore' });
if (build.status !== 0) throw new Error('Build failed. Run `pnpm build` to see why.');

const requireAtlas = createRequire(join(root, 'packages/atlasrails/package.json'));
const requireApi = createRequire(join(root, 'apps/api/package.json'));
const { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } = requireAtlas('@solana/web3.js');
const { createMint, getOrCreateAssociatedTokenAccount, mintTo } = requireAtlas('@solana/spl-token');
const { createMandate, hashMandate, LocalEd25519Signer, ownerApprovalMessage, signMandate, toBase58 } = requireApi('@atlas-rail/mandate');
const { DevnetKeyring, Web3ChainClient, decodeRootAccount } = requireApi('@atlas-rail/solana');
const { InMemoryOwnerApprovalStore, InMemoryVoucherSpendStore } = requireApi('@atlas-rail/database');
const { GatedSignerAdapter, startSignerService } = requireApi('@atlas-rail/x402');
const { verifyReceipt } = requireApi('@atlas-rail/receipt');
const sdk = await import(pathToFileURL(join(root, 'packages/atlasrails/dist/index.js')).href);
const { askChannelVoucher, voucherTokenProblem } = requireApi(join(root, 'apps/api/dist/agent/channel-voucher.js'));
const { OwnerApprovals, telegramConfigFromEnv } = requireApi(join(root, 'apps/api/dist/agent/owner-approvals.js'));
const { mandateVoucherKeys } = createRequire(join(root, 'apps/signer/package.json'))(join(root, 'apps/signer/dist/voucher-keys.js'));

const NETWORK = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
const API = 'https://data.example/api';
const usd = (base) => `$${(Number(base) / 1_000_000).toFixed(3).replace(/0$/, '')}`;
const ms = (start) => Math.round(performance.now() - start);
const results = [];
const startedAll = performance.now();

function step(n, title) {
  console.log(`\n${n}. ${title}`);
  return performance.now();
}
function say(line) {
  if (!QUIET) console.log(`   ${line}`);
}
function done(n, title, ok, started, extra = {}) {
  results.push({ step: n, title, ok, ms: ms(started), ...extra });
  console.log(`   ${ok ? 'OK' : 'FAILED'}  (${ms(started)} ms)`);
  if (!ok) throw new Error(`Step ${n} failed: ${title}`);
}
function failText(result) {
  if (!result) return 'no result';
  if (result.status === 'failed' || result.status === 'unknown') return result.error.message;
  return `${result.status}${result.message ? `: ${result.message}` : ''}${result.reason ? ` (${result.reason})` : ''}`;
}

const cleanup = [];
async function shutdown() {
  for (const fn of cleanup.reverse()) await fn().catch(() => undefined);
}
process.on('SIGINT', () => void shutdown().then(() => process.exit(130)));

try {
  // ---------- set the stage ----------
  let started = performance.now();
  console.log('Atlas Rail: what an AI agent may pay, enforced before it pays, provable on Solana.');
  console.log('Starting a local Solana validator with the Atlas Mandate and payment-channels programs…');
  const validator = await startLocalValidator();
  cleanup.push(() => validator.stop());
  process.env.SOLANA_RPC_URL = validator.rpcUrl;
  const connection = new Connection(validator.rpcUrl, 'confirmed');
  const dir = mkdtempSync(join(tmpdir(), 'atlas-demo-'));
  cleanup.push(async () => rmSync(dir, { recursive: true, force: true }));

  const owner = Keypair.generate();
  const approver = Keypair.generate();
  const receiptKey = Keypair.generate(); // signs receipts and anchor_root (the mandate's gate authority)
  const seller = Keypair.generate();
  const voucherGate = new LocalEd25519Signer(randomBytes(32)); // the API's gate key; the signer trusts only it
  for (const key of [owner.publicKey, receiptKey.publicKey]) {
    const sig = await connection.requestAirdrop(key, 5 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, 'confirmed');
  }
  const usdc = await createMint(connection, owner, owner.publicKey, null, 6);
  const ownerAta = await getOrCreateAssociatedTokenAccount(connection, owner, usdc, owner.publicKey);
  await mintTo(connection, owner, usdc, ownerAta.address, owner, 100_000_000n);
  const ownerPath = join(dir, 'owner.json');
  writeFileSync(ownerPath, JSON.stringify(Array.from(owner.secretKey)), { mode: 0o600 });

  // The agent's key: in its own signer service, behind the gate.
  const signerKeys = mandateVoucherKeys(DevnetKeyring.load(join(dir, 'signer-keys.json')), [voucherGate.publicKey]);
  const signer = await startSignerService({
    signer: new GatedSignerAdapter({ inner: { name: 'unused', publicKey: '11111111111111111111111111111111', signMessage: async () => { throw new Error('unused'); }, signTransaction: async () => { throw new Error('unused'); } }, trustedInstanceKeys: [voucherGate.publicKey] }),
    voucherKeys: signerKeys,
  });
  cleanup.push(() => signer.close());

  // Owner approvals: Telegram (real when configured, else a stand-in that prints) only tells the owner;
  // the owner's wallet signs the exact payment. In this demo the owner's wallet is a local key.
  const realTelegram = telegramConfigFromEnv();
  const OWNER_CHAT = realTelegram?.ownerChatId ?? 'owner-chat';
  const shown = [];
  const standIn = async (input, init) => {
    const method = String(input).split('/').pop();
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (method === 'sendMessage') shown.push(body.text);
    return new Response(JSON.stringify({ ok: true, result: method === 'sendMessage' ? { message_id: shown.length } : [] }), { status: 200 });
  };
  const approvals = new OwnerApprovals({
    store: new InMemoryOwnerApprovalStore(),
    telegram: realTelegram ?? { token: 'stand-in', ownerChatId: OWNER_CHAT },
    clock: () => Math.floor(Date.now() / 1000),
    newId: (prefix) => `${prefix}_${randomBytes(8).toString('hex')}`,
    ...(realTelegram ? {} : { fetch: standIn }),
  });
  // The owner's wallet signs exactly the text the API hands out for this request.
  const ownerSigns = async (approvalId, wallet) => {
    const { terms } = await approvals.toSign(approvalId);
    const key = new LocalEd25519Signer(wallet.secretKey.subarray(0, 32));
    const result = await approvals.submitSignature(approvalId, { scheme: 'ed25519', signer: key.publicKey, signature: toBase58(await key.signMessage(ownerApprovalMessage(terms))) });
    return result.ok ? result.approval.status : result.reason;
  };

  // The voucher service: the API's own askChannelVoucher behind a bearer token.
  const voucherToken = randomBytes(24).toString('hex');
  const spends = new InMemoryVoucherSpendStore();
  const voucherApi = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', async () => {
      const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
      const problem = voucherTokenProblem(req.headers.authorization, voucherToken);
      if (problem) return send(problem.status, { error: problem.error });
      try {
        send(200, await askChannelVoucher(JSON.parse(Buffer.concat(chunks).toString('utf8')), { signerUrl: signer.url, instance: voucherGate, spends, approvals }));
      } catch (error) {
        send(400, { error: error instanceof Error ? error.message : 'Voucher request failed' });
      }
    });
  });
  await new Promise((resolve) => voucherApi.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise((resolve) => voucherApi.close(resolve)));
  const apiUrl = `http://127.0.0.1:${voucherApi.address().port}`;

  const atlas = sdk.createAtlasRail({
    apiUrl,
    apiToken: voucherToken,
    connection,
    wallet: sdk.keypairWallet({ path: ownerPath }),
    execution: 'autoExecute',
    expectedGenesis: validator.genesis,
    gate: receiptKey,
  });
  say(`Ready in ${ms(started)} ms. Owner, approver, seller, signer service and voucher service are up.`);
  say(realTelegram ? 'Telegram: real messages to the owner chat.' : 'Telegram: not set up, so a stand-in shows each message here.');

  // ---------- 1. mandate ----------
  started = step(1, 'The owner creates a mandate: $0.05 per call on its own, $1 per day.');
  const mandateId = `mnd_${randomBytes(10).toString('hex').toUpperCase()}`;
  const agent = await sdk.signerAgent({ signerUrl: signer.url, mandateId });
  const now = Math.floor(Date.now() / 1000);
  let mandate = createMandate({
    id: mandateId,
    nonce: randomBytes(16).toString('hex'),
    issuer: { organizationId: 'org_demo', name: 'Demo Co' },
    agent: { publicKey: agent.publicKey, label: 'Research agent' },
    delegation: { requiredApprovals: 1 },
    scope: {
      allowedNetworks: [NETWORK],
      allowedAssets: [usdc.toBase58()],
      allowedPayTo: [seller.publicKey.toBase58()],
      allowedResources: [`${API}/*`],
      limits: { mint: usdc.toBase58(), maxPerPayment: '10000000', maxPerWindow: '1000000', windowSeconds: 86_400, maxTotal: '20000000' },
      priceLimits: [],
    },
    escalation: { thresholdBaseUnits: '50000', approverRoles: ['OWNER'], resources: [], approvalTtlSeconds: 600 },
    notBefore: now - 60,
    expiresAt: now + 86_400,
  });
  const signerOf = (key) => new LocalEd25519Signer(key.secretKey.subarray(0, 32));
  mandate = await signMandate(mandate, { role: 'OWNER', signer: signerOf(owner) });
  mandate = await signMandate(mandate, { role: 'APPROVER', signer: signerOf(approver) });
  mandate = await signMandate(mandate, { role: 'AGENT', signer: agent });
  const created = await atlas.createMandate({
    owner, approver, agent,
    mandateHash: Uint8Array.from(Buffer.from(hashMandate(mandate), 'hex')),
    gateAuthority: receiptKey.publicKey.toBase58(),
    mint: usdc.toBase58(),
    maxPerPayment: 10_000_000n, maxPerWindow: 1_000_000n, windowSeconds: 86_400n, maxTotal: 20_000_000n, escalationThreshold: 50_000n,
    notBefore: BigInt(now - 60), expiresAt: BigInt(now + 86_400),
    submit: true,
  });
  say(`Signed by the owner, an independent approver, and the agent (its key stays in the signer).`);
  say(`Mandate on Solana: ${created.mandatePda ?? '—'}`);
  done(1, 'mandate', created.status === 'confirmed', started, { mandate: created.mandatePda });

  const opened = await atlas.openChannel({ payee: seller.publicKey.toBase58(), mint: usdc.toBase58(), agent: agent.publicKey, deposit: 6_000_000n, graceSeconds: 900, submit: true });
  if (opened.status !== 'confirmed') throw new Error(`Opening the channel failed: ${failText(opened)}`);
  const base = { mandate, channel: opened.channel, recipient: seller.publicKey.toBase58(), mint: usdc.toBase58(), network: NETWORK, mandateAddress: created.mandatePda };
  let total = 0n;
  const receipts = [];
  // pay() without its per-payment anchor, so step 5 can anchor all receipts in one batch.
  async function payOnce(amount, resourceUrl, extra = {}) {
    const asked = await atlas.requestPayment({ ...base, ...extra, amount: total + amount, resourceUrl, expiresAt: Math.floor(Date.now() / 1000) + 1800 });
    if (asked.status !== 'voucher_ready') return asked;
    for (const stage of [() => atlas.prepareSettlement(asked.paymentId), () => atlas.executeSettlement(asked.paymentId), () => atlas.prepareDistribution(asked.paymentId)]) {
      const r = await stage();
      if (r.status === 'failed' || r.status === 'unknown') return r;
    }
    const paid = await atlas.executeDistribution(asked.paymentId);
    if (paid.status === 'paid') { total += amount; receipts.push(paid.receipt); }
    return paid;
  }

  // ---------- 2. five payments ----------
  started = step(2, 'The agent pays the data API 5 times. Every payment is checked first.');
  let allowed = 0;
  for (let i = 1; i <= 5; i += 1) {
    const paid = await payOnce(5_000n, `${API}/report/${i}`);
    if (paid.status !== 'paid') throw new Error(`Payment ${i} failed: ${failText(paid)}`);
    allowed += 1;
    say(`Payment ${i}: ${usd(5_000)} → allowed, paid, receipt ${paid.receipt.id}`);
  }
  done(2, 'five allowed payments with receipts', allowed === 5, started, { receipts: receipts.map((r) => r.id) });

  // ---------- 3. over the limit ----------
  started = step(3, 'The agent tries to pay $5.');
  const big = await atlas.requestPayment({ ...base, amount: total + 5_000_000n, resourceUrl: `${API}/bulk`, expiresAt: Math.floor(Date.now() / 1000) + 1800 });
  const blocked = big.status === 'denied';
  say(`Blocked before anything was signed. Reason: ${big.reason ?? big.message}`);
  if (big.approvalId) {
    say(realTelegram ? 'The owner got a Telegram message asking for a wallet signature.' : `Telegram message the owner gets:\n      ${shown.at(-1).split('\n').join('\n      ')}`);
    const byStranger = await ownerSigns(big.approvalId, Keypair.generate());
    say(`A key that is not the owner's tries to approve it: ${byStranger}`);
    say('The owner does not sign, so it stays blocked; no signature means rejected. Nothing was paid.');
  }
  done(3, 'over-limit blocked, owner asked', blocked && Boolean(big.approvalId), started, { reason: big.reason ?? null });

  // ---------- 4. unusual payment ----------
  started = step(4, 'The agent makes an unusual payment: $0.04, inside every limit.');
  const odd = await payOnce(40_000n, `${API}/report/odd`);
  say(`Flagged by the behaviour check: ${odd.reason ?? odd.message ?? failText(odd)}`);
  let flaggedOk = odd.status === 'denied' && Boolean(odd.approvalId);
  if (flaggedOk) {
    const status = await ownerSigns(odd.approvalId, owner);
    say(`The owner's wallet signed this exact payment → ${status}.`);
    if (status === 'APPROVED') {
      const paid = await payOnce(40_000n, `${API}/report/odd`, { approvalId: odd.approvalId });
      flaggedOk = paid.status === 'paid' && paid.receipt.decision.record.context.review?.reason === odd.reason;
      say(paid.status === 'paid' ? `Paid once with the owner's OK. The receipt says why: "${paid.receipt.decision.record.context.review?.reason}"` : `Not paid: ${failText(paid)}`);
    }
  }
  done(4, 'unusual payment flagged with a reason', flaggedOk, started, { reason: odd.reason ?? null });

  // ---------- 5. anchor ----------
  started = step(5, 'All receipts are anchored on Solana in one transaction.');
  const anchored = await atlas.anchorVouchers(created.mandatePda);
  let anchorOk = anchored.status === 'anchored';
  if (anchorOk) {
    const tx = await connection.getTransaction(anchored.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    const keys = tx.transaction.message.staticAccountKeys.map((k) => k.toBase58());
    const noMemo = !keys.includes('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
    const rootAccount = decodeRootAccount((await connection.getAccountInfo(new PublicKey(anchored.rootPda), 'confirmed')).data);
    anchorOk = noMemo && rootAccount.leafCount === receipts.length && rootAccount.merkleRoot === anchored.merkleRoot && Boolean(rootAccount.batchHeader && rootAccount.batchFileHash);
    say(`1 transaction, ${tx.transaction.message.compiledInstructions.length} instruction, no memo: ${noMemo ? 'yes' : 'NO'}`);
    say(`Stored on-chain: root ${rootAccount.merkleRoot.slice(0, 16)}…, ${rootAccount.leafCount} receipts, batch header and file hashes`);
  }
  done(5, 'one anchor, no memo', anchorOk, started, { leafCount: anchored.leafCount ?? null });

  // ---------- 6. verify ----------
  started = step(6, 'Anyone can check a receipt against the chain, without trusting us.');
  const chain = Web3ChainClient.fromUrl(validator.rpcUrl);
  const stored = receipts[0];
  const pass = await verifyReceipt(stored, { chain, trustedInstanceKeys: [receiptKey.publicKey.toBase58()], requireAnchor: true });
  const tampered = JSON.parse(JSON.stringify(stored));
  tampered.offer.amount = String(Number(tampered.offer.amount) + 1); // one byte changed
  const fail = await verifyReceipt(tampered, { chain, trustedInstanceKeys: [receiptKey.publicKey.toBase58()], requireAnchor: true });
  say(`Receipt ${stored.id}: ${pass.pass ? 'PASS' : 'FAIL'} (${pass.checks.filter((c) => c.status === 'PASS').length} checks, including the anchor and the settlement on Solana)`);
  say(`Same receipt with the amount changed by 1: ${fail.pass ? 'PASS' : 'FAIL'} (${fail.checks.find((c) => c.status === 'FAIL')?.title})`);
  done(6, 'verify PASS, tampered FAIL', pass.pass && !fail.pass, started);

  // ---------- 7. top-up ----------
  started = step(7, 'A second channel runs low. The agent pauses; only the owner can top up.');
  const small = await atlas.openChannel({ payee: seller.publicKey.toBase58(), mint: usdc.toBase58(), agent: agent.publicKey, deposit: 10_000n, graceSeconds: 900, submit: true });
  const lowBase = { ...base, channel: small.channel };
  const first = await atlas.pay({ ...lowBase, amount: 5_000n, resourceUrl: `${API}/report/6`, expiresAt: Math.floor(Date.now() / 1000) + 1800 });
  const paused = await atlas.pay({ ...lowBase, amount: 15_000n, resourceUrl: `${API}/report/7`, expiresAt: Math.floor(Date.now() / 1000) + 1800 });
  say(`Payment after ${usd(5_000)}: ${paused.status} → ${usd(paused.remaining ?? 0)} left, ${usd(paused.needed ?? 0)} needed. The agent does not top up.`);
  const topped = await atlas.topUp({ channel: small.channel, amount: 20_000n, submit: true });
  say(`Owner tops up ${usd(20_000)}: deposit ${usd(topped.depositBefore ?? 0)} → ${usd(topped.depositAfter ?? 0)}`);
  const resumed = await atlas.pay({ ...lowBase, amount: 15_000n, resourceUrl: `${API}/report/7`, expiresAt: Math.floor(Date.now() / 1000) + 1800 });
  say(`Agent continues: ${resumed.status}`);
  done(7, 'pause, owner top-up, continue', first.status === 'paid' && paused.status === 'needs_top_up' && topped.status === 'confirmed' && resumed.status === 'paid', started);

  const totalMs = ms(startedAll);
  console.log(`\nAll 7 steps passed in ${(totalMs / 1000).toFixed(1)} s on a local Solana validator.`);
  if (JSON_OUT) console.log(JSON.stringify({ ok: true, totalMs, results }));
  await shutdown();
  process.exit(0);
} catch (error) {
  console.error(`\nDemo stopped: ${error instanceof Error ? error.message : String(error)}`);
  if (JSON_OUT) console.log(JSON.stringify({ ok: false, totalMs: ms(startedAll), results, error: error instanceof Error ? error.message : String(error) }));
  await shutdown();
  process.exit(1);
}
