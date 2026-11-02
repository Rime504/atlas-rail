/**
 * Settle, drain, pause, top up, continue — on a local validator with the real payment-channels
 * program (copied from Devnet) and this repo's Atlas Mandate program.
 * Run: pnpm test:chain (node --test --test-force-exit scripts/topup-local.test.mjs)
 * A settle the channel program rejects fails this test, so a change like the 22 Oct third settle
 * account cannot break payments without anyone noticing.
 * Uses in-process agent and gate keys, which is the test-only path of createAtlasRail.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startLocalValidator } from './local-validator.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const requireAtlas = createRequire(join(root, 'packages/atlasrails/package.json'));
const requireMandate = createRequire(join(root, 'packages/mandate/package.json'));
const { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction } = requireAtlas('@solana/web3.js');
const { createMint, getOrCreateAssociatedTokenAccount, mintTo, getAssociatedTokenAddressSync } = requireAtlas('@solana/spl-token');
const { createMandate, hashMandate, LocalEd25519Signer, signMandate } = requireMandate('@atlas-rail/mandate');
const sdk = await import(pathToFileURL(join(root, 'packages/atlasrails/dist/index.js')).href);
const { buildTopUpInstruction } = await import(pathToFileURL(join(root, 'packages/atlasrails/dist/channel-flow.js')).href);

const NETWORK = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
let validator;

before(async () => {
  validator = await startLocalValidator();
});

after(async () => {
  await validator?.stop();
});

const show = (value) => JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));

function messageSigner(keypair) {
  return new LocalEd25519Signer(keypair.secretKey.subarray(0, 32));
}

async function airdrop(connection, key, sol = 5) {
  const signature = await connection.requestAirdrop(key, sol * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(signature, 'confirmed');
}

test('agent pauses with needs_top_up, cannot top up itself, and continues after the owner tops up', async () => {
  const connection = new Connection(validator.rpcUrl, 'confirmed');
  const owner = Keypair.generate();
  const approver = Keypair.generate();
  const agent = Keypair.generate();
  const gate = Keypair.generate();
  const payee = Keypair.generate();
  await Promise.all([owner, gate, agent].map((key) => airdrop(connection, key.publicKey)));

  const mint = await createMint(connection, owner, owner.publicKey, null, 6);
  const ownerAta = await getOrCreateAssociatedTokenAccount(connection, owner, mint, owner.publicKey);
  await mintTo(connection, owner, mint, ownerAta.address, owner, 1_000_000n);

  const dir = mkdtempSync(join(tmpdir(), 'atlas-topup-'));
  const ownerPath = join(dir, 'owner.json');
  writeFileSync(ownerPath, JSON.stringify(Array.from(owner.secretKey)), { mode: 0o600 });

  const now = Math.floor(Date.now() / 1000);
  const resourceUrl = 'http://localhost/research';
  let mandate = createMandate({
    id: `mnd_${randomBytes(10).toString('hex').toUpperCase()}`,
    nonce: randomBytes(16).toString('hex'),
    issuer: { organizationId: 'org_topup_test', name: 'Top-up test' },
    agent: { publicKey: agent.publicKey.toBase58(), label: 'Top-up agent' },
    delegation: { requiredApprovals: 1 },
    scope: {
      allowedNetworks: [NETWORK],
      allowedAssets: [mint.toBase58()],
      allowedPayTo: [payee.publicKey.toBase58()],
      allowedResources: [resourceUrl],
      limits: { mint: mint.toBase58(), maxPerPayment: '1000', maxPerWindow: '100000', windowSeconds: 3600, maxTotal: '100000' },
      priceLimits: [],
    },
    escalation: { thresholdBaseUnits: '1000', approverRoles: ['OWNER'], resources: [], approvalTtlSeconds: 600 },
    notBefore: now - 60,
    expiresAt: now + 86_400,
  });
  mandate = await signMandate(mandate, { role: 'OWNER', signer: messageSigner(owner) });
  mandate = await signMandate(mandate, { role: 'APPROVER', signer: messageSigner(approver) });
  mandate = await signMandate(mandate, { role: 'AGENT', signer: messageSigner(agent) });

  const atlas = sdk.createAtlasRail({
    apiUrl: 'http://127.0.0.1:9',
    connection,
    wallet: sdk.keypairWallet({ path: ownerPath }),
    execution: 'autoExecute',
    expectedGenesis: validator.genesis,
    agent,
    gate,
  });

  const created = await atlas.createMandate({
    owner, approver, agent,
    mandateHash: Uint8Array.from(Buffer.from(hashMandate(mandate), 'hex')),
    gateAuthority: gate.publicKey.toBase58(),
    mint: mint.toBase58(),
    maxPerPayment: 1000n, maxPerWindow: 100_000n, windowSeconds: 3600n, maxTotal: 100_000n, escalationThreshold: 1000n,
    notBefore: BigInt(now - 60), expiresAt: BigInt(now + 86_400),
    submit: true,
  });
  assert.equal(created.status, 'confirmed', show(created));

  const opened = await atlas.openChannel({ payee: payee.publicKey.toBase58(), mint: mint.toBase58(), agent: agent.publicKey.toBase58(), deposit: 1500n, graceSeconds: 900, submit: true });
  assert.equal(opened.status, 'confirmed', show(opened));
  const payment = {
    mandate, channel: opened.channel, recipient: payee.publicKey.toBase58(), mint: mint.toBase58(),
    resourceUrl, network: NETWORK, expiresAt: now + 3000, mandateAddress: created.mandatePda,
  };

  const first = await atlas.pay({ ...payment, amount: 800n });
  assert.equal(first.status, 'paid', show(first.error ?? first));

  // The real channel program accepted settle with exactly two accounts; the mandate rides read-only
  // on the Ed25519 signature check, so the mandate address still finds the settle transaction.
  const settleTx = await connection.getTransaction(first.settleSignature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
  const keys = settleTx.transaction.message.staticAccountKeys ?? settleTx.transaction.message.accountKeys;
  const [verifyIx, settleIx] = settleTx.transaction.message.compiledInstructions ?? settleTx.transaction.message.instructions;
  assert.equal(keys[settleIx.programIdIndex].toBase58(), 'CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX');
  assert.equal((settleIx.accountKeyIndexes ?? settleIx.accounts).length, 2, 'settle takes exactly two accounts');
  assert.deepEqual((verifyIx.accountKeyIndexes ?? verifyIx.accounts).map((i) => keys[i].toBase58()), [created.mandatePda]);
  const cited = await connection.getSignaturesForAddress(new PublicKey(created.mandatePda), {}, 'confirmed');
  assert.ok(cited.some((row) => row.signature === first.settleSignature), 'mandate address lists the settle transaction');

  // 1600 is above the 1500 deposit: the agent stops and says how much the owner must add.
  const paused = await atlas.pay({ ...payment, amount: 1600n });
  assert.equal(paused.status, 'needs_top_up');
  assert.equal(paused.remaining, '700');
  assert.equal(paused.needed, '100');
  const channelAccount = await connection.getAccountInfo(new PublicKey(opened.channel), 'confirmed');
  assert.equal(Buffer.from(channelAccount.data).readBigUInt64LE(12), 1500n, 'nothing topped up the channel');

  // The agent is not the channel payer: the SDK refuses, and so does the program itself.
  const agentPath = join(dir, 'agent.json');
  writeFileSync(agentPath, JSON.stringify(Array.from(agent.secretKey)), { mode: 0o600 });
  const asAgent = sdk.createAtlasRail({ apiUrl: 'http://127.0.0.1:9', connection, wallet: sdk.keypairWallet({ path: agentPath }), execution: 'autoExecute', expectedGenesis: validator.genesis });
  const refused = await asAgent.topUp({ channel: opened.channel, amount: 1000n, submit: true });
  assert.equal(refused.status, 'failed');
  assert.match(refused.error.message, /Only the channel payer/);
  const agentAta = await getOrCreateAssociatedTokenAccount(connection, agent, mint, agent.publicKey);
  await mintTo(connection, owner, mint, agentAta.address, owner, 1000n);
  const raw = new Transaction().add(buildTopUpInstruction({
    payer: agent.publicKey, channel: new PublicKey(opened.channel), payerAta: agentAta.address,
    escrow: getAssociatedTokenAddressSync(mint, new PublicKey(opened.channel), true), mint, amount: 1000n,
  }));
  await assert.rejects(connection.sendTransaction(raw, [agent]), /custom program error|invalid/i);

  const topped = await atlas.topUp({ channel: opened.channel, amount: 1000n, submit: true });
  assert.equal(topped.status, 'confirmed', show(topped));
  assert.equal(topped.depositBefore, '1500');
  assert.equal(topped.depositAfter, '2500');

  const resumed = await atlas.pay({ ...payment, amount: 1600n });
  assert.equal(resumed.status, 'paid', show(resumed.error ?? resumed));

  // The owner can also top up from the command line. Without --yes nothing is sent.
  const cli = (extra) => spawnSync(process.execPath, [join(root, 'apps/cli/dist/main.js'), 'top-up', '--channel', opened.channel, '--amount', '1000', '--keypair', ownerPath, '--rpc', validator.rpcUrl, '--genesis', validator.genesis, ...extra], { encoding: 'utf8' });
  const planned = cli([]);
  assert.equal(planned.status, 0, planned.stdout + planned.stderr);
  assert.match(planned.stdout, /Nothing was sent/);
  const sent = cli(['--yes']);
  assert.equal(sent.status, 0, sent.stdout + sent.stderr);
  assert.match(sent.stdout, /Deposit 2500 → 3500/);
  const byAgent = spawnSync(process.execPath, [join(root, 'apps/cli/dist/main.js'), 'top-up', '--channel', opened.channel, '--amount', '1000', '--keypair', agentPath, '--rpc', validator.rpcUrl, '--genesis', validator.genesis, '--yes'], { encoding: 'utf8' });
  assert.equal(byAgent.status, 1);
  assert.match(byAgent.stdout, /Only the channel payer/);
});
