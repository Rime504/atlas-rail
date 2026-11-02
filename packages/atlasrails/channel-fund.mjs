/**
 * Browser-safe channel funding. No payer secret is read here.
 * payment.mjs re-exports these functions for the local demo.
 */
import { ComputeBudgetProgram, PublicKey, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from '@solana/spl-token';

export const PROGRAM_ID = new PublicKey('CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX');
export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
export const SYSTEM_PROGRAM_ID = new PublicKey('11111111111111111111111111111111');
export const RENT_SYSVAR = new PublicKey('SysvarRent111111111111111111111111111111111');
export const INSTRUCTIONS_SYSVAR = new PublicKey('Sysvar1nstructions1111111111111111111111111');
export const COMPUTE_BUDGET_PROGRAM_ID = ComputeBudgetProgram.programId;
/** One CreateIdempotent on Devnet consumed 13518 CU. The two budget instructions raised that total to 13818. */
export const SIMULATED_ATA_CREATE_UNITS = 13_518;
export const SIMULATED_BUDGET_UNITS = 300;
/** A Devnet open on 2026-10-20 consumed 37496 CU. The same two budget instructions raised that total to 37796. */
export const SIMULATED_OPEN_UNITS = 37_496;
/** Phantom's documented low-priority band starts at 1000 micro-lamports per compute unit. */
export const ATA_PRIORITY_PRICE_MICROLAMPORTS = 1_000;
/** One signature. Solana's base fee is 5000 lamports per signature. */
export const SIGNATURE_FEE_LAMPORTS = 5_000;

export function ataComputeUnitLimit(ataCount) {
  return SIMULATED_BUDGET_UNITS + SIMULATED_ATA_CREATE_UNITS * ataCount * 2;
}

/** ceil(units * micro-lamports / 1_000_000), the runtime priority fee in lamports. */
export function priorityFeeLamports(units, microLamports) {
  return Number((BigInt(units) * BigInt(microLamports) + 999_999n) / 1_000_000n);
}

export function ataTransactionFeeLamports(ataCount) {
  return SIGNATURE_FEE_LAMPORTS + priorityFeeLamports(ataComputeUnitLimit(ataCount), ATA_PRIORITY_PRICE_MICROLAMPORTS);
}

/** Cap for one or two associated-token creates, the most this funding transaction builds. */
export const ATA_FEE_CAP_LAMPORTS = ataTransactionFeeLamports(2);

export function openComputeUnitLimit() {
  return SIMULATED_BUDGET_UNITS + SIMULATED_OPEN_UNITS * 2;
}

export function openTransactionFeeLamports() {
  return SIGNATURE_FEE_LAMPORTS + priorityFeeLamports(openComputeUnitLimit(), ATA_PRIORITY_PRICE_MICROLAMPORTS);
}

/** The open transaction has one shape, so the cap is that transaction's own worst-case fee. */
export const OPEN_FEE_CAP_LAMPORTS = openTransactionFeeLamports();

export function assertOpenFee({ feeLamports, unitsConsumed }) {
  if (feeLamports == null || unitsConsumed == null) throw new Error('Transaction fee estimate is unavailable');
  if (unitsConsumed > openComputeUnitLimit()) throw new Error('Compute unit estimate exceeds the limit');
  if (feeLamports > OPEN_FEE_CAP_LAMPORTS) throw new Error('Transaction fee exceeds the cap');
  if (feeLamports !== openTransactionFeeLamports()) throw new Error('Transaction fee does not match the policy');
}

export function assertAtaFee({ feeLamports, unitsConsumed, ataCount }) {
  if (feeLamports == null || unitsConsumed == null) throw new Error('Transaction fee estimate is unavailable');
  const limit = ataComputeUnitLimit(ataCount);
  if (unitsConsumed > limit) throw new Error('Compute unit estimate exceeds the limit');
  const expected = ataTransactionFeeLamports(ataCount);
  if (feeLamports !== expected) throw new Error('Transaction fee does not match the policy');
  if (expected > ATA_FEE_CAP_LAMPORTS) throw new Error('Transaction fee exceeds the cap');
}
// shortcut: vaddr equals file offset in this ELF; re-locate the lddw if the program is upgraded
export const TREASURY_OWNER_OFFSET = 61435;

export function treasuryOwnerFromElf(elf) {
  if (elf.length < 4 || elf[0] !== 0x7f || elf[1] !== 0x45 || elf[2] !== 0x4c || elf[3] !== 0x46) {
    throw new Error('Deployed program data is not an ELF');
  }
  const bytes = elf.subarray(TREASURY_OWNER_OFFSET, TREASURY_OWNER_OFFSET + 32);
  if (bytes.length !== 32) throw new Error('Treasury owner constant is outside the deployed ELF');
  const load = Buffer.alloc(8);
  load[0] = 0x18;
  load[1] = 0x02;
  load.writeUInt32LE(TREASURY_OWNER_OFFSET, 4);
  if (elf.indexOf(load) < 0) throw new Error('Deployed program does not load the treasury owner constant');
  return new PublicKey(bytes);
}

export async function deployedProgramElf(connection) {
  const program = await connection.getAccountInfo(PROGRAM_ID, 'confirmed');
  if (!program || program.data.length < 36 || program.data.readUInt32LE(0) !== 2) {
    throw new Error('Program account is not an upgradeable program');
  }
  const data = await connection.getAccountInfo(new PublicKey(program.data.subarray(4, 36)), 'confirmed');
  if (!data || data.data.readUInt32LE(0) !== 3) throw new Error('Program data account is missing');
  const header = data.data[12] === 0 ? 13 : 45;
  return data.data.subarray(header);
}

function partyKey(party) {
  if (typeof party === 'string') return new PublicKey(party);
  if (typeof party?.publicKey === 'string') return new PublicKey(party.publicKey);
  if (party?.publicKey) return party.publicKey;
  return party;
}

function instructionReport(transaction) {
  return transaction.instructions.map((instruction) => ({
    programId: instruction.programId.toBase58(),
    data: Buffer.from(instruction.data).toString('hex'),
  }));
}

async function messageHash(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Buffer.from(digest).toString('hex');
}

function devSignLog() {
  return process.env.NODE_ENV === 'development';
}

function requiredSignerKeys(transaction) {
  const keys = new Set([transaction.feePayer.toBase58()]);
  for (const instruction of transaction.instructions) {
    for (const key of instruction.keys) {
      if (key.isSigner) keys.add(key.pubkey.toBase58());
    }
  }
  return [...keys];
}

/** One browser wallet plus local keypairs. A second browser wallet is rejected. */
export async function assembleSignedTransaction({ transaction, feePayer, localSigners = [], wallet, blockhash }) {
  if (transaction instanceof VersionedTransaction || typeof transaction.version === 'number') throw new Error('Versioned transactions are not supported');
  transaction.feePayer = partyKey(feePayer);
  transaction.recentBlockhash = blockhash;
  const locals = [...localSigners];
  if (feePayer?.secretKey && !locals.some((signer) => signer.publicKey.equals(transaction.feePayer))) locals.push(feePayer);
  const localByKey = new Map(locals.map((signer) => [signer.publicKey.toBase58(), signer]));
  const required = requiredSignerKeys(transaction);
  const uncovered = required.filter((key) => !localByKey.has(key));
  if (uncovered.length > 1) throw new Error('Unsupported flow: a second browser wallet is required');
  if (uncovered.length === 1 && wallet?.publicKey !== uncovered[0]) throw new Error('Wallet public key does not match the required signer');
  const message = Buffer.from(transaction.serializeMessage());
  if (devSignLog()) {
    console.info('atlasrails sign request', {
      feePayer: transaction.feePayer.toBase58(),
      messageHash: await messageHash(message),
      instructions: instructionReport(transaction),
    });
  }
  for (const key of required) {
    const local = localByKey.get(key);
    if (local) transaction.partialSign(local);
  }
  let signed = transaction;
  if (uncovered.length === 1) {
    signed = await wallet.signTransaction(transaction);
    const signedMessage = Buffer.from(signed.serializeMessage());
    const identical = signedMessage.equals(message);
    if (devSignLog()) {
      console.info('atlasrails sign result', {
        feePayer: signed.feePayer.toBase58(),
        messageHash: await messageHash(signedMessage),
        identical,
        instructions: instructionReport(signed),
      });
    }
    if (!identical) {
      const returned = devSignLog() ? ` Returned instructions: ${instructionReport(signed).map((item) => `${item.programId} ${item.data}`).join('; ')}.` : '';
      throw new Error(`Transaction message changed after a signature.${returned}`);
    }
  }
  for (const key of required) {
    const entry = signed.signatures.find((item) => item.publicKey.toBase58() === key);
    if (!entry?.signature) throw new Error('Missing required signature');
  }
  if (!signed.verifySignatures()) throw new Error('A required signature is no longer valid');
  return signed;
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function encodeBase58(bytes) {
  const input = Buffer.from(bytes);
  let zeroes = 0;
  while (zeroes < input.length && input[zeroes] === 0) zeroes += 1;
  const digits = [0];
  for (let i = zeroes; i < input.length; i += 1) {
    let carry = input[i];
    for (let j = 0; j < digits.length; j += 1) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let out = '1'.repeat(zeroes);
  for (let i = digits.length - 1; i >= 0; i -= 1) out += BASE58[digits[i]];
  return out;
}

export function transactionSignature(signed) {
  const raw = signed?.signatures?.[0]?.signature;
  return raw ? encodeBase58(raw) : null;
}

function errorText(error) {
  const message = error instanceof Error ? error.message : String(error ?? 'unknown RPC error');
  const logs = Array.isArray(error?.logs) ? error.logs.filter(Boolean).join('\n') : '';
  return logs ? `${message}\n${logs}` : message;
}

/** Maps an RPC or web3.js failure to one outcome. The original text is kept. */
export function classifySubmissionError(error) {
  const message = errorText(error);
  if (/blockhash not found|block height exceeded|blockhash.*expired/i.test(message)) return { kind: 'blockhash', message };
  if (/signature verification|invalid signature|missing required signature/i.test(message)) return { kind: 'signature', message };
  if (/not confirmed|timed out|timeout/i.test(message)) return { kind: 'timeout', message };
  if (/already been processed|simulation failed|preflight|InstructionError|custom program error/i.test(message)) return { kind: 'preflight', message };
  if (/failed to fetch|network|ECONN|ENOTFOUND|429|502|503|504|socket/i.test(message)) return { kind: 'network', message };
  return { kind: 'rpc', message };
}

export class SubmissionError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'SubmissionError';
    this.kind = details.kind;
    this.signature = details.signature;
    this.status = details.status;
    this.retrySafe = details.retrySafe;
  }
}

export async function inspectSubmittedSignature(connection, signed, blockhash) {
  const signature = transactionSignature(signed);
  if (!signature || !connection.getSignatureStatuses) return { signature, status: 'unchecked', err: null, blockhashValid: null };
  let status = 'unchecked';
  let err = null;
  try {
    const result = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
    const value = result?.value?.[0] ?? null;
    if (!value) status = 'not-found';
    else if (value.err) {
      status = 'failed';
      err = value.err;
    } else status = 'landed';
  } catch {
    status = 'unchecked';
  }
  let blockhashValid = null;
  try {
    if (blockhash && connection.isBlockhashValid) blockhashValid = (await connection.isBlockhashValid(blockhash, { commitment: 'confirmed' }))?.value ?? null;
  } catch {
    blockhashValid = null;
  }
  return { signature, status, err, blockhashValid };
}

function submissionMessage(kind, underlying, inspection) {
  const label = {
    preflight: 'Preflight failed',
    blockhash: 'Blockhash expired',
    signature: 'Signature verification failed',
    network: 'RPC network request failed',
    timeout: 'Confirmation timed out',
    rpc: 'RPC submit failed',
  }[kind];
  const signature = inspection.signature ? ` Signature ${inspection.signature}.` : '';
  const status = inspection.status === 'not-found'
    ? ' The signature is not on Devnet.'
    : inspection.status === 'landed'
      ? ' The signature is already on Devnet.'
      : inspection.status === 'failed'
        ? ` The signature landed with an error ${JSON.stringify(inspection.err)}.`
        : ' The signature status could not be checked.';
  const retry = kind === 'blockhash' && inspection.status === 'not-found' && inspection.blockhashValid === false
    ? ' This signature is absent and the blockhash is expired. A new signature of this same channel can be requested. This attempt was not resubmitted.'
    : ' This attempt was not resubmitted.';
  return `${label}: ${underlying}.${signature}${status}${retry}`;
}

async function reportSubmissionFailure(connection, signed, blockhash, error) {
  const classified = classifySubmissionError(error);
  const inspection = await inspectSubmittedSignature(connection, signed, blockhash);
  return new SubmissionError(submissionMessage(classified.kind, classified.message, inspection), {
    kind: classified.kind,
    signature: inspection.signature,
    status: inspection.status,
    retrySafe: classified.kind === 'blockhash' && inspection.status === 'not-found' && inspection.blockhashValid === false,
  });
}

export async function submitSigned(connection, transaction, options) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  if (devSignLog()) {
    transaction.feePayer = partyKey(options.feePayer);
    transaction.recentBlockhash = blockhash;
    const preview = {};
    try {
      preview.feeLamports = connection.getFeeForMessage ? (await connection.getFeeForMessage(transaction.compileMessage(), 'confirmed'))?.value ?? null : null;
    } catch (error) {
      preview.feeLamports = error instanceof Error ? error.message : 'fee query failed';
    }
    try {
      preview.simulation = connection.simulateTransaction ? (await connection.simulateTransaction(transaction, { sigVerify: false }))?.value ?? null : null;
    } catch (error) {
      preview.simulation = error instanceof Error ? error.message : 'simulation failed';
    }
    console.info('atlasrails unsigned preview', { feeLamports: preview.feeLamports, err: preview.simulation?.err ?? null, logs: preview.simulation?.logs ?? preview.simulation });
  }
  const signed = await assembleSignedTransaction({ ...options, transaction, blockhash });
  let signature;
  try {
    signature = await connection.sendRawTransaction(signed.serialize());
  } catch (error) {
    throw await reportSubmissionFailure(connection, signed, blockhash, error);
  }
  try {
    const result = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
    if (result?.value?.err) throw Object.assign(new Error(`InstructionError ${JSON.stringify(result.value.err)}`), { logs: result.value.logs });
  } catch (error) {
    if (error instanceof SubmissionError) throw error;
    throw await reportSubmissionFailure(connection, signed, blockhash, error);
  }
  return signature;
}

