/**
 * Prepare a payer-forced close for the funded channel.
 * Default: review-only request_close. Broadcast only with --approve-broadcast request_close.
 * Does not seal, withdraw, settle, or distribute.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const requirePkg = createRequire(join(dirname(fileURLToPath(import.meta.url)), '../packages/atlasrails/package.json'));
const { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } = requirePkg('@solana/web3.js');
const { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } = requirePkg('@solana/spl-token');

export const RECOVERY_CHANNEL = 'GEMPoRi8Si9peeMnCg6jDp36mKjT1oQLeqwm3VaveFuz';
export const RECOVERY_PAYER = '2Qy24Ut2fDfj1SXBQbzBpvEEX8QZcStcZng6M3ravpsb';
export const RECOVERY_ESCROW = 'FvmVafVgaYPTFsJvjiZ3se6P7VDtSaXQEPaeh54q52GU';
export const RECOVERY_PROGRAM = 'CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX';
export const RECOVERY_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
export const RECOVERY_DEPOSIT = 10_000n;
export const RECOVERY_GRACE_SECONDS = 3600;
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const DEVNET_RPC = 'https://api.devnet.solana.com';

const STATUS = { Open: 0, Sealed: 1, Closing: 2, Distributed: 3 };
const STATUS_NAME = { 0: 'Open', 1: 'Sealed', 2: 'Closing', 3: 'Distributed' };
export const APPROVE_REQUEST_CLOSE_BROADCAST = 'request_close';

const INSTRUCTION_FILES = {
  requestClose: {
    file: 'requestClose.ts',
    discriminator: 'REQUEST_CLOSE_DISCRIMINATOR',
    signers: ['payer'],
  },
  seal: {
    file: 'seal.ts',
    discriminator: 'SEAL_DISCRIMINATOR',
    signers: [],
  },
  withdrawPayer: {
    file: 'withdrawPayer.ts',
    discriminator: 'WITHDRAW_PAYER_DISCRIMINATOR',
    signers: ['payer'],
  },
};

export function vendorInstructionDir(override = process.env.X402_PAYMENT_CHANNELS_INSTRUCTIONS) {
  if (!override) throw new Error('Set X402_PAYMENT_CHANNELS_INSTRUCTIONS to the Codama payment-channels instructions folder');
  return override;
}

/** Reads discriminator and account metas from a Codama instruction file. */
export function loadCodamaInstruction(dir, kind) {
  const spec = INSTRUCTION_FILES[kind];
  const text = readFileSync(join(dir, spec.file), 'utf8');
  const found = text.match(new RegExp(`export const ${spec.discriminator} = (\\d+);`));
  if (!found) throw new Error(`${spec.discriminator} is missing`);
  const start = text.indexOf('const originalAccounts = {');
  const end = text.indexOf('const accounts = originalAccounts', start);
  if (start < 0 || end < 0) throw new Error(`${spec.file} has no originalAccounts block`);
  const accounts = [];
  for (const match of text.slice(start, end).matchAll(/(\w+): \{[\s\S]*?isWritable: (true|false)/g)) {
    accounts.push({
      name: match[1],
      isWritable: match[2] === 'true',
      isSigner: spec.signers.includes(match[1]),
    });
  }
  if (accounts.length === 0) throw new Error(`${spec.file} has no accounts`);
  return { kind, discriminator: Number(found[1]), accounts };
}

export function loadRecoveryInstructions(dir = vendorInstructionDir()) {
  return {
    requestClose: loadCodamaInstruction(dir, 'requestClose'),
    seal: loadCodamaInstruction(dir, 'seal'),
    withdrawPayer: loadCodamaInstruction(dir, 'withdrawPayer'),
  };
}

export function decodeRecoveryChannel(data) {
  const bytes = Buffer.from(data);
  const key = (offset) => new PublicKey(bytes.subarray(offset, offset + 32)).toBase58();
  return {
    status: bytes[3],
    deposit: bytes.readBigUInt64LE(12),
    settled: bytes.readBigUInt64LE(20),
    payoutWatermark: bytes.readBigUInt64LE(28),
    closureStartedAt: bytes.readBigInt64LE(36),
    payerWithdrawnAt: bytes.readBigInt64LE(44),
    gracePeriod: bytes.readUInt32LE(52),
    payer: key(88),
    payee: key(120),
    authorizedSigner: key(152),
    mint: key(184),
    rentPayer: key(216),
  };
}

function tokenFields(data) {
  const bytes = Buffer.from(data);
  return {
    mint: new PublicKey(bytes.subarray(0, 32)).toBase58(),
    authority: new PublicKey(bytes.subarray(32, 64)).toBase58(),
    amount: bytes.readBigUInt64LE(64),
  };
}

export async function readRecoveryAccounts(connection, now = Math.floor(Date.now() / 1000)) {
  const genesis = await connection.getGenesisHash();
  if (genesis !== DEVNET_GENESIS) throw new Error('RPC cluster is not Solana devnet');
  const channelKey = new PublicKey(RECOVERY_CHANNEL);
  const escrowKey = new PublicKey(RECOVERY_ESCROW);
  const mintKey = new PublicKey(RECOVERY_MINT);
  const payerKey = new PublicKey(RECOVERY_PAYER);
  const payerAta = getAssociatedTokenAddressSync(mintKey, payerKey, false, TOKEN_PROGRAM_ID);
  const [channelInfo, escrowInfo, payerAtaInfo, programInfo] = await Promise.all([
    connection.getAccountInfo(channelKey, 'confirmed'),
    connection.getAccountInfo(escrowKey, 'confirmed'),
    connection.getAccountInfo(payerAta, 'confirmed'),
    connection.getAccountInfo(new PublicKey(RECOVERY_PROGRAM), 'confirmed'),
  ]);
  if (!channelInfo || !channelInfo.owner.equals(new PublicKey(RECOVERY_PROGRAM))) throw new Error('Channel owner is not the payment program');
  if (!programInfo?.executable) throw new Error('Payment program is not executable');
  const channel = decodeRecoveryChannel(channelInfo.data);
  if (channel.payer !== RECOVERY_PAYER) throw new Error('Loaded fee payer does not match the channel payer');
  if (channel.mint !== RECOVERY_MINT) throw new Error('Mint does not match the channel');
  if (channel.deposit !== RECOVERY_DEPOSIT || channel.settled !== 0n || channel.payoutWatermark !== 0n) throw new Error('Channel balances do not match the funded state');
  if (channel.gracePeriod !== RECOVERY_GRACE_SECONDS) throw new Error('Grace period does not match the open');
  if (!escrowInfo || !escrowInfo.owner.equals(TOKEN_PROGRAM_ID)) throw new Error('Escrow is not a token account');
  const escrow = tokenFields(escrowInfo.data);
  if (escrow.authority !== RECOVERY_CHANNEL || escrow.mint !== RECOVERY_MINT || escrow.amount !== RECOVERY_DEPOSIT) throw new Error('Escrow does not match the channel');
  if (!payerAtaInfo || !payerAtaInfo.owner.equals(TOKEN_PROGRAM_ID)) throw new Error('Payer token account is missing');
  const payerToken = tokenFields(payerAtaInfo.data);
  if (payerToken.authority !== RECOVERY_PAYER || payerToken.mint !== RECOVERY_MINT) throw new Error('Payer token account does not match the payer');
  return { channel, escrow, payerAta: payerAta.toBase58(), payerToken, now };
}

export function instructionFromCodama(shape, pubkeys) {
  const keys = shape.accounts.map((account) => {
    const pubkey = pubkeys[account.name];
    if (!pubkey) throw new Error(`Missing ${account.name}`);
    return { pubkey: new PublicKey(pubkey), isSigner: account.isSigner, isWritable: account.isWritable };
  });
  return new TransactionInstruction({
    programId: new PublicKey(RECOVERY_PROGRAM),
    keys,
    data: Buffer.from([shape.discriminator]),
  });
}

export function recoveryPlan(snapshot, instructions = loadRecoveryInstructions()) {
  const { channel, now } = snapshot;
  const graceEndsAt = channel.closureStartedAt > 0n ? channel.closureStartedAt + BigInt(channel.gracePeriod) : null;
  const graceElapsed = graceEndsAt !== null && BigInt(now) >= graceEndsAt;
  const requestClose = channel.status === STATUS.Open;
  const seal = channel.status === STATUS.Closing && graceElapsed;
  let withdraw = false;
  let withdrawRefusal = 'Withdraw waits until the channel is sealed';
  if (channel.status === STATUS.Open || channel.closureStartedAt === 0n) withdrawRefusal = 'Withdraw is refused before request_close starts the grace period';
  else if (channel.status === STATUS.Closing && !graceElapsed) withdrawRefusal = 'Withdraw is refused before the grace period expires';
  else if (channel.status === STATUS.Sealed && graceElapsed) {
    withdraw = true;
    withdrawRefusal = null;
  }
  return {
    requestClose,
    seal,
    withdraw,
    withdrawRefusal,
    graceEndsAt: graceEndsAt === null ? null : Number(graceEndsAt),
    instructions,
  };
}

export function assertWithdrawAllowed(snapshot) {
  const plan = recoveryPlan(snapshot);
  if (!plan.withdraw) throw new Error(plan.withdrawRefusal);
}

export function buildRequestCloseInstruction(instructions = loadRecoveryInstructions()) {
  const instruction = instructionFromCodama(instructions.requestClose, {
    payer: RECOVERY_PAYER,
    channel: RECOVERY_CHANNEL,
  });
  if (!instruction.programId.equals(new PublicKey(RECOVERY_PROGRAM))) throw new Error('Program ID does not match');
  if (instruction.keys[0].pubkey.toBase58() !== RECOVERY_PAYER) throw new Error('Payer account does not match');
  if (instruction.keys[1].pubkey.toBase58() !== RECOVERY_CHANNEL) throw new Error('Channel account does not match');
  if (!instruction.keys[0].isSigner || instruction.keys[0].isWritable) throw new Error('Codama payer meta mismatch');
  if (instruction.keys[1].isSigner || !instruction.keys[1].isWritable) throw new Error('Codama channel meta mismatch');
  if (instruction.data.length !== 1 || instruction.data[0] !== instructions.requestClose.discriminator) throw new Error('request_close discriminator mismatch');
  return instruction;
}

export async function prepareRequestCloseReview(connection, snapshot, instructions = loadRecoveryInstructions()) {
  if (snapshot.channel.status !== STATUS.Open) throw new Error('request_close requires an open channel');
  if (snapshot.channel.payer !== RECOVERY_PAYER) throw new Error('Loaded fee payer does not match the channel payer');
  if (snapshot.channel.closureStartedAt !== 0n) throw new Error('Closure has already started');
  const instruction = buildRequestCloseInstruction(instructions);
  const transaction = new Transaction().add(instruction);
  transaction.feePayer = new PublicKey(RECOVERY_PAYER);
  const latest = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = latest.blockhash;
  const message = transaction.compileMessage();
  const fee = await connection.getFeeForMessage(message, 'confirmed');
  if (fee.value == null) throw new Error('Fee estimate is unavailable');
  return {
    action: 'request_close',
    awaitingApproval: true,
    broadcast: false,
    channel: RECOVERY_CHANNEL,
    payer: RECOVERY_PAYER,
    escrow: RECOVERY_ESCROW,
    mint: RECOVERY_MINT,
    program: RECOVERY_PROGRAM,
    payerAta: snapshot.payerAta,
    status: snapshot.channel.status,
    statusName: STATUS_NAME[snapshot.channel.status] ?? String(snapshot.channel.status),
    deposit: snapshot.channel.deposit.toString(),
    settled: snapshot.channel.settled.toString(),
    payoutWatermark: snapshot.channel.payoutWatermark.toString(),
    gracePeriod: snapshot.channel.gracePeriod,
    closureStartedAt: snapshot.channel.closureStartedAt.toString(),
    escrowAmount: snapshot.escrow.amount.toString(),
    escrowAuthority: snapshot.escrow.authority,
    instruction: {
      discriminator: instruction.data[0],
      programId: instruction.programId.toBase58(),
      accounts: instruction.keys.map((key) => ({
        pubkey: key.pubkey.toBase58(),
        isSigner: key.isSigner,
        isWritable: key.isWritable,
      })),
      dataHex: Buffer.from(instruction.data).toString('hex'),
    },
    feeLamports: fee.value,
    recentBlockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
    effect: 'Sets channel status to Closing and writes closureStartedAt. Moves no tokens.',
    afterBroadcast: 'Wait gracePeriod seconds from the on-chain closureStartedAt, then seal, then withdraw_payer.',
    approvalCommand: 'node scripts/recover-funded-channel.mjs --approve-broadcast request_close',
  };
}

export async function simulateRequestClose(connection, payer, snapshot, instructions = loadRecoveryInstructions()) {
  if (payer.publicKey.toBase58() !== RECOVERY_PAYER) throw new Error('Loaded fee payer does not match the channel payer');
  if (snapshot.channel.status !== STATUS.Open) throw new Error('request_close requires an open channel');
  if (typeof connection.sendRawTransaction === 'function') throw new Error('Recovery simulation must not use a connection that can send');
  const instruction = buildRequestCloseInstruction(instructions);
  const transaction = new Transaction().add(instruction);
  transaction.feePayer = payer.publicKey;
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = blockhash;
  transaction.partialSign(payer);
  const simulated = await connection.simulateTransaction(transaction);
  return {
    err: simulated.value?.err ?? null,
    logs: simulated.value?.logs ?? [],
    unitsConsumed: simulated.value?.unitsConsumed ?? null,
    instruction,
  };
}

export async function verifyRequestCloseResult(connection, signature) {
  const status = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
  const value = status.value?.[0] ?? null;
  if (!value) throw new Error('Signature status is missing');
  if (value.err) throw new Error(`request_close failed: ${JSON.stringify(value.err)}`);
  if (value.confirmationStatus !== 'finalized' && value.confirmationStatus !== 'confirmed') {
    throw new Error(`request_close is not confirmed (${value.confirmationStatus ?? 'unknown'})`);
  }
  const snapshot = await readRecoveryAccounts(connection);
  if (snapshot.channel.status !== STATUS.Closing) throw new Error(`Channel status is ${snapshot.channel.status}, expected Closing`);
  if (snapshot.channel.closureStartedAt <= 0n) throw new Error('closureStartedAt was not set');
  if (snapshot.escrow.amount !== RECOVERY_DEPOSIT) throw new Error('Escrow amount changed during request_close');
  return {
    signature,
    confirmationStatus: value.confirmationStatus,
    status: snapshot.channel.status,
    statusName: STATUS_NAME[snapshot.channel.status],
    closureStartedAt: snapshot.channel.closureStartedAt.toString(),
    graceEndsAt: Number(snapshot.channel.closureStartedAt + BigInt(snapshot.channel.gracePeriod)),
    escrowAmount: snapshot.escrow.amount.toString(),
  };
}

export async function broadcastRequestClose(connection, payer, approval, instructions = loadRecoveryInstructions()) {
  if (approval !== APPROVE_REQUEST_CLOSE_BROADCAST) throw new Error('Explicit approval is required before broadcasting request_close');
  if (payer.publicKey.toBase58() !== RECOVERY_PAYER) throw new Error('Loaded fee payer does not match the channel payer');
  const snapshot = await readRecoveryAccounts(connection);
  if (snapshot.channel.status !== STATUS.Open) throw new Error('request_close requires an open channel');
  const instruction = buildRequestCloseInstruction(instructions);
  const transaction = new Transaction().add(instruction);
  transaction.feePayer = payer.publicKey;
  const latest = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = latest.blockhash;
  transaction.partialSign(payer);
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  });
  await connection.confirmTransaction({ signature, ...latest }, 'finalized');
  return verifyRequestCloseResult(connection, signature);
}

