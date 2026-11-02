/**
 * Register the settled channel's mandate and anchor its receipt with anchor_root.
 * Reads the existing devnet settlement. Does not open another channel or print secrets.
 *
 * Run from the repo root: node scripts/channel-voucher-anchor.mjs
 */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { askAtlasRail, forgetVoucherSession, loadFeePayer, voucherSessionPath } from './channel-voucher-devnet.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const requireX402 = createRequire(join(repoRoot, 'packages/x402-client/package.json'));
const requireSolana = createRequire(join(repoRoot, 'packages/solana/package.json'));
const requireReceipt = createRequire(join(repoRoot, 'packages/receipt/package.json'));
const { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } = requireSolana('@solana/web3.js');
const { VersionedTransaction } = requireSolana('@solana/web3.js');
const {
  buildCreateMandateTransaction,
  decodeRootAccount,
  fetchMandateAccount,
  findMandatePda,
  findRootPda,
  Web3ChainClient,
  DevnetKeypairSigner,
} = requireSolana('@atlas-rail/solana');
const { createMandate, hashMandate, signMandate, SOLANA_DEVNET_CAIP2, LocalEd25519Signer } = requireX402('@atlas-rail/mandate');
const { AnchorService, InMemoryReceiptStore } = requireReceipt('@atlas-rail/receipt');

const RPC = 'https://api.devnet.solana.com';
const PROGRAM_ID = 'CnGoTE5Bxc8MFGaeK5LDv5uAZ7pNiktMunYy8JZcLY4k';
const FUND_LAMPORTS = 50_000_000;

function seed(label) {
  const out = new Uint8Array(32);
  new TextEncoder().encode(label).forEach((byte, index) => {
    out[index] = byte;
  });
  return out;
}

function voucherKeypair(mandateId) {
  const path = voucherSessionPath();
  const file = JSON.parse(readFileSync(path, 'utf8'));
  const entry = file.keys?.[`voucher:${mandateId}`];
  if (!entry?.secretKey || typeof entry.publicKey !== 'string') throw new Error('Voucher key is missing');
  const secret = Uint8Array.from(entry.secretKey);
  const agent = secret.length === 64 ? Keypair.fromSecretKey(secret) : Keypair.fromSeed(secret);
  if (agent.publicKey.toBase58() !== entry.publicKey) throw new Error('Agent key mismatch');
  return agent;
}