export function checkFundAccounts({ mint, mintOwner, tokenMint, tokenOwner, payer, balance, deposit }) {
  if (!mint) throw new Error('mint is required');
  if (mintOwner === TOKEN_2022_PROGRAM_ID.toBase58()) throw new Error('Token-2022 is not supported by the channel deposit instruction');
  if (mintOwner !== TOKEN_PROGRAM_ID.toBase58()) throw new Error('Unsupported token program');
  if (tokenMint !== mint) throw new Error('Token account mint does not match');
  if (tokenOwner !== payer) throw new Error('Token account authority does not match the payer');
  if (BigInt(balance) < BigInt(deposit)) throw new Error('Insufficient token balance');
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

function ataAddress(mint, owner) {
  return getAssociatedTokenAddressSync(mint, owner, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
}

async function treasuryOwnerKey(session) {
  if (session.treasuryOwner) return partyKey(session.treasuryOwner);
  return treasuryOwnerFromElf(await deployedProgramElf(session.connection));
}

/** Read-only account check used by the devnet review screen. */
export async function fundingPreview(connection, { mint, payer, recipient }) {
  const mintKey = new PublicKey(mint);
  const payerKey = partyKey(payer);
  const recipientKey = partyKey(recipient);
  const treasury = await treasuryOwnerKey({ connection });
  const payerAta = getAssociatedTokenAddressSync(mintKey, payerKey);
  const payeeAta = ataAddress(mintKey, recipientKey);
  const treasuryAta = ataAddress(mintKey, treasury);
  const [mintInfo, payerToken, payeeInfo, treasuryInfo] = await Promise.all([
    connection.getAccountInfo(mintKey, 'confirmed'),
    connection.getAccountInfo(payerAta, 'confirmed'),
    connection.getAccountInfo(payeeAta, 'confirmed'),
    connection.getAccountInfo(treasuryAta, 'confirmed'),
  ]);
  return {
    treasury: treasury.toBase58(),
    payerAta: payerAta.toBase58(),
    payeeAta: payeeAta.toBase58(),
    treasuryAta: treasuryAta.toBase58(),
    mintOwner: mintInfo ? mintInfo.owner.toBase58() : null,
    mintDecimals: mintInfo && mintInfo.data.length > 44 ? mintInfo.data[44] : null,
    tokenMint: payerToken ? new PublicKey(payerToken.data.subarray(0, 32)).toBase58() : null,
    tokenOwner: payerToken ? new PublicKey(payerToken.data.subarray(32, 64)).toBase58() : null,
    tokenBalance: payerToken ? payerToken.data.readBigUInt64LE(64).toString() : null,
    payeeAtaExists: Boolean(payeeInfo),
    treasuryAtaExists: Boolean(treasuryInfo),
  };
}

/** Payee and treasury ATAs. The owner does not sign. The fee payer does. */
async function createMissingOwnerAtas(session, payerKey, recipientKey) {
  const { connection, mint, wallet } = session;
  const treasuryOwner = await treasuryOwnerKey(session);
  const payeeAta = ataAddress(mint, recipientKey);
  const treasuryAta = ataAddress(mint, treasuryOwner);
  const creates = [];
  if (!(await connection.getAccountInfo(payeeAta, 'confirmed'))) {
    creates.push(createAssociatedTokenAccountIdempotentInstruction(payerKey, payeeAta, recipientKey, mint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));
  }
  if (!(await connection.getAccountInfo(treasuryAta, 'confirmed'))) {
    creates.push(createAssociatedTokenAccountIdempotentInstruction(payerKey, treasuryAta, treasuryOwner, mint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));
  }
  if (creates.length > 0) {
    const limit = ataComputeUnitLimit(creates.length);
    const instructions = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: limit }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: ATA_PRIORITY_PRICE_MICROLAMPORTS }),
      ...creates,
    ];
    const measured = await measureAtaTransaction(connection, payerKey, instructions);
    assertAtaFee({ feeLamports: measured.feeLamports, unitsConsumed: measured.unitsConsumed, ataCount: creates.length });
    session.ataSignature = await submitSigned(connection, measured.transaction, { feePayer: wallet, wallet });
  }
  session.payeeAta = { address: payeeAta };
  session.treasuryAta = { address: treasuryAta };
  session.treasuryOwner = treasuryOwner;
}