function payerFromEnv() {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), '../.env');
  const env = {};
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const eq = trimmed.indexOf('=');
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    env[trimmed.slice(0, eq).trim()] = value;
  }
  const configured = env.ATLAS_FUNDER_KEY_PATH;
  if (!configured) throw new Error('ATLAS_FUNDER_KEY_PATH is required');
  const path = existsSync(configured) ? configured : join(dirname(envPath), configured);
  const secret = Uint8Array.from(JSON.parse(readFileSync(path, 'utf8')));
  const payer = Keypair.fromSecretKey(secret);
  if (payer.publicKey.toBase58() !== RECOVERY_PAYER) throw new Error('Loaded fee payer does not match the channel payer');
  return payer;
}

function approvalFromArgv(argv) {
  const index = argv.indexOf('--approve-broadcast');
  if (index < 0) return null;
  return argv[index + 1] ?? null;
}

export async function main(argv = process.argv.slice(2)) {
  const approval = approvalFromArgv(argv);
  const rpc = new Connection(DEVNET_RPC, 'confirmed');
  const snapshot = await readRecoveryAccounts(rpc);
  if (!approval) {
    const review = await prepareRequestCloseReview(rpc, snapshot);
    console.log(JSON.stringify(review, null, 2));
    return review;
  }
  const payer = payerFromEnv();
  const result = await broadcastRequestClose(rpc, payer, approval);
  console.log(JSON.stringify({ broadcast: true, ...result }, null, 2));
  return result;
}

const invoked = process.argv[1]?.replaceAll('\\', '/').endsWith('scripts/recover-funded-channel.mjs');
if (invoked) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Recovery prepare failed');
    process.exit(1);
  });
}
