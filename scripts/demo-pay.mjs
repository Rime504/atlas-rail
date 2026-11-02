#!/usr/bin/env node
/**
 * pnpm demo:pay — Atlas Rail as the pay.sh spending authority, with the real pay MCP `curl` tool
 * (solana-foundation/pay PR #514, built in integrations/pay-sh-host).
 *
 *   A. a normal payment: allowed, paid, receipt anchored, verify PASS
 *   B. over the limit: refused, the owner is asked, no payment
 *   C. an unknown recipient: denied
 *   D. over the limit, the owner approves, retry: paid once; a later retry is refused
 *   E. the Atlas endpoint is down: pay does not pay
 *   F. a slow answer past pay's deadline: pay does not pay
 *   G. the same operation twice at the same time: one payment
 *
 * --cluster local (default): a local validator with the same programs as Devnet.
 * --cluster devnet: real Devnet; needs SOL in ~/.atlas-pay-demo/funder.json. Devnet still runs the
 *   mandate program without anchor_root_v2, so receipts are anchored with the old anchor_root.
 * --runs N repeats the whole set. --report writes reports/pay-authority-<cluster>-<date>.json.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { startLocalValidator } from './local-validator.mjs';
import { DEVNET_CAIP2, startMerchant } from './pay-merchant.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const CLUSTER = arg('--cluster', 'local');
const RUNS = Number(arg('--runs', '1'));
const REPORT = process.argv.includes('--report');
const BENCH = Number(arg('--bench', '0'));
process.env.ATLAS_ALLOW_MOCK_SIGNER = 'true';

// Build what the demo runs, every time. Turbo only rebuilds what changed, so this takes a few
// seconds; skipping it when `dist` exists would run code compiled on another branch after a checkout.
console.log('Checking the build…');
const build = spawnSync('pnpm', ['turbo', 'run', 'build', '--filter=atlasrails...', '--filter=@atlas-rail/api...'], { cwd: root, stdio: 'ignore' });
if (build.status !== 0) throw new Error('Build failed. Run `pnpm build` to see why.');
const HOST = join(root, 'integrations/pay-sh-host/target/release/atlas-pay-host');
if (!existsSync(HOST)) {
  console.log('Building the pay.sh host (first run only, several minutes)…');
  const build = spawnSync('cargo', ['build', '--release', '--manifest-path', join(root, 'integrations/pay-sh-host/Cargo.toml')], { stdio: 'inherit' });
  if (build.status !== 0) throw new Error('Building integrations/pay-sh-host failed');
}
const requireApi = createRequire(join(root, 'apps/api/package.json'));
const requireAtlas = createRequire(join(root, 'packages/atlasrails/package.json'));
const { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, VersionedTransaction, sendAndConfirmTransaction } = requireAtlas('@solana/web3.js');
const { createMint, getOrCreateAssociatedTokenAccount, mintTo } = requireAtlas('@solana/spl-token');
const { createMandate, hashMandate, LocalEd25519Signer, ownerApprovalMessage, signMandate, toBase58 } = requireApi('@atlas-rail/mandate');
const { DevnetKeypairSigner, Web3ChainClient, buildCreateMandateTransaction } = requireApi('@atlas-rail/solana');
const { InMemoryOwnerApprovalStore, InMemoryPayOperationStore, InMemoryVoucherSpendStore } = requireApi('@atlas-rail/database');
const { AnchorService, InMemoryDecisionReceiptStore, verifyDecisionReceipt } = requireApi('@atlas-rail/receipt');
const { PayAuthority, operationKey } = requireApi(join(root, 'apps/api/dist/agent/pay-authority.js'));
const { OwnerApprovals } = requireApi(join(root, 'apps/api/dist/agent/owner-approvals.js'));
const { readMandateAccount } = requireApi(join(root, 'apps/api/dist/agent/channel-voucher.js'));

const ms = (t) => Math.round(performance.now() - t);

/** Runs calls through the real pay curl tool on one MCP connection. */
function host(args, calls) {
  return new Promise((resolve, reject) => {
    // pay's x402 client reads its RPC from PAY_RPC_URL, not from the host's override.
    const rpc = args.includes('--rpc') ? args[args.indexOf('--rpc') + 1] : undefined;
    const child = spawn(HOST, args, { stdio: ['pipe', 'pipe', 'pipe'], env: rpc ? { ...process.env, PAY_RPC_URL: rpc } : process.env });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (err += c));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`atlas-pay-host exited ${code}: ${err.slice(-400)}`));
      resolve(out.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)));
    });
    child.stdin.end(JSON.stringify(calls));
  });
}
const outcome = (r) => {
  const text = JSON.stringify(r.result ?? r.error ?? '');
  for (const code of ['REJECTED_BEFORE_EXECUTION', 'OPERATION_ALREADY_STARTED', 'OPERATION_CONFLICT', 'DENIED', 'UNAVAILABLE', 'TIMEOUT']) if (text.includes(code)) return code;
  return r.is_error ? 'ERROR' : 'PAID';
};