async function measureAtaTransaction(connection, payer, instructions) {
  const transaction = new Transaction();
  for (const instruction of instructions) transaction.add(instruction);
  transaction.feePayer = payer;
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = blockhash;
  let feeLamports = null;
  try {
    feeLamports = (await connection.getFeeForMessage(transaction.compileMessage(), 'confirmed'))?.value ?? null;
  } catch {
    feeLamports = null;
  }
  let unitsConsumed = null;
  try {
    const message = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions }).compileToV0Message();
    const simulated = await connection.simulateTransaction(new VersionedTransaction(message), { sigVerify: false, replaceRecentBlockhash: true });
    unitsConsumed = simulated?.value?.unitsConsumed ?? null;
  } catch {
    unitsConsumed = null;
  }
  return { transaction, feeLamports, unitsConsumed };
}

export async function quoteAtaFunding(connection, { payer, mint, payee, payeeAta, treasuryOwner, treasuryAta, createPayee, createTreasury }) {
  const payerKey = partyKey(payer);
  const mintKey = new PublicKey(mint);
  const creates = [];
  if (createPayee) creates.push(createAssociatedTokenAccountIdempotentInstruction(payerKey, new PublicKey(payeeAta), partyKey(payee), mintKey, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));
  if (createTreasury) creates.push(createAssociatedTokenAccountIdempotentInstruction(payerKey, new PublicKey(treasuryAta), partyKey(treasuryOwner), mintKey, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));
  if (creates.length === 0) return { required: false };
  const limit = ataComputeUnitLimit(creates.length);
  const measured = await measureAtaTransaction(connection, payerKey, [
    ComputeBudgetProgram.setComputeUnitLimit({ units: limit }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: ATA_PRIORITY_PRICE_MICROLAMPORTS }),
    ...creates,
  ]);
  let rentEach = null;
  try {
    rentEach = await connection.getMinimumBalanceForRentExemption(165);
  } catch {
    rentEach = null;
  }
  return {
    required: true,
    computeUnitLimit: limit,
    priorityPriceMicroLamports: ATA_PRIORITY_PRICE_MICROLAMPORTS,
    maxPriorityFeeLamports: priorityFeeLamports(limit, ATA_PRIORITY_PRICE_MICROLAMPORTS),
    baseFeeLamports: SIGNATURE_FEE_LAMPORTS,
    ataRentLamports: rentEach == null ? null : rentEach * creates.length,
    feeCapLamports: ATA_FEE_CAP_LAMPORTS,
    feeLamports: measured.feeLamports,
    unitsConsumed: measured.unitsConsumed,
  };
}