function report(body) {
  const path = join(repoRoot, 'reports', 'channel-voucher-anchor.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(body, null, 2));
  console.log(path);
}

function decodeChannel(data) {
  const d = Buffer.from(data);
  const key = (offset) => new PublicKey(d.subarray(offset, offset + 32)).toBase58();
  return {
    status: d[3],
    deposit: d.readBigUInt64LE(12).toString(),
    settled: d.readBigUInt64LE(20).toString(),
    payoutWatermark: d.readBigUInt64LE(28).toString(),
    payerWithdrawnAt: d.readBigInt64LE(44).toString(),
    payer: key(88),
    payee: key(120),
    authorizedSigner: key(152),
    mint: key(184),
    rentPayer: key(216),
  };
}

async function main() {
  process.env.ATLAS_ALLOW_MOCK_SIGNER = 'true';
  const settlement = JSON.parse(readFileSync(join(repoRoot, 'reports', 'channel-voucher-devnet.json'), 'utf8'));
  const mandateId = settlement.receipt?.mandate?.id;
  try {
  await anchorSettled(settlement);
  } finally {
    if (typeof mandateId === 'string') await forgetVoucherSession(mandateId);
  }
}

async function anchorSettled(settlement) {
  const channelId = settlement.channel;
  const connection = new Connection(RPC, 'confirmed');
  const info = await connection.getAccountInfo(new PublicKey(channelId), 'confirmed');
  if (!info) throw new Error('Channel account is missing');
  const channel = decodeChannel(info.data);
  if (channel.settled !== settlement.settled || channel.deposit !== settlement.deposit || channel.payoutWatermark !== settlement.payoutWatermark) {
    throw new Error(`Channel settled ${channel.settled} deposit ${channel.deposit} payout ${channel.payoutWatermark}`);
  }
  if (channel.payoutWatermark !== channel.settled || channel.payerWithdrawnAt === '0') {
    throw new Error('Distribute or withdraw_payer did not finish');
  }

  async function readSettled(channelId) {
    const live = await connection.getAccountInfo(new PublicKey(channelId), 'confirmed');
    if (!live || live.data.length < 28) throw new Error('Channel account is missing');
    return live.data.readBigUInt64LE(20);
  }

  const tx = await connection.getTransaction(settlement.settleSignature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
  if (!tx) throw new Error('Settle transaction is missing');
  const ix = tx.transaction.message.compiledInstructions[0];
  const data = Buffer.from(ix.data);
  const message = data.subarray(112, 112 + data.readUInt16LE(12));
  const messageHash = createHash('sha256').update(message).digest('hex');
  if (messageHash !== settlement.voucherMessageHash) throw new Error('Settle voucher hash does not match the report');
  const expiresAt = Number(message.readBigInt64LE(42));
  const now = expiresAt - 300;

  const settledMandate = settlement.receipt?.mandate;
  if (!settledMandate?.id || !settledMandate.nonce || !settledMandate.agent?.publicKey) throw new Error('Devnet report has no mandate');
  const ownerKey = new LocalEd25519Signer(seed('channel-owner'));
  const approverKey = new LocalEd25519Signer(seed('channel-approver'));
  const instanceKey = new LocalEd25519Signer(seed('channel-instance'));
  const owner = Keypair.fromSeed(seed('channel-owner'));
  const approver = Keypair.fromSeed(seed('channel-approver'));
  const agent = voucherKeypair(settledMandate.id);
  const instance = new DevnetKeypairSigner(seed('channel-instance'));
  if (owner.publicKey.toBase58() !== ownerKey.publicKey) throw new Error('Owner key mismatch');
  if (approver.publicKey.toBase58() !== approverKey.publicKey) throw new Error('Approver key mismatch');
  if (instance.publicKey !== instanceKey.publicKey) throw new Error('Instance key mismatch');
  if (agent.publicKey.toBase58() !== settledMandate.agent.publicKey) throw new Error('Voucher signer is not the mandate agent');
  if (agent.publicKey.toBase58() !== channel.authorizedSigner) throw new Error('Voucher signer is not the channel signer');

  let mandate = createMandate({
    id: settledMandate.id,
    nonce: settledMandate.nonce,
    issuer: { organizationId: 'org_channel', name: 'Channel prototype' },
    agent: { publicKey: settledMandate.agent.publicKey, label: settledMandate.agent.label ?? 'Channel signer' },
    delegation: { requiredApprovals: 1 },
    scope: {
      allowedNetworks: [SOLANA_DEVNET_CAIP2],
      allowedAssets: [channel.mint],
      allowedPayTo: [channel.payee],
      allowedResources: ['http://localhost:4402/research/*'],
      limits: { mint: channel.mint, maxPerPayment: '1000000', maxPerWindow: '1000000', windowSeconds: 86400, maxTotal: '1000000' },
      priceLimits: [],
    },
    escalation: { thresholdBaseUnits: '1000000', approverRoles: ['OWNER', 'APPROVER'], resources: [], approvalTtlSeconds: 900 },
    notBefore: settledMandate.notBefore,
    expiresAt: settledMandate.expiresAt,
  });
  mandate = await signMandate(mandate, { role: 'OWNER', signer: ownerKey });
  mandate = await signMandate(mandate, { role: 'APPROVER', signer: approverKey });
  const agentSigner = new LocalEd25519Signer(agent.secretKey);
  if (agentSigner.publicKey !== agent.publicKey.toBase58()) throw new Error('Agent key mismatch');
  mandate = await signMandate(mandate, { role: 'AGENT', signer: agentSigner });

  const aboveSettled = (BigInt(channel.settled) + 1000n).toString();
  const chainSettled = (await readSettled(channelId)).toString();
  const voucherFields = {
    mandate,
    channelId,
    cumulativeAmount: aboveSettled,
    expiresAt,
    resourceUrl: 'http://localhost:4402/research/summary',
    asset: channel.mint,
    network: SOLANA_DEVNET_CAIP2,
    chainSettled,
  };
  const understated = await askAtlasRail({ ...voucherFields, settledAmount: '0', recipient: channel.payee });
  if (understated.signed) throw new Error('Understated watermark was signed');
  const denied = await askAtlasRail({ ...voucherFields, recipient: Keypair.generate().publicKey.toBase58() });
  if (denied.signed) throw new Error('Unauthorized recipient was signed');
  const denial = { signed: false, message: denied.message ?? 'MandateDeniedError' };
  const receipt = settlement.receipt;
  if (!receipt?.hashes?.mandateHash) throw new Error('Devnet report has no receipt to anchor');
  if (receipt.response?.bodySha256 !== messageHash) throw new Error('Receipt body does not match the settled voucher');
  if (hashMandate(mandate) !== receipt.hashes.mandateHash) throw new Error('Rebuilt mandate does not match the settled receipt');

  const feePayer = loadFeePayer();
  if (feePayer.publicKey.toBase58() !== channel.payer) throw new Error('Fee payer is not the channel payer');
  const fund = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: feePayer.publicKey, toPubkey: owner.publicKey, lamports: FUND_LAMPORTS }),
    SystemProgram.transfer({ fromPubkey: feePayer.publicKey, toPubkey: new PublicKey(instance.publicKey), lamports: FUND_LAMPORTS }),
  );
  await sendAndConfirmTransaction(connection, fund, [feePayer]);

  const mandateHash = hashMandate(mandate);
  const { address: mandatePda } = findMandatePda(PROGRAM_ID, Buffer.from(mandateHash, 'hex'));
  let createSig = null;
  if (await fetchMandateAccount(RPC, mandatePda)) {
    createSig = 'already-registered';
  } else {
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const createRaw = buildCreateMandateTransaction({
    programId: PROGRAM_ID,
    mandateHash: Buffer.from(mandateHash, 'hex'),
    gateAuthority: instance.publicKey,
    mint: channel.mint,
    maxPerPayment: 1_000_000n,
    maxPerWindow: 1_000_000n,
    windowSeconds: 86_400n,
    maxTotal: 1_000_000n,
    escalationThreshold: 1_000_000n,
    notBefore: BigInt(now - 60),
    expiresAt: BigInt(now + 3600),
    owner: owner.publicKey.toBase58(),
    approver: approver.publicKey.toBase58(),
    agent: agent.publicKey.toBase58(),
    recentBlockhash: blockhash,
  });
  const createTx = VersionedTransaction.deserialize(Buffer.from(createRaw, 'base64'));
  createTx.sign([owner, approver, agent]);
  createSig = await connection.sendRawTransaction(createTx.serialize());
  await connection.confirmTransaction(createSig, 'confirmed');
  }

  const store = new InMemoryReceiptStore();
  await store.insert({ organizationId: 'org_channel', receipt, createdAt: now, batchId: null });
  const anchored = await new AnchorService({
    receipts: store,
    chain: Web3ChainClient.fromUrl(RPC),
    signer: instance,
    clock: () => now,
    newId: (prefix) => `${prefix}_channel`,
    rpcUrl: RPC,
    programId: PROGRAM_ID,
    network: SOLANA_DEVNET_CAIP2,
  }).run();
  if (!anchored?.batch.txSignature) throw new Error('anchor_root did not return a signature');

  const onchain = await fetchMandateAccount(RPC, mandatePda);
  const { address: rootPda } = findRootPda(PROGRAM_ID, mandatePda, 0n);
  const rootInfo = await connection.getAccountInfo(new PublicKey(rootPda), 'confirmed');
  if (!rootInfo) throw new Error('Root account is missing');
  const rooted = decodeRootAccount(rootInfo.data);
  const stored = await store.get('org_channel', receipt.id);
  const body = {
    ok: rooted.merkleRoot === anchored.batch.merkleRoot && stored?.receipt.anchor?.mechanism === 'root',
    channel: channelId,
    channelStatus: channel.status,
    deposit: channel.deposit,
    settled: channel.settled,
    payoutWatermark: channel.payoutWatermark,
    settleSignature: settlement.settleSignature,
    reconstructed: true,
    voucherMessageBase64: Buffer.from(message).toString('base64'),
    voucherSignatureBase64: settlement.voucherSignatureBase64,
    voucherMessageHash: messageHash,
    decision: receipt.decision,
    receipt: stored?.receipt ?? receipt,
    understated,
    denial,
    receiptId: receipt.id,
    mandatePda,
    createMandateSignature: createSig,
    rootPda,
    anchorSignature: anchored.batch.txSignature,
    merkleRoot: rooted.merkleRoot,
    leafCount: rooted.leafCount,
    seq: rooted.seq.toString(),
    explorer: `https://explorer.solana.com/tx/${anchored.batch.txSignature}?cluster=devnet`,
  };
  report(body);
  console.log(JSON.stringify(body, null, 2));
}

main().catch((error) => {
  report({ ok: false, error: error instanceof Error ? error.message : String(error) });
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