async function oneRun(run, env) {
  const { connection, funder, rpcUrl, legacy } = env;
  const results = [];
  const t0 = performance.now();
  const record = (scene, ok, detail) => {
    results.push({ scene, ok, ...detail });
    console.log(`   ${ok ? 'OK    ' : 'FAILED'} ${scene}${detail.note ? ` — ${detail.note}` : ''}`);
  };
  const dir = mkdtempSync(join(tmpdir(), 'atlas-pay-'));
  const accounts = join(dir, 'accounts.yml');
  const payer = new PublicKey(JSON.parse(spawnSync(HOST, ['payer', '--accounts', accounts], { encoding: 'utf8' }).stdout).payer);

  // Keys for this run. The Atlas instance key decides, signs and anchors (the mandate's gate authority).
  const owner = Keypair.generate();
  const approver = Keypair.generate();
  const agent = Keypair.generate();
  const merchantKey = Keypair.generate();
  const seller = Keypair.generate();
  const stranger = Keypair.generate();
  const instance = new DevnetKeypairSigner(Uint8Array.from(randomBytes(32)));
  const fund = new Transaction();
  for (const [to, sol] of [[owner.publicKey, 0.05], [merchantKey.publicKey, 0.08], [new PublicKey(instance.publicKey), 0.03]]) {
    fund.add(SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: to, lamports: Math.round(sol * LAMPORTS_PER_SOL) }));
  }
  await sendAndConfirmTransaction(connection, fund, [funder], { commitment: 'confirmed' });
  const mint = await createMint(connection, merchantKey, merchantKey.publicKey, null, 6);
  const payerAta = await getOrCreateAssociatedTokenAccount(connection, merchantKey, mint, payer);
  await mintTo(connection, merchantKey, mint, payerAta.address, merchantKey, 10_000_000n);
  for (const to of [seller.publicKey, stranger.publicKey]) await getOrCreateAssociatedTokenAccount(connection, merchantKey, mint, to);

  const merchant = await startMerchant({ rpcUrl, mint: mint.toBase58(), feePayer: merchantKey, defaultRecipient: seller.publicKey.toBase58() });
  const now = Math.floor(Date.now() / 1000);
  let mandate = createMandate({
    id: `mnd_${randomBytes(10).toString('hex').toUpperCase()}`,
    nonce: randomBytes(16).toString('hex'),
    issuer: { organizationId: 'org_pay_demo', name: 'pay.sh demo' },
    agent: { publicKey: agent.publicKey.toBase58(), label: 'pay.sh agent' },
    delegation: { requiredApprovals: 1 },
    scope: {
      allowedNetworks: [DEVNET_CAIP2],
      allowedAssets: [mint.toBase58()],
      allowedPayTo: [seller.publicKey.toBase58()],
      allowedResources: [`${merchant.url}/*`],
      limits: { mint: mint.toBase58(), maxPerPayment: '1000000', maxPerWindow: '1000000', windowSeconds: 86_400, maxTotal: '5000000' },
      priceLimits: [],
    },
    escalation: { thresholdBaseUnits: '50000', approverRoles: ['OWNER'], resources: [], approvalTtlSeconds: 600 },
    notBefore: now - 60,
    expiresAt: now + 86_400,
  });
  const signerOf = (k) => new LocalEd25519Signer(k.secretKey.subarray(0, 32));
  mandate = await signMandate(mandate, { role: 'OWNER', signer: signerOf(owner) });
  mandate = await signMandate(mandate, { role: 'APPROVER', signer: signerOf(approver) });
  mandate = await signMandate(mandate, { role: 'AGENT', signer: signerOf(agent) });
  const mandateHash = hashMandate(mandate);
  const unsigned = buildCreateMandateTransaction({
    programId: 'CnGoTE5Bxc8MFGaeK5LDv5uAZ7pNiktMunYy8JZcLY4k', mandateHash: Buffer.from(mandateHash, 'hex'), gateAuthority: instance.publicKey,
    mint: mint.toBase58(), maxPerPayment: 1_000_000n, maxPerWindow: 1_000_000n, windowSeconds: 86_400n, maxTotal: 5_000_000n, escalationThreshold: 50_000n,
    notBefore: BigInt(now - 60), expiresAt: BigInt(now + 86_400), owner: owner.publicKey.toBase58(), approver: approver.publicKey.toBase58(), agent: agent.publicKey.toBase58(),
    recentBlockhash: (await connection.getLatestBlockhash('confirmed')).blockhash,
  });
  const createTx = VersionedTransaction.deserialize(Buffer.from(unsigned, 'base64'));
  createTx.sign([owner, approver, agent]);
  await connection.confirmTransaction(await connection.sendRawTransaction(createTx.serialize()), 'confirmed');

  // Atlas Rail's authority, in memory for the demo; the API runs the same class on Postgres.
  const approvals = new OwnerApprovals({
    store: new InMemoryOwnerApprovalStore(), telegram: { token: 'stand-in', ownerChatId: 'owner' }, clock: () => Math.floor(Date.now() / 1000),
    newId: (p) => `${p}_${randomBytes(6).toString('hex')}`,
    fetch: async (input) => new Response(JSON.stringify({ ok: true, result: String(input).endsWith('sendMessage') ? { message_id: 1 } : true })),
  });
  const operations = new InMemoryPayOperationStore();
  const decisionReceipts = new InMemoryDecisionReceiptStore();
  // The speed test moves this clock 7 s per request, so the burst rule (10 in 60 s) stays quiet.
  let skew = 0;
  const authority = new PayAuthority({
    callers: async (id) => (id === 'research-agent' ? { mandate } : null),
    instance,
    spends: new InMemoryVoucherSpendStore(),
    operations,
    saveReceipt: (r) => decisionReceipts.insert(r),
    approvals,
    readMandate: readMandateAccount,
    clock: () => Math.floor(Date.now() / 1000) + skew,
    newId: (p) => `${p}_${randomBytes(8).toString('hex')}`,
  });
  const latencies = [];
  let captured = null;
  const atlas = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const t = performance.now();
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      captured ??= body;
      const answer = await authority.authorize(body);
      latencies.push(performance.now() - t);
      const delay = Number(new URL(req.url, 'http://x').searchParams.get('delay') ?? 0);
      setTimeout(() => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(answer)); }, delay);
    });
  });
  await new Promise((r) => atlas.listen(0, '127.0.0.1', r));
  const authorityUrl = `http://127.0.0.1:${atlas.address().port}/v1/pay-authority/authorize`;
  const hostArgs = (authorityAt = authorityUrl, extra = []) => ['run', '--accounts', accounts, '--authority', authorityAt, '--caller', 'research-agent', '--rpc', rpcUrl, ...extra];
  const op = (name) => `run${run}-${name}`;
  const paid = () => merchant.state.paid;

  try {
    // A. normal
    let before = paid();
    const [a] = await host(hostArgs(), [{ label: 'A', url: `${merchant.url}/data?price=10000`, method: 'GET', operation_id: op('a') }]);
    record('A normal payment: allowed and paid', outcome(a) === 'PAID' && paid() === before + 1, { note: `${a.ms} ms through pay`, signature: merchant.state.signatures.at(-1) });

    // B. over the limit: the owner is asked; nothing is paid.
    before = paid();
    const [b] = await host(hostArgs(), [{ label: 'B', url: `${merchant.url}/data?price=200000`, method: 'GET', operation_id: op('b') }]);
    record('B over the limit: refused, owner asked', outcome(b) === 'REJECTED_BEFORE_EXECUTION' && paid() === before, { note: 'needs owner approval' });

    // C. unknown recipient
    before = paid();
    const [c] = await host(hostArgs(), [{ label: 'C', url: `${merchant.url}/data?price=10000&to=${stranger.publicKey.toBase58()}`, method: 'GET', operation_id: op('c') }]);
    record('C unknown recipient: denied', outcome(c) === 'DENIED' && paid() === before, { note: "recipient is not on the mandate's list" });

    // D. over the limit, the owner signs, and the agent retries on the same pay connection.
    // One host connection runs D1, holds D2 for 4 s while the owner's wallet signs (below), then D3.
    // D4 is a fresh pay process (pay's own guard is empty there): Atlas alone must refuse it.
    before = paid();
    const dUrl = `${merchant.url}/data?price=200000&d=1`;
    const ownerSigns = (async () => {
      for (let i = 0; i < 300; i += 1) {
        const waiting = await operations.get(operationKey('research-agent', op('d')));
        if (waiting?.approvalId) {
          const found = await approvals.toSign(waiting.approvalId);
          if (!found) return false;
          const signature = toBase58(await signerOf(owner).signMessage(ownerApprovalMessage(found.terms)));
          const signed = await approvals.submitSignature(waiting.approvalId, { scheme: 'ed25519', signer: owner.publicKey.toBase58(), signature });
          return signed.ok;
        }
        await new Promise((r) => setTimeout(r, 10));
      }
      return false;
    })();
    const [[d1, d2, d3], signed] = await Promise.all([
      host(hostArgs(), [
        { label: 'D1', url: dUrl, method: 'GET', operation_id: op('d') },
        { label: 'D2', url: dUrl, method: 'GET', operation_id: op('d'), wait_ms: 4000 },
        { label: 'D3', url: dUrl, method: 'GET', operation_id: op('d') },
      ]),
      ownerSigns,
    ]);
    const [d4] = await host(hostArgs(), [{ label: 'D4', url: dUrl, method: 'GET', operation_id: op('d') }]);
    record('D owner signs, retry: paid once', signed && outcome(d1) === 'REJECTED_BEFORE_EXECUTION' && outcome(d2) === 'PAID' && outcome(d3) !== 'PAID' && outcome(d4) === 'DENIED' && paid() === before + 1, {
      note: `first ${outcome(d1)}, after the signature ${outcome(d2)}, again ${outcome(d3)}, new pay process ${outcome(d4)}`,
    });

    // E. Atlas is down
    before = paid();
    const [e] = await host(hostArgs('http://127.0.0.1:9/v1/pay-authority/authorize'), [{ label: 'E', url: `${merchant.url}/data?price=10000&e=1`, method: 'GET', operation_id: op('e') }]);
    record('E Atlas endpoint down: no payment', outcome(e) === 'UNAVAILABLE' && paid() === before, { note: outcome(e) });

    // F. slow answer past pay's deadline (deadline 1.5 s, answer after 3 s)
    before = paid();
    const [f] = await host(hostArgs(`${authorityUrl}?delay=3000`, ['--timeout-ms', '1500']), [{ label: 'F', url: `${merchant.url}/data?price=10000&f=1`, method: 'GET', operation_id: op('f') }]);
    record('F slow answer past the deadline: no payment', outcome(f) === 'TIMEOUT' && paid() === before, { note: outcome(f) });

    // G. same operation twice at the same time: on one connection, and from two pay processes.
    before = paid();
    const gUrl = `${merchant.url}/data?price=10000&g=1`;
    const [g1, g2] = await host(hostArgs(), [{ label: 'G1', url: gUrl, method: 'GET', operation_id: op('g'), group: 1 }, { label: 'G2', url: gUrl, method: 'GET', operation_id: op('g'), group: 1 }]);
    const hUrl = `${gUrl}&h=1`;
    const [[h1], [h2]] = await Promise.all([
      host(hostArgs(), [{ label: 'H1', url: hUrl, method: 'GET', operation_id: op('h') }]),
      host(hostArgs(), [{ label: 'H2', url: hUrl, method: 'GET', operation_id: op('h') }]),
    ]);
    const okG = [g1, g2].filter((r) => outcome(r) === 'PAID').length === 1 && [h1, h2].filter((r) => outcome(r) === 'PAID').length === 1;
    record('G same operation twice at once: one payment', okG && paid() === before + 2, { note: `one connection: ${outcome(g1)} + ${outcome(g2)}; two processes: ${outcome(h1)} + ${outcome(h2)}` });

    // Anchor every decision receipt in one transaction, then verify one from the chain.
    const anchorer = new AnchorService({
      receipts: decisionReceipts.asAnchorStore(), chain: Web3ChainClient.fromUrl(rpcUrl), signer: instance, clock: () => Math.floor(Date.now() / 1000),
      newId: (p) => `${p}_${randomBytes(6).toString('hex')}`, rpcUrl, legacyAnchorInstruction: legacy,
    });
    const anchored = await anchorer.run();
    const receipts = await decisionReceipts.list(1000);
    const allowReceipt = receipts.find((r) => r.answer.operation_id === op('a'));
    const chain = Web3ChainClient.fromUrl(rpcUrl);
    const pass = await verifyDecisionReceipt(allowReceipt, { chain, trustedInstanceKeys: [instance.publicKey], requireAnchor: true });
    const tampered = JSON.parse(JSON.stringify(allowReceipt));
    tampered.answer.reason = `${tampered.answer.reason} `;
    const fail = await verifyDecisionReceipt(tampered, { chain, trustedInstanceKeys: [instance.publicKey], requireAnchor: true });
    record('Receipts anchored; verify PASS, one byte changed FAIL', Boolean(anchored) && pass.pass && !fail.pass, {
      note: `${receipts.length} decisions (allow and deny) in one anchor ${anchored?.batch.txSignature?.slice(0, 12) ?? '—'}…`,
      anchorSignature: anchored?.batch.txSignature ?? null, receipts: receipts.length,
    });

    // Speed: the first request pay really sent, replayed as N new operations of 1 base unit each,
    // over HTTP to the same endpoint. Each answer includes the mandate read on the RPC and every gate
    // rule; the clock moves 7 s per request so these are normal paced payments, not a burst.
    let speed = null;
    if (BENCH > 0 && run === 1 && captured) {
      const times = [];
      let allowed = 0;
      for (let i = 0; i < BENCH; i += 1) {
        skew += 7;
        const body = { ...captured, operation_id: `speed-${i}`, attempt_id: randomUUID(), amount_atomic: '1', accepted: { ...captured.accepted, amount: '1' } };
        const t = performance.now();
        const response = await fetch(authorityUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        const answer = await response.json();
        times.push(performance.now() - t);
        if (answer.decision === 'allow') allowed += 1;
      }
      times.sort((x, y) => x - y);
      const at = (q) => Math.round(times[Math.min(times.length - 1, Math.floor(q * times.length))] * 10) / 10;
      speed = { requests: BENCH, allowed, medianMs: at(0.5), p95Ms: at(0.95), slowestMs: Math.round(times.at(-1) * 10) / 10 };
      console.log(`   Speed: ${BENCH} answers, ${allowed} allowed. Median ${speed.medianMs} ms, p95 ${speed.p95Ms} ms, slowest ${speed.slowestMs} ms.`);
    }

    const sorted = [...latencies].sort((x, y) => x - y);
    return { run, ok: results.every((r) => r.ok), ms: ms(t0), results, payments: merchant.state.signatures, authorityMs: { median: sorted[Math.floor(sorted.length / 2)], max: sorted.at(-1) }, speed };
  } finally {
    await merchant.close();
    await new Promise((r) => atlas.close(r));
    rmSync(dir, { recursive: true, force: true });
  }
}