function buildOpenInstruction(session, slot) {
  const { payment, mint, depositAmount, agent } = session;
  const payerKey = partyKey(session.wallet ?? session.payer);
  const recipientKey = partyKey(session.recipient);
  const salt = payment.salt;
  const [channel] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('channel'),
      payerKey.toBuffer(),
      recipientKey.toBuffer(),
      mint.toBuffer(),
      new PublicKey(agent.publicKey).toBuffer(),
      Buffer.from(new BigUint64Array([salt]).buffer),
      Buffer.from(new BigUint64Array([slot]).buffer),
    ],
    PROGRAM_ID,
  );
  const [eventAuthority] = PublicKey.findProgramAddressSync([Buffer.from('event_authority')], PROGRAM_ID);
  const channelAta = getAssociatedTokenAddressSync(mint, channel, true);
  const openIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: payerKey, isSigner: true, isWritable: true },
      { pubkey: payerKey, isSigner: true, isWritable: true },
      { pubkey: recipientKey, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(agent.publicKey), isSigner: false, isWritable: false },
      { pubkey: channel, isSigner: false, isWritable: true },
      { pubkey: session.payerAta.address, isSigner: false, isWritable: true },
      { pubkey: channelAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: RENT_SYSVAR, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: openData(salt, depositAmount, payment.graceSeconds, slot),
  });
  return { instruction: openIx, channel, channelAta, eventAuthority, payerKey, recipientKey };
}

