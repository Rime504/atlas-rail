/**
 * Devnet run: package create_mandate, escrow deposit, deny/allow vouchers, settle, anchor_root.
 * Does not touch the recovery channel or the saved evidence channel.
 *
 *   node scripts/devnet-mandate-package.mjs --execute
 */
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { serviceEnv } from './launch-voucher-services.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const requireAtlas = createRequire(join(root, 'packages/atlasrails/package.json'));
const requireX402 = createRequire(join(root, 'packages/x402-client/package.json'));
const requireMandate = createRequire(join(root, 'packages/mandate/package.json'));
const requireReceipt = createRequire(join(root, 'packages/receipt/package.json'));
const { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction } = requireAtlas('@solana/web3.js');
const { getAssociatedTokenAddressSync } = requireAtlas('@solana/spl-token');
const { encodeVoucherMessage, GatedSignerAdapter, MandateDeniedError, VoucherAuthorizer } = requireX402('@atlas-rail/x402');
const { ed25519 } = requireMandate('@noble/curves/ed25519');
const { DevnetKeypairSigner } = requireAtlas('@atlas-rail/solana');
const {
  createMandate,
  hashMandate,
  LocalEd25519Signer,
  signMandate,
} = requireMandate('@atlas-rail/mandate');
const { buildReceipt, hashResponseBody, merkleRoot, verifyReceipt } = requireReceipt('@atlas-rail/receipt');

const payment = await import(pathToFileURL(join(root, 'packages/atlasrails/payment.mjs')).href);
const fund = await import(pathToFileURL(join(root, 'packages/atlasrails/channel-fund.mjs')).href);
const { createAtlasRail } = await import(pathToFileURL(join(root, 'packages/atlasrails/dist/sdk-client.js')).href);

export const FORBIDDEN_CHANNEL = 'GEMPoRi8Si9peeMnCg6jDp36mKjT1oQLeqwm3VaveFuz';
export const EVIDENCE_CHANNEL = '5R9dv5gjMkZt9yFdHS3T67X3hNAM9XZLrXxnCtaSHoif';
export const PAYER = '2Qy24Ut2fDfj1SXBQbzBpvEEX8QZcStcZng6M3ravpsb';
export const PAYEE = 'Ayc7LB6Mw9pHp5e3ZH38HdLErHrpztnuyb9aT2g4nhGM';
export const MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
export const LIMITS = { maxPerPayment: 1000n, below: 500n, same: 1000n, above: 1001n, deposit: 10_000n };

export function assertSafeChannel(channel) {
  if (channel === FORBIDDEN_CHANNEL) throw new Error('Recovery channel is forbidden');
  if (channel === EVIDENCE_CHANNEL) throw new Error('Saved evidence channel is forbidden');
}

/** The deployed payment program rejects grace 0 with custom error 201. */
export function graceZeroRejected(simulation) {
  const err = JSON.stringify(simulation?.err ?? null);
  const logs = simulation?.logs ?? [];
  return err.includes('201') || logs.some((line) => String(line).includes('Grace period must be non-zero'));
}

/** A requested grace of 0 becomes 1 only after the program rejects 0. Any other request is kept. */
export function graceSecondsForOpen(requested, rejected) {
  if (requested !== 0) return requested;
  return rejected ? 1 : 0;
}

async function simulateInstructions(connection, payer, instructions) {
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const message = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions }).compileToV0Message();
  const simulated = await connection.simulateTransaction(new VersionedTransaction(message), { sigVerify: false, replaceRecentBlockhash: true });
  return simulated.value;
}

function seedKeypair(hex, name) {
  if (!/^[0-9a-fA-F]{64}$/.test(hex ?? '')) throw new Error(`${name} must be 32 bytes of hex`);
  return Keypair.fromSeed(Uint8Array.from(Buffer.from(hex, 'hex')));
}

function messageSigner(keypair) {
  const signer = new LocalEd25519Signer(keypair.secretKey.subarray(0, 32));
  if (signer.publicKey !== keypair.publicKey.toBase58()) {
    throw new Error('Ed25519 signer public key does not match the Solana key');
  }
  return signer;
}

async function ask(authorizer, fields) {
  try {
    const allowed = await authorizer.requestVoucher(fields);
    return { signed: true, allowed };
  } catch (error) {
    if (error instanceof MandateDeniedError) return { signed: false, message: error.name };
    throw error;
  }
}