const runs = [];
let validator = null;
try {
  let env;
  if (CLUSTER === 'devnet') {
    const path = join(homedir(), '.atlas-pay-demo/funder.json');
    if (!existsSync(path)) throw new Error('Put a funded Devnet key at ~/.atlas-pay-demo/funder.json');
    const funder = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))));
    env = { connection: new Connection('https://api.devnet.solana.com', 'confirmed'), funder, rpcUrl: 'https://api.devnet.solana.com', legacy: true };
  } else {
    validator = await startLocalValidator();
    const connection = new Connection(validator.rpcUrl, 'confirmed');
    const funder = Keypair.generate();
    await connection.confirmTransaction(await connection.requestAirdrop(funder.publicKey, 20 * LAMPORTS_PER_SOL), 'confirmed');
    env = { connection, funder, rpcUrl: validator.rpcUrl, legacy: false };
  }
  process.env.SOLANA_RPC_URL = env.rpcUrl;
  for (let run = 1; run <= RUNS; run += 1) {
    console.log(`\nRun ${run} of ${RUNS} on ${CLUSTER}:`);
    try {
      runs.push(await oneRun(run, env));
    } catch (error) {
      console.log(`   FAILED run ${run}: ${error instanceof Error ? error.message : String(error)}`);
      runs.push({ run, ok: false, ms: 0, error: error instanceof Error ? error.message : String(error) });
    }
  }
} finally {
  await validator?.stop();
}
const passed = runs.filter((r) => r.ok).length;
console.log(`\n${passed} of ${runs.length} runs passed. Slowest run ${Math.max(...runs.map((r) => r.ms))} ms.`);
if (REPORT) {
  mkdirSync(join(root, 'reports'), { recursive: true });
  const file = join(root, 'reports', `pay-authority-${CLUSTER}-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(file, `${JSON.stringify({ generatedAt: new Date().toISOString(), cluster: CLUSTER, pay: 'solana-foundation/pay PR #514 @ 898135e', passed, runs }, null, 2)}\n`);
  console.log(`Report: ${file}`);
}
process.exit(passed === runs.length ? 0 : 1);