/** Builds the open transaction and checks its fee. Does not sign or send. */
export async function prepareChannelOpen(session) {
  const slot = BigInt(await session.connection.getSlot('confirmed'));
  const built = buildOpenInstruction(session, slot);
  const instructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: openComputeUnitLimit() }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: ATA_PRIORITY_PRICE_MICROLAMPORTS }),
    built.instruction,
  ];
  const measured = await measureAtaTransaction(session.connection, built.payerKey, instructions);
  assertOpenFee({ feeLamports: measured.feeLamports, unitsConsumed: measured.unitsConsumed });
  let channelRent = null;
  let tokenRent = null;
  try {
    channelRent = await session.connection.getMinimumBalanceForRentExemption(256);
    tokenRent = await session.connection.getMinimumBalanceForRentExemption(165);
  } catch {
    channelRent = null;
    tokenRent = null;
  }
  if (channelRent == null || tokenRent == null) throw new Error('Transaction fee estimate is unavailable');
  return {
    transaction: measured.transaction,
    channel: built.channel.toBase58(),
    channelAta: built.channelAta.toBase58(),
    eventAuthority: built.eventAuthority.toBase58(),
    deposit: session.depositAmount.toString(),
    mint: session.mint.toBase58(),
    payer: built.payerKey.toBase58(),
    payee: built.recipientKey.toBase58(),
    agent: session.agent.publicKey,
    programId: PROGRAM_ID.toBase58(),
    computeUnitLimit: openComputeUnitLimit(),
    priorityPriceMicroLamports: ATA_PRIORITY_PRICE_MICROLAMPORTS,
    maxPriorityFeeLamports: priorityFeeLamports(openComputeUnitLimit(), ATA_PRIORITY_PRICE_MICROLAMPORTS),
    baseFeeLamports: SIGNATURE_FEE_LAMPORTS,
    channelRentLamports: channelRent,
    tokenRentLamports: tokenRent,
    feeLamports: measured.feeLamports,
    feeCapLamports: OPEN_FEE_CAP_LAMPORTS,
    unitsConsumed: measured.unitsConsumed,
  };
}