function verifyVoucher(body, channel, amount, expiresAt, agent) {
  if (!body.signed) throw new Error('Expected an allowed voucher');
  const message = body.allowed.message;
  const signature = body.allowed.signature;
  if (message.length !== 50) throw new Error('Voucher message is not 50 bytes');
  const expected = encodeVoucherMessage({ channelId: channel, cumulativeAmount: amount, expiresAt: BigInt(expiresAt) });
  if (Buffer.compare(Buffer.from(message), Buffer.from(expected)) !== 0) throw new Error('Voucher bytes do not match');
  if (!ed25519.verify(signature, message, new PublicKey(agent).toBytes())) throw new Error('Voucher signature does not verify');
  return { messageHash: body.allowed.messageHash, deltaAmount: body.allowed.deltaAmount, decision: body.allowed.decision, message, signature };
}

export async function executeMandatePackageRun(env = serviceEnv(), options = {}) {
  process.env.ATLAS_ALLOW_MOCK_SIGNER = 'true';
  if (process.env.NODE_ENV === 'production') process.env.NODE_ENV = 'development';
  const rpcUrl = env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
  if (rpcUrl.includes('mainnet')) throw new Error('Refusing mainnet');
  const connection = new Connection(rpcUrl, 'confirmed');
  const genesis = await connection.getGenesisHash();
  if (genesis !== payment.DEVNET_GENESIS) throw new Error('RPC cluster is not Solana devnet');

  const funderPath = env.ATLAS_FUNDER_KEY_PATH;
  if (!funderPath) throw new Error('ATLAS_FUNDER_KEY_PATH is required');
  const funderFile = funderPath.includes(':') ? funderPath : join(root, funderPath);
  const owner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(funderFile, 'utf8'))));
  if (owner.publicKey.toBase58() !== PAYER) throw new Error('Loaded fee payer does not match the expected payer');
  const approver = seedKeypair(env.ATLAS_APPROVER_SEED, 'ATLAS_APPROVER_SEED');
  const gate = seedKeypair(env.ATLAS_INSTANCE_SEED, 'ATLAS_INSTANCE_SEED');
  const agent = Keypair.generate();
  const agentPath = join(root, '.demo', options.agentFile ?? 'mandate-package-agent.json');
  mkdirSync(dirname(agentPath), { recursive: true });
  writeFileSync(agentPath, JSON.stringify(Array.from(agent.secretKey)), { mode: 0o600 });
  const keys = [owner, approver, agent].map((k) => k.publicKey.toBase58());
  if (new Set(keys).size !== 3) throw new Error('Owner, approver, and agent must be distinct');

  const now = Math.floor(Date.now() / 1000);
  const mandateId = `mnd_${randomBytes(10).toString('hex').toUpperCase()}`;
  const nonce = randomBytes(16).toString('hex');
  const network = env.ATLAS_NETWORK || 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
  const resource = env.ATLAS_RESOURCE || 'research';
  const resourceUrl = env.ATLAS_RESOURCE_URL || 'http://localhost:4402/research/summary';
  const voucherExpiresAt = now + 3600;
  const ownerSigner = messageSigner(owner);
  const approverSigner = messageSigner(approver);
  const agentSigner = messageSigner(agent);
  const instance = messageSigner(gate);

  let mandate = createMandate({
    id: mandateId,
    nonce,
    issuer: { organizationId: 'org_mandate_package', name: 'Atlas Rail Mandate Package' },
    agent: { publicKey: agent.publicKey.toBase58(), label: 'Channel signer' },
    delegation: { requiredApprovals: 1 },
    scope: {
      allowedNetworks: [network],
      allowedAssets: [MINT],
      allowedPayTo: [PAYEE],
      allowedResources: [resource],
      limits: {
        mint: MINT,
        maxPerPayment: LIMITS.maxPerPayment.toString(),
        maxPerWindow: '10000',
        windowSeconds: 3600,
        maxTotal: '10000',
      },
      priceLimits: [],
    },
    escalation: {
      thresholdBaseUnits: '1000',
      approverRoles: ['OWNER', 'APPROVER'],
      resources: [],
      approvalTtlSeconds: 600,
    },
    notBefore: now - 60,
    expiresAt: now + 86_400,
  });
  mandate = await signMandate(mandate, { role: 'OWNER', signer: ownerSigner });
  mandate = await signMandate(mandate, { role: 'APPROVER', signer: approverSigner });
  mandate = await signMandate(mandate, { role: 'AGENT', signer: agentSigner });
  const mandateHash = Uint8Array.from(Buffer.from(hashMandate(mandate), 'hex'));

  const wallet = {
    publicKey: owner.publicKey.toBase58(),
    async signTransaction(tx) {
      tx.partialSign(owner);
      return tx;
    },
  };
  const atlas = createAtlasRail({
    apiUrl: env.ATLAS_API_URL || 'http://127.0.0.1:3001',
    connection,
    wallet,
    execution: 'prepareOnly',
    mandateProgramId: 'CnGoTE5Bxc8MFGaeK5LDv5uAZ7pNiktMunYy8JZcLY4k',
  });

  const gateBalance = await connection.getBalance(gate.publicKey, 'confirmed');
  let gateTopupSignature = null;
  if (gateBalance < 20_000_000) {
    const topup = new Transaction().add(SystemProgram.transfer({
      fromPubkey: owner.publicKey,
      toPubkey: gate.publicKey,
      lamports: 20_000_000,
    }));
    gateTopupSignature = await fund.submitSigned(connection, topup, { feePayer: owner, localSigners: [owner] });
  }

  const created = await atlas.createMandate({
    owner,
    approver,
    agent,
    mandateHash,
    gateAuthority: gate.publicKey.toBase58(),
    mint: MINT,
    maxPerPayment: LIMITS.maxPerPayment,
    maxPerWindow: 10_000n,
    windowSeconds: 3600n,
    maxTotal: 10_000n,
    escalationThreshold: 1000n,
    notBefore: BigInt(now - 60),
    expiresAt: BigInt(now + 86_400),
    submit: true,
  });
  if (created.status !== 'confirmed') throw new Error('create_mandate did not confirm');
  if (created.account.account.agent !== agent.publicKey.toBase58()) throw new Error('On-chain agent mismatch');
  if (created.account.account.revoked) throw new Error('New mandate is revoked');
  console.log(JSON.stringify({ phase: 'mandate', mandatePda: created.mandatePda, signature: created.signature }));

  const session = {
    payment: {
      salt: BigInt(Date.now()),
      graceSeconds: options.graceSeconds ?? 3600,
      resource,
      resourceUrl,
      network,
      maxPerPayment: LIMITS.maxPerPayment.toString(),
      maxPerWindow: '10000',
      windowSeconds: 3600,
      maxTotal: '10000',
      thresholdBaseUnits: '1000',
      approvalTtlSeconds: 600,
      requiredApprovals: 1,
      notBefore: now - 60,
      expiresAt: now + 86_400,
      voucherExpiresAt,
      organizationId: 'org_mandate_package',
      issuerName: 'Atlas Rail Mandate Package',
      deniedRecipient: Keypair.generate().publicKey.toBase58(),
    },
    depositAmount: LIMITS.deposit,
    connection,
    payer: owner,
    recipient: { publicKey: new PublicKey(PAYEE) },
    mint: new PublicKey(MINT),
    agent: { publicKey: agent.publicKey.toBase58() },
    payerAta: { address: getAssociatedTokenAddressSync(new PublicKey(MINT), owner.publicKey) },
    payeeAta: { address: getAssociatedTokenAddressSync(new PublicKey(MINT), new PublicKey(PAYEE)) },
    treasuryAta: { address: getAssociatedTokenAddressSync(new PublicKey(MINT), new PublicKey('4zTeC5mVqWLruDexgU2mV66p9t5vCA9JyiZqdGDUspap')) },
    mandate,
  };
  let graceZeroProbe = null;
  if (options.graceSeconds === 0) {
    const probe = await fund.prepareChannelOpen(session);
    const simulated = await simulateInstructions(connection, owner.publicKey, probe.transaction.instructions);
    const rejected = graceZeroRejected(simulated);
    graceZeroProbe = {
      err: simulated?.err ?? null,
      rejected,
      log: (simulated?.logs ?? []).find((line) => String(line).includes('Grace')) ?? null,
    };
    if (!rejected && simulated?.err) throw new Error(`grace 0 open failed: ${JSON.stringify(simulated.err)}`);
    session.payment.graceSeconds = graceSecondsForOpen(0, rejected);
    if (rejected) session.payment.salt += 1n;
    console.log(JSON.stringify({ phase: 'grace', requested: 0, stored: session.payment.graceSeconds, rejected }));
  }
  const prepared = await fund.prepareChannelOpen(session);
  assertSafeChannel(prepared.channel);
  const opened = await fund.submitPreparedOpen(session, prepared);
  assertSafeChannel(opened.channel);
  const channelInfo = await connection.getAccountInfo(new PublicKey(opened.channel), 'confirmed');
  const decoded = payment.readChannel(channelInfo.data);
  if (decoded.deposit !== LIMITS.deposit) throw new Error('Escrow deposit mismatch');
  if (decoded.authorizedSigner !== agent.publicKey.toBase58()) throw new Error('Channel signer mismatch');
  const storedGrace = channelInfo.data.readUInt32LE(52);
  if (storedGrace !== session.payment.graceSeconds) throw new Error(`Stored grace is ${storedGrace}`);
  const escrow = prepared.channelAta;
  console.log(JSON.stringify({ phase: 'open', channel: opened.channel, escrow, signature: opened.openSignature }));

  const gated = new GatedSignerAdapter({
    inner: new DevnetKeypairSigner(agent.secretKey),
    trustedInstanceKeys: [instance.publicKey],
  });
  const authorizerFor = () => new VoucherAuthorizer({
    mandate,
    instance,
    signer: gated,
    organizationId: 'org_mandate_package',
    channelPayer: PAYER,
    settledWatermark: async () => 0n,
  });
  const voucherFields = (amount, recipient) => ({
    channelId: opened.channel,
    cumulativeAmount: amount.toString(),
    expiresAt: voucherExpiresAt,
    recipient,
    resourceUrl,
    asset: MINT,
    network,
    feePayer: PAYER,
  });

  const above = await ask(authorizerFor(), voucherFields(LIMITS.above, PAYEE));
  if (above.signed) throw new Error('Amount above the mandate was signed');
  const wrongRecipient = await ask(authorizerFor(), voucherFields(LIMITS.same, session.payment.deniedRecipient));
  if (wrongRecipient.signed) throw new Error('Denied recipient was signed');
  const below = verifyVoucher(await ask(authorizerFor(), voucherFields(LIMITS.below, PAYEE)), opened.channel, LIMITS.below, voucherExpiresAt, agent.publicKey.toBase58());
  const same = verifyVoucher(await ask(authorizerFor(), voucherFields(LIMITS.same, PAYEE)), opened.channel, LIMITS.same, voucherExpiresAt, agent.publicKey.toBase58());

  const settleTransaction = (voucher) => new Transaction().add(
    payment.ed25519Instruction(agent.publicKey.toBytes(), voucher.signature, voucher.message),
    new TransactionInstruction({
      programId: fund.PROGRAM_ID,
      keys: [
        { pubkey: new PublicKey(opened.channel), isSigner: false, isWritable: true },
        { pubkey: fund.INSTRUCTIONS_SYSVAR, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([2]),
    }),
  );
  const settleSignature = await fund.submitSigned(connection, settleTransaction(same), { feePayer: owner, localSigners: [owner] });
  const settled = payment.readChannel((await connection.getAccountInfo(new PublicKey(opened.channel), 'confirmed')).data);
  if (settled.settled !== LIMITS.same) throw new Error(`Settled watermark is ${settled.settled}`);
  const rejectSettle = async (voucher, label) => {
    const simulated = await simulateInstructions(connection, owner.publicKey, settleTransaction(voucher).instructions);
    if (!simulated?.err) throw new Error(`${label} was accepted`);
    return { err: simulated.err, log: (simulated.logs ?? []).find((line) => /error/i.test(line)) ?? null };
  };
  const replay = await rejectSettle(same, 'Replaying the settled voucher');
  const belowAfterSettle = await rejectSettle(below, 'A voucher below the settled watermark');

  session.channelAta = { address: new PublicKey(escrow) };
  session.channel = new PublicKey(opened.channel);
  const distributeTx = new Transaction().add(new TransactionInstruction({
    programId: fund.PROGRAM_ID,
    keys: [
      { pubkey: new PublicKey(opened.channel), isSigner: false, isWritable: true },
      { pubkey: owner.publicKey, isSigner: false, isWritable: true },
      { pubkey: owner.publicKey, isSigner: false, isWritable: true },
      { pubkey: session.channelAta.address, isSigner: false, isWritable: true },
      { pubkey: session.payerAta.address, isSigner: false, isWritable: true },
      { pubkey: session.payeeAta.address, isSigner: false, isWritable: true },
      { pubkey: session.treasuryAta.address, isSigner: false, isWritable: true },
      { pubkey: session.mint, isSigner: false, isWritable: false },
      { pubkey: requireAtlas('@solana/spl-token').TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: PublicKey.findProgramAddressSync([Buffer.from('event_authority')], fund.PROGRAM_ID)[0], isSigner: false, isWritable: false },
      { pubkey: fund.PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: payment.distributeData(),
  }));
  const payeeBefore = BigInt((await connection.getTokenAccountBalance(session.payeeAta.address, 'confirmed')).value.amount);
  const distributeSignature = await fund.submitSigned(connection, distributeTx, { feePayer: owner, localSigners: [owner] });
  const after = payment.readChannel((await connection.getAccountInfo(new PublicKey(opened.channel), 'confirmed')).data);
  const payeeAfter = BigInt((await connection.getTokenAccountBalance(session.payeeAta.address, 'confirmed')).value.amount);
  if (after.payoutWatermark !== LIMITS.same) throw new Error(`Payout watermark is ${after.payoutWatermark}`);

  const receipt = await buildReceipt(
    {
      id: `rcp_${same.messageHash.slice(0, 16)}`,
      mandate,
      decision: same.decision,
      settlement: {
        txSignature: settleSignature,
        network,
        payer: agent.publicKey.toBase58(),
        settledAt: Math.floor(Date.now() / 1000),
        slot: null,
      },
      response: {
        status: 200,
        bodySha256: hashResponseBody(Buffer.from(same.message)),
        contentType: 'application/vnd.payment-channels.voucher',
      },
      issuedAt: Math.floor(Date.now() / 1000),
    },
    instance,
  );
  const receiptCheck = await verifyReceipt(receipt, { trustedInstanceKeys: [instance.publicKey] });
  const rootHex = merkleRoot([receipt.receiptHash]);
  const anchored = await atlas.anchorRoot({
    mandatePda: created.mandatePda,
    gate,
    merkleRoot: Uint8Array.from(Buffer.from(rootHex, 'hex')),
    leafCount: 1,
    submit: true,
  });
  if (anchored.status !== 'confirmed') throw new Error('anchor_root did not confirm');
  if (anchored.account.account.nextRootSeq !== 1n) throw new Error('nextRootSeq did not advance');

  let refund = null;
  if (options.refundRemainder) {
    const recover = await import(pathToFileURL(join(root, 'scripts/recover-funded-channel.mjs')).href);
    const { TOKEN_PROGRAM_ID } = requireAtlas('@solana/spl-token');
    const shapes = recover.loadRecoveryInstructions();
    const channelKey = new PublicKey(opened.channel);
    const escrowKey = new PublicKey(escrow);
    const payerAta = session.payerAta.address;
    const payerBefore = BigInt((await connection.getTokenAccountBalance(payerAta, 'confirmed')).value.amount);
    const requestCloseSignature = await fund.submitSigned(
      connection,
      new Transaction().add(recover.instructionFromCodama(shapes.requestClose, { payer: PAYER, channel: opened.channel })),
      { feePayer: owner, localSigners: [owner] },
    );
    const closing = (await connection.getAccountInfo(channelKey, 'confirmed')).data;
    if (closing[3] !== 2) throw new Error(`request_close left status ${closing[3]}`);
    const graceEndsAt = closing.readBigInt64LE(36) + BigInt(closing.readUInt32LE(52));
    const waitMs = Number(graceEndsAt) * 1000 - Date.now() + 1500;
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    const sealSignature = await fund.submitSigned(
      connection,
      new Transaction().add(recover.instructionFromCodama(shapes.seal, { channel: opened.channel })),
      { feePayer: owner, localSigners: [owner] },
    );
    const sealed = (await connection.getAccountInfo(channelKey, 'confirmed')).data;
    if (sealed[3] !== 1) throw new Error(`seal left status ${sealed[3]}`);
    const withdrawSignature = await fund.submitSigned(
      connection,
      new Transaction().add(recover.instructionFromCodama(shapes.withdrawPayer, {
        payer: PAYER,
        channel: opened.channel,
        channelTokenAccount: escrow,
        payerTokenAccount: payerAta.toBase58(),
        mint: MINT,
        tokenProgram: TOKEN_PROGRAM_ID.toBase58(),
      })),
      { feePayer: owner, localSigners: [owner] },
    );
    const payerAfterRefund = BigInt((await connection.getTokenAccountBalance(payerAta, 'confirmed')).value.amount);
    let escrowAfter = '0';
    const escrowInfo = await connection.getAccountInfo(escrowKey, 'confirmed');
    if (escrowInfo) escrowAfter = (await connection.getTokenAccountBalance(escrowKey, 'confirmed')).value.amount;
    const payerDelta = payerAfterRefund - payerBefore;
    if (payerDelta !== LIMITS.deposit - LIMITS.same) throw new Error(`Payer refund delta is ${payerDelta}`);
    if (escrowAfter !== '0') throw new Error(`Escrow still holds ${escrowAfter}`);
    refund = {
      requestCloseSignature,
      sealSignature,
      withdrawSignature,
      payerDelta: payerDelta.toString(),
      escrowAfter,
      status: (await connection.getAccountInfo(channelKey, 'confirmed')).data[3],
    };
    console.log(JSON.stringify({ phase: 'refund', ...refund }));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    network: 'solana-devnet',
    genesis,
    recoveryChannelUntouched: FORBIDDEN_CHANNEL,
    evidenceChannelUntouched: EVIDENCE_CHANNEL,
    programId: 'CnGoTE5Bxc8MFGaeK5LDv5uAZ7pNiktMunYy8JZcLY4k',
    mandatePda: created.mandatePda,
    mandateCreateSignature: created.signature,
    owner: owner.publicKey.toBase58(),
    approver: approver.publicKey.toBase58(),
    agent: agent.publicKey.toBase58(),
    gateAuthority: gate.publicKey.toBase58(),
    gateTopupSignature,
    channel: opened.channel,
    escrow,
    openSignature: opened.openSignature,
    graceRequested: options.graceSeconds ?? 3600,
    graceStored: storedGrace,
    graceZeroProbe,
    deposit: decoded.deposit.toString(),
    vouchers: {
      above: { amount: LIMITS.above.toString(), signed: false, message: above.message },
      wrongRecipient: { signed: false, message: wrongRecipient.message },
      below: { amount: LIMITS.below.toString(), signed: true, messageHash: below.messageHash, deltaAmount: below.deltaAmount, settled: false },
      userRequest: { amount: LIMITS.same.toString(), signed: true, messageHash: same.messageHash, deltaAmount: same.deltaAmount, settled: true },
    },
    replayRejected: replay,
    belowWatermarkRejected: belowAfterSettle,
    settleSignature,
    distributeSignature,
    settled: after.settled.toString(),
    payoutWatermark: after.payoutWatermark.toString(),
    payeeDelta: (payeeAfter - payeeBefore).toString(),
    receiptId: receipt.id,
    receiptVerifyPass: receiptCheck.pass,
    anchorSignature: anchored.signature,
    anchorRoot: rootHex,
    nextRootSeq: anchored.account.account.nextRootSeq.toString(),
    refund,
  };
  const signatures = [created.signature, opened.openSignature, settleSignature, distributeSignature, anchored.signature, refund?.requestCloseSignature, refund?.sealSignature, refund?.withdrawSignature].filter(Boolean);
  const confirmedSignatures = [];
  for (const signature of signatures) {
    const tx = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    if (!tx || tx.meta?.err) throw new Error(`Signature ${signature} is not confirmed`);
    confirmedSignatures.push({ signature, slot: tx.slot, explorer: `https://explorer.solana.com/tx/${signature}?cluster=devnet` });
  }
  report.confirmedSignatures = confirmedSignatures;
  const reportPath = join(root, 'reports', options.reportFile ?? 'devnet-mandate-package-2026-10-20.json');
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { reportPath, report };
}

const invoked = process.argv[1]?.replaceAll('\\', '/').endsWith('scripts/devnet-mandate-package.mjs');
if (invoked) {
  if (!process.argv.includes('--execute')) {
    console.error('Refusing to broadcast. Re-run with --execute to use the funder wallet on Devnet.');
    process.exit(1);
  }
  executeMandatePackageRun().then((result) => {
    console.log(JSON.stringify({ reportPath: result.reportPath, mandatePda: result.report.mandatePda, channel: result.report.channel, signatures: {
      create: result.report.mandateCreateSignature,
      open: result.report.openSignature,
      settle: result.report.settleSignature,
      distribute: result.report.distributeSignature,
      anchor: result.report.anchorSignature,
    } }, null, 2));
  }).catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : 'mandate package run failed');
    process.exit(1);
  });
}