export async function submitPreparedOpen(session, prepared) {
  const wallet = session.wallet;
  session.channel = new PublicKey(prepared.channel);
  session.channelAta = new PublicKey(prepared.channelAta);
  session.eventAuthority = new PublicKey(prepared.eventAuthority);
  session.openSignature = await submitSigned(session.connection, prepared.transaction, wallet
    ? { feePayer: wallet, wallet }
    : { feePayer: session.payer, localSigners: [session.payer] });
  return { channel: prepared.channel, deposit: prepared.deposit, openSignature: session.openSignature, ataSignature: session.ataSignature };
}

async function openChannel(session) {
  const { connection } = session;
  const wallet = session.wallet;
  const payerKey = partyKey(wallet ?? session.payer);
  const recipientKey = partyKey(session.recipient);
  if (wallet) {
    await createMissingOwnerAtas(session, payerKey, recipientKey);
  } else {
    const payer = session.payer;
    session.payerAta = session.payerAta ?? await getOrCreateAssociatedTokenAccount(connection, payer, session.mint, payer.publicKey);
    session.payeeAta = await getOrCreateAssociatedTokenAccount(connection, payer, session.mint, recipientKey);
    const treasuryOwner = treasuryOwnerFromElf(await deployedProgramElf(connection));
    session.treasuryAta = await getOrCreateAssociatedTokenAccount(connection, payer, session.mint, treasuryOwner);
  }
  return submitPreparedOpen(session, await prepareChannelOpen(session));
}

export async function depositUpfront(session) {
  const { connection, payer, mint, depositAmount } = session;
  if (!mint) throw new Error('mint is required');
  const payerAta = await getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey);
  if (session.demoMint) {
    const supply = depositAmount > 1_000_000n ? depositAmount : 1_000_000n;
    await mintTo(connection, payer, mint, payerAta.address, payer, supply);
  }
  session.payerAta = payerAta;
  return openChannel(session);
}

export async function fundAccounts(session, mintAddress, wallet) {
  await fundChecked(session, mintAddress, wallet);
  await createMissingOwnerAtas(session, partyKey(wallet), partyKey(session.recipient));
  return { ataSignature: session.ataSignature };
}

export async function fundChannel(session, mintAddress, wallet) {
  await fundChecked(session, mintAddress, wallet);
  return openChannel(session);
}

async function fundChecked(session, mintAddress, wallet) {
  if (!mintAddress) throw new Error('mint is required');
  const mint = new PublicKey(mintAddress);
  if (session.mint && !session.mint.equals(mint)) throw new Error('mint does not match the mandate');
  const payer = wallet ? partyKey(wallet) : session.payer.publicKey;
  const mintInfo = await session.connection.getAccountInfo(mint, 'confirmed');
  if (!mintInfo) throw new Error('mint is required');
  const payerAta = getAssociatedTokenAddressSync(mint, payer);
  const tokenInfo = await session.connection.getAccountInfo(payerAta, 'confirmed');
  if (!tokenInfo) throw new Error('Token account is missing');
  checkFundAccounts({
    mint: mint.toBase58(),
    mintOwner: mintInfo.owner.toBase58(),
    tokenMint: new PublicKey(tokenInfo.data.subarray(0, 32)).toBase58(),
    tokenOwner: new PublicKey(tokenInfo.data.subarray(32, 64)).toBase58(),
    payer: payer.toBase58(),
    balance: tokenInfo.data.readBigUInt64LE(64),
    deposit: session.depositAmount,
  });
  session.mint = mint;
  session.demoMint = false;
  session.payerAta = { address: payerAta };
  if (wallet) session.wallet = wallet;
}
