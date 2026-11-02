import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { ComputeBudgetProgram, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { ataComputeUnitLimit, ataTransactionFeeLamports, openComputeUnitLimit, openTransactionFeeLamports, priorityFeeLamports, ATA_PRIORITY_PRICE_MICROLAMPORTS } from '../channel-fund.mjs';
import { afterEach, describe, expect, it } from 'vitest';
import { connect, importFunder, init, keypair, keypairWallet, load, mandatePayment } from './index';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

function tempDir(): string {
  const root = tmpdir();
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, 'atlasrails-'));
  dirs.push(dir);
  return dir;
}

describe('atlasrails', () => {
  it('creates a different key for each path and does not replace an existing one', () => {
    const dir = tempDir();
    const alice = join(dir, 'alice.json');
    const bob = join(dir, 'bob.json');
    const first = init({ path: alice });
    const again = init({ path: alice });
    const other = init({ path: bob });
    expect(first.created).toBe(true);
    expect(again).toEqual({ publicKey: first.publicKey, created: false });
    expect(load({ path: alice }).publicKey).toBe(first.publicKey);
    expect(other.publicKey).not.toBe(first.publicKey);
    expect(connect({ path: alice, rpcUrl: 'https://api.devnet.solana.com' }).publicKey).toBe(first.publicKey);
    expect(keypair({ path: alice }).publicKey.toBase58()).toBe(first.publicKey);
    expect(keypair({ path: bob }).publicKey.toBase58()).toBe(other.publicKey);
  });

  it('stores the DEMO_FUNDER_SECRET_KEY wallet and keeps that same key', () => {
    const dir = tempDir();
    const envFile = join(dir, '.env');
    const path = join(dir, 'funder.json');
    const funder = Keypair.generate();
    writeFileSync(envFile, `DEMO_FUNDER_SECRET_KEY=${JSON.stringify(Array.from(funder.secretKey))}\n`);
    const first = importFunder({ path, envFile });
    const again = importFunder({ path, envFile });
    expect(first).toEqual({ publicKey: funder.publicKey.toBase58(), created: true });
    expect(again).toEqual({ publicKey: first.publicKey, created: false });
    expect(load({ path }).publicKey).toBe(first.publicKey);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(Array.from(funder.secretKey));
  });

  it('requires the mandate and backend fields', () => {
    const fields = {
      path: 'wallet.json',
      envFile: '.env',
      organizationId: 'org_channel',
      issuerName: 'Channel prototype',
      resource: 'http://localhost:4402/research/*',
      resourceUrl: 'http://localhost:4402/research/summary',
      deposit: '20000',
      settled: '10000',
      maxPerPayment: '1000000',
      maxPerWindow: '1000000',
      windowSeconds: 86400,
      maxTotal: '1000000',
      thresholdBaseUnits: '1000000',
      approvalTtlSeconds: 900,
      requiredApprovals: 1,
      notBefore: 1,
      expiresAt: 2,
      voucherExpiresAt: 2,
      graceSeconds: 60,
      salt: '1',
      network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
      payeePath: 'payee.json',
      deniedRecipient: 'denied',
      ownerSeed: '11'.repeat(32),
      approverSeed: '22'.repeat(32),
      instanceSeed: '33'.repeat(32),
      apiUrl: 'http://127.0.0.1:3001',
      signerUrl: 'http://127.0.0.1:3012',
      rpcUrl: 'https://api.devnet.solana.com',
    };
    expect(mandatePayment(fields).organizationId).toBe('org_channel');
    expect(() => mandatePayment({ ...fields, organizationId: '' })).toThrow('organizationId is required');
    expect(() => mandatePayment({ ...fields, settled: '20001' })).toThrow('settled is above the deposit');
  });
});

const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

describe('wallet submit', () => {
  async function payment() {
    return import('../payment.mjs') as Promise<{
      assembleSignedTransaction: (options: Record<string, unknown>) => Promise<Transaction>;
      submitSigned: (connection: Record<string, unknown>, transaction: Transaction, options: Record<string, unknown>) => Promise<string>;
      transactionSignature: (signed: Transaction) => string | null;
      checkFundAccounts: (options: Record<string, unknown>) => void;
    }>;
  }

  function blockhash(): string {
    return Keypair.generate().publicKey.toBase58();
  }

  function transfer(from: PublicKey, to: PublicKey, signers: PublicKey[] = [from]): Transaction {
    const transaction = new Transaction();
    transaction.add(new TransactionInstruction({
      programId: PublicKey.default,
      keys: signers.map((pubkey) => ({ pubkey, isSigner: true, isWritable: true })),
      data: Buffer.alloc(0),
    }));
    transaction.feePayer = from;
    void to;
    return transaction;
  }

  it('hides the secret and signs one local wallet', async () => {
    const dir = tempDir();
    const path = join(dir, 'wallet.json');
    init({ path });
    const wallet = keypairWallet({ path });
    expect('secretKey' in wallet).toBe(false);
    const signer = keypair({ path });
    const { assembleSignedTransaction } = await payment();
    const signed = await assembleSignedTransaction({
      transaction: transfer(signer.publicKey, signer.publicKey),
      feePayer: wallet,
      wallet,
      blockhash: blockhash(),
    });
    expect(signed.verifySignatures()).toBe(true);
  });

  it('rejects a second browser wallet, a mismatch, a missing signature, and a changed message', async () => {
    const payer = Keypair.generate();
    const payee = Keypair.generate();
    const { assembleSignedTransaction } = await payment();
    const hash = blockhash();
    await expect(assembleSignedTransaction({
      transaction: { version: 0 },
      feePayer: payer.publicKey,
      blockhash: hash,
    })).rejects.toThrow('Versioned transactions are not supported');
    await expect(assembleSignedTransaction({
      transaction: transfer(payer.publicKey, payee.publicKey, [payer.publicKey, payee.publicKey]),
      feePayer: payer.publicKey,
      wallet: { publicKey: payer.publicKey.toBase58(), signTransaction: async (tx: Transaction) => tx },
      blockhash: hash,
    })).rejects.toThrow('second browser wallet');
    await expect(assembleSignedTransaction({
      transaction: transfer(payer.publicKey, payee.publicKey),
      feePayer: payer.publicKey,
      wallet: { publicKey: payee.publicKey.toBase58(), signTransaction: async (tx: Transaction) => tx },
      blockhash: hash,
    })).rejects.toThrow('does not match');
    await expect(assembleSignedTransaction({
      transaction: transfer(payer.publicKey, payee.publicKey),
      feePayer: payer.publicKey,
      wallet: { publicKey: payer.publicKey.toBase58(), signTransaction: async () => { throw new Error('User rejected the request'); } },
      blockhash: hash,
    })).rejects.toThrow('User rejected');
    await expect(assembleSignedTransaction({
      transaction: transfer(payer.publicKey, payee.publicKey),
      feePayer: payer.publicKey,
      wallet: { publicKey: payer.publicKey.toBase58(), signTransaction: async (tx: Transaction) => tx },
      blockhash: hash,
    })).rejects.toThrow('Missing required signature');
    await expect(assembleSignedTransaction({
      transaction: transfer(payer.publicKey, payee.publicKey),
      feePayer: payer.publicKey,
      wallet: {
        publicKey: payer.publicKey.toBase58(),
        async signTransaction(tx: Transaction) {
          tx.instructions.push(new TransactionInstruction({ programId: PublicKey.default, keys: [], data: Buffer.from([1]) }));
          tx.partialSign(payer);
          return tx;
        },
      },
      blockhash: hash,
    })).rejects.toThrow('message changed');
    await expect(assembleSignedTransaction({
      transaction: transfer(payer.publicKey, payee.publicKey),
      feePayer: payer.publicKey,
      wallet: {
        publicKey: payer.publicKey.toBase58(),
        async signTransaction(tx: Transaction) {
          tx.instructions[0].keys[0].pubkey = Keypair.generate().publicKey;
          tx.partialSign(payer);
          return tx;
        },
      },
      blockhash: hash,
    })).rejects.toThrow('message changed');
    await expect(assembleSignedTransaction({
      transaction: transfer(payer.publicKey, payee.publicKey),
      feePayer: payer.publicKey,
      wallet: {
        publicKey: payer.publicKey.toBase58(),
        async signTransaction(tx: Transaction) {
          tx.instructions[0].data = Buffer.from([9]);
          tx.partialSign(payer);
          return tx;
        },
      },
      blockhash: hash,
    })).rejects.toThrow('message changed');
    const unchanged = await assembleSignedTransaction({
      transaction: transfer(payer.publicKey, payee.publicKey),
      feePayer: payer.publicKey,
      wallet: {
        publicKey: payer.publicKey.toBase58(),
        async signTransaction(tx: Transaction) {
          tx.partialSign(payer);
          return tx;
        },
      },
      blockhash: hash,
    });
    expect(unchanged.instructions).toHaveLength(1);
    expect(unchanged.verifySignatures()).toBe(true);
  });

  it('keeps the local signature valid after the wallet signs', async () => {
    const payer = Keypair.generate();
    const payee = Keypair.generate();
    const { assembleSignedTransaction } = await payment();
    const signed = await assembleSignedTransaction({
      transaction: transfer(payer.publicKey, payee.publicKey, [payer.publicKey, payee.publicKey]),
      feePayer: payer.publicKey.toBase58(),
      localSigners: [payee],
      wallet: {
        publicKey: payer.publicKey.toBase58(),
        async signTransaction(tx: Transaction) {
          tx.partialSign(payer);
          return tx;
        },
      },
      blockhash: blockhash(),
    });
    expect(signed.verifySignatures()).toBe(true);
  });

  it('reports submit and confirmation failures', async () => {
    const payer = Keypair.generate();
    const { submitSigned, transactionSignature } = await payment();
    const options = { feePayer: payer, localSigners: [payer] };
    const hash = blockhash();
    let sends = 0;
    await expect(submitSigned({
      async getLatestBlockhash() {
        return { blockhash: hash, lastValidBlockHeight: 1 };
      },
      async sendRawTransaction() {
        sends += 1;
        throw new Error('down');
      },
    }, transfer(payer.publicKey, payer.publicKey), options)).rejects.toThrow('RPC submit failed: down');
    expect(sends).toBe(1);
    const program = await submitSigned({
      async getLatestBlockhash() {
        return { blockhash: hash, lastValidBlockHeight: 1 };
      },
      async sendRawTransaction() {
        return 'sig';
      },
      async confirmTransaction() {
        return { value: { err: { InstructionError: [2, { Custom: 1 }] } } };
      },
    }, transfer(payer.publicKey, payer.publicKey), options).catch((error: Error) => error);
    expect(program.message).toContain('Preflight failed');
    expect(program.message).toContain('InstructionError');
    expect(program.message).toContain('was not resubmitted');
    const expired = await submitSigned({
      async getLatestBlockhash() {
        return { blockhash: hash, lastValidBlockHeight: 1 };
      },
      async sendRawTransaction(raw: Uint8Array) {
        sends += 1;
        throw Object.assign(new Error('Transaction simulation failed: Blockhash not found'), { raw });
      },
      async getSignatureStatuses() {
        return { value: [null] };
      },
      async isBlockhashValid() {
        return { value: false };
      },
    }, transfer(payer.publicKey, payer.publicKey), options).catch((error: Error & { retrySafe?: boolean; signature?: string }) => error);
    expect(expired.message).toContain('Blockhash expired: Transaction simulation failed: Blockhash not found');
    expect(expired.message).toContain('The signature is not on Devnet');
    expect(expired.retrySafe).toBe(true);
    expect(sends).toBe(2);
    let signedId: string | null = null;
    const ambiguous = await submitSigned({
      async getLatestBlockhash() {
        return { blockhash: hash, lastValidBlockHeight: 1 };
      },
      async sendRawTransaction(raw: Uint8Array) {
        sends += 1;
        signedId = transactionSignature(Transaction.from(raw));
        throw new Error('failed to fetch');
      },
      async getSignatureStatuses() {
        throw new Error('status down');
      },
    }, transfer(payer.publicKey, payer.publicKey), options).catch((error: Error & { retrySafe?: boolean; signature?: string }) => error);
    expect(ambiguous.message).toContain('RPC network request failed: failed to fetch');
    expect(ambiguous.message).toContain('could not be checked');
    expect(ambiguous.retrySafe).toBe(false);
    expect(ambiguous.signature).toBe(signedId);
    expect(sends).toBe(3);
    const timedOut = await submitSigned({
      async getLatestBlockhash() {
        return { blockhash: hash, lastValidBlockHeight: 1 };
      },
      async sendRawTransaction() {
        return 'sig';
      },
      async confirmTransaction() {
        throw new Error('Transaction was not confirmed in 60000ms');
      },
      async getSignatureStatuses() {
        return { value: [null] };
      },
      async isBlockhashValid() {
        return { value: true };
      },
    }, transfer(payer.publicKey, payer.publicKey), options).catch((error: Error & { retrySafe?: boolean }) => error);
    expect(timedOut.message).toContain('Confirmation timed out');
    expect(timedOut.retrySafe).toBe(false);
    const badSignature = await submitSigned({
      async getLatestBlockhash() {
        return { blockhash: hash, lastValidBlockHeight: 1 };
      },
      async sendRawTransaction() {
        sends += 1;
        const failure = new Error('Transaction simulation failed: Signature verification failed');
        (failure as Error & { logs?: string[] }).logs = ['Program log: signature mismatch'];
        throw failure;
      },
      async getSignatureStatuses() {
        return { value: [null] };
      },
    }, transfer(payer.publicKey, payer.publicKey), options).catch((error: Error & { retrySafe?: boolean }) => error);
    expect(badSignature.message).toContain('Signature verification failed: Transaction simulation failed: Signature verification failed');
    expect(badSignature.message).toContain('Program log: signature mismatch');
    expect(badSignature.retrySafe).toBe(false);
    expect(sends).toBe(4);
  });

  it('rejects a bad mint, a token-account mismatch, a low balance, and Token-2022', async () => {
    const { checkFundAccounts } = await payment();
    const mint = Keypair.generate().publicKey.toBase58();
    const payer = Keypair.generate().publicKey.toBase58();
    const ok = { mint, mintOwner: TOKEN, tokenMint: mint, tokenOwner: payer, payer, balance: 10n, deposit: 10n };
    expect(() => checkFundAccounts(ok)).not.toThrow();
    expect(() => checkFundAccounts({ ...ok, mint: '' })).toThrow('mint is required');
    expect(() => checkFundAccounts({ ...ok, tokenMint: payer })).toThrow('Token account mint does not match');
    expect(() => checkFundAccounts({ ...ok, tokenOwner: mint })).toThrow('authority does not match');
    expect(() => checkFundAccounts({ ...ok, balance: 9n })).toThrow('Insufficient token balance');
    expect(() => checkFundAccounts({ ...ok, mintOwner: TOKEN_2022 })).toThrow('Token-2022 is not supported');
    expect(() => checkFundAccounts({ ...ok, mintOwner: payer })).toThrow('Unsupported token program');
  });
});

const ASSOCIATED = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';
const CHANNEL = 'CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX';

describe('browser funding', () => {
  it('charges the documented priority fee and stays inside the two-account cap', () => {
    expect(priorityFeeLamports(50_000, 1_000)).toBe(50);
    expect(priorityFeeLamports(ataComputeUnitLimit(1), ATA_PRIORITY_PRICE_MICROLAMPORTS)).toBe(28);
    expect(ataTransactionFeeLamports(1)).toBe(5_028);
    expect(ataTransactionFeeLamports(2)).toBe(5_055);
    expect(ataTransactionFeeLamports(1)).toBeLessThanOrEqual(ataTransactionFeeLamports(2));
    expect(openComputeUnitLimit()).toBe(75_292);
    expect(priorityFeeLamports(openComputeUnitLimit(), ATA_PRIORITY_PRICE_MICROLAMPORTS)).toBe(76);
    expect(openTransactionFeeLamports()).toBe(5_076);
  });
  function tokenData(mint: PublicKey, owner: PublicKey, amount: bigint): Buffer {
    const data = Buffer.alloc(165);
    mint.toBuffer().copy(data, 0);
    owner.toBuffer().copy(data, 32);
    data.writeBigUInt64LE(amount, 64);
    return data;
  }

  function ata(mint: PublicKey, owner: PublicKey): PublicKey {
    return getAssociatedTokenAddressSync(mint, owner, true);
  }

  function walletFor(signer: Keypair, sign?: (tx: Transaction) => Promise<Transaction>) {
    return {
      publicKey: signer.publicKey.toBase58(),
      signTransaction: sign ?? (async (tx: Transaction) => {
        tx.partialSign(signer);
        return tx;
      }),
    };
  }

  function mockConnection(state: { accounts: Map<string, { owner: PublicKey; data: Buffer } | null>; openFails: boolean; submitFails: boolean; feeLamports?: number | null; openFeeLamports?: number | null; unitsConsumed?: number }) {
    const sent: Transaction[] = [];
    let openFailed = false;
    return {
      sent,
      async getAccountInfo(key: PublicKey) {
        return state.accounts.get(key.toBase58()) ?? null;
      },
      async getSlot() {
        return 4;
      },
      async getLatestBlockhash() {
        return { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 9 };
      },
      async getFeeForMessage(message: { accountKeys: PublicKey[]; instructions: { programIdIndex: number }[] }) {
        const keys = message.accountKeys.map((key) => key.toBase58());
        const programs = message.instructions.map((ix) => keys[ix.programIdIndex]);
        if (programs.includes(CHANNEL)) {
          if (state.openFeeLamports !== undefined) return { value: state.openFeeLamports };
          return { value: openTransactionFeeLamports() };
        }
        if (state.feeLamports !== undefined) return { value: state.feeLamports };
        const ataCount = programs.filter((program) => program === ASSOCIATED).length;
        return { value: ataTransactionFeeLamports(ataCount) };
      },
      async simulateTransaction() {
        return { value: { unitsConsumed: state.unitsConsumed ?? 1, err: null } };
      },
      async getMinimumBalanceForRentExemption(size: number) {
        if (size === 256) return 1_950_720;
        if (size === 165) return 1_488_440;
        return null;
      },
      async sendRawTransaction(raw: Uint8Array) {
        if (state.submitFails) throw new Error('down');
        const tx = Transaction.from(raw);
        sent.push(tx);
        return `sig${sent.length}`;
      },
      async confirmTransaction() {
        const tx = sent[sent.length - 1];
        const creates = tx.instructions.filter((ix) => ix.programId.toBase58() === ASSOCIATED);
        for (const ix of creates) state.accounts.set(ix.keys[1].pubkey.toBase58(), { owner: new PublicKey(ASSOCIATED), data: Buffer.alloc(0) });
        if (creates.length === 0 && state.openFails && !openFailed) {
          openFailed = true;
          return { value: { err: { InstructionError: [0, 'Custom'] } } };
        }
        return { value: { err: null } };
      },
    };
  }

  function readyAccounts(mint: PublicKey, payer: PublicKey, amount = 10n, tokenMint = mint, tokenOwner = payer) {
    const accounts = new Map<string, { owner: PublicKey; data: Buffer } | null>();
    accounts.set(mint.toBase58(), { owner: new PublicKey(TOKEN), data: Buffer.alloc(82) });
    const payerAta = getAssociatedTokenAddressSync(mint, payer);
    accounts.set(payerAta.toBase58(), { owner: new PublicKey(TOKEN), data: tokenData(tokenMint, tokenOwner, amount) });
    return accounts;
  }

  function sessionFor(connection: ReturnType<typeof mockConnection>, payee: PublicKey, treasury: PublicKey) {
    return {
      connection,
      depositAmount: 10n,
      payment: { salt: 7n, graceSeconds: 30 },
      recipient: payee.toBase58(),
      agent: { publicKey: Keypair.generate().publicKey.toBase58() },
      treasuryOwner: treasury.toBase58(),
    };
  }

  async function fund() {
    const payment = await import('../payment.mjs') as { fundChannel: (session: Record<string, unknown>, mint: string, wallet?: { publicKey: string; signTransaction: (tx: Transaction) => Promise<Transaction> }) => Promise<{ openSignature: string; channel: string }> };
    return payment.fundChannel;
  }

  it('creates missing payee and treasury accounts, then opens, without the local payer secret', async () => {
    const payer = Keypair.generate();
    const payee = Keypair.generate().publicKey;
    const treasury = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const accounts = readyAccounts(mint, payer.publicKey);
    const connection = mockConnection({ accounts, openFails: false, submitFails: false });
    const previousRails = process.env.ATLAS_RAILS_KEY_PATH;
    const previousSecret = process.env.DEMO_FUNDER_SECRET_KEY;
    process.env.ATLAS_RAILS_KEY_PATH = join(tempDir(), 'absent.json');
    delete process.env.DEMO_FUNDER_SECRET_KEY;
    try {
      const fundChannel = await fund();
      const opened = await fundChannel(sessionFor(connection, payee, treasury), mint.toBase58(), walletFor(payer));
      expect(opened.channel).toBeTruthy();
      expect(connection.sent).toHaveLength(2);
      const first = connection.sent[0].instructions;
      expect(first.map((ix) => ix.programId.toBase58())).toEqual([COMPUTE_BUDGET, COMPUTE_BUDGET, ASSOCIATED, ASSOCIATED]);
      expect(first[0].data[0]).toBe(2);
      expect(first[0].data.readUInt32LE(1)).toBe(ataComputeUnitLimit(2));
      expect(first[1].data[0]).toBe(3);
      expect(first[1].data.readBigUInt64LE(1)).toBe(BigInt(ATA_PRIORITY_PRICE_MICROLAMPORTS));
      const creates = first.slice(2);
      expect(creates.map((ix) => ix.keys[2].pubkey.toBase58())).toEqual([payee.toBase58(), treasury.toBase58()]);
      for (const ix of creates) {
        expect(ix.programId.toBase58()).toBe(ASSOCIATED);
        expect([...ix.data]).toEqual([1]);
        expect(ix.keys[0].pubkey.toBase58()).toBe(payer.publicKey.toBase58());
        expect(ix.keys[0].isSigner).toBe(true);
        expect(ix.keys[2].isSigner).toBe(false);
        expect(ix.keys[5].pubkey.toBase58()).toBe(TOKEN);
      }
      const openInstructions = connection.sent[1].instructions;
      expect(openInstructions.map((ix) => ix.programId.toBase58())).toEqual([COMPUTE_BUDGET, COMPUTE_BUDGET, CHANNEL]);
      expect(openInstructions[0].data[0]).toBe(2);
      expect(openInstructions[0].data.readUInt32LE(1)).toBe(openComputeUnitLimit());
      expect(openInstructions[1].data[0]).toBe(3);
      expect(openInstructions[1].data.readBigUInt64LE(1)).toBe(BigInt(ATA_PRIORITY_PRICE_MICROLAMPORTS));
      const open = openInstructions[2];
      expect(open.programId.toBase58()).toBe(CHANNEL);
      expect(open.data[0]).toBe(1);
      expect(open.data.readBigUInt64LE(9)).toBe(10n);
      expect(open.keys[2].isSigner).toBe(false);
      expect(connection.sent.every((tx) => tx.instructions.every((ix) => ix.programId.toBase58() !== TOKEN))).toBe(true);
    } finally {
      if (previousRails === undefined) delete process.env.ATLAS_RAILS_KEY_PATH;
      else process.env.ATLAS_RAILS_KEY_PATH = previousRails;
      if (previousSecret === undefined) delete process.env.DEMO_FUNDER_SECRET_KEY;
      else process.env.DEMO_FUNDER_SECRET_KEY = previousSecret;
    }
  });

  it('skips account creation when the payee and treasury accounts exist', async () => {
    const payer = Keypair.generate();
    const payee = Keypair.generate().publicKey;
    const treasury = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const accounts = readyAccounts(mint, payer.publicKey);
    accounts.set(ata(mint, payee).toBase58(), { owner: new PublicKey(TOKEN), data: Buffer.alloc(0) });
    accounts.set(ata(mint, treasury).toBase58(), { owner: new PublicKey(TOKEN), data: Buffer.alloc(0) });
    const connection = mockConnection({ accounts, openFails: false, submitFails: false });
    const fundChannel = await fund();
    await fundChannel(sessionFor(connection, payee, treasury), mint.toBase58(), walletFor(payer));
    expect(connection.sent).toHaveLength(1);
    expect(connection.sent[0].instructions.map((ix) => ix.programId.toBase58())).toEqual([COMPUTE_BUDGET, COMPUTE_BUDGET, CHANNEL]);
  });

  it('rejects an open fee outside the policy and does not broadcast it', async () => {
    const payer = Keypair.generate();
    const payee = Keypair.generate().publicKey;
    const treasury = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const accounts = readyAccounts(mint, payer.publicKey);
    accounts.set(ata(mint, payee).toBase58(), { owner: new PublicKey(TOKEN), data: Buffer.alloc(0) });
    accounts.set(ata(mint, treasury).toBase58(), { owner: new PublicKey(TOKEN), data: Buffer.alloc(0) });
    const fundChannel = await fund();
    const run = (state: { openFeeLamports?: number | null; unitsConsumed?: number }, wallet = walletFor(payer)) => {
      const connection = mockConnection({ accounts, openFails: false, submitFails: false, ...state });
      return { connection, result: fundChannel(sessionFor(connection, payee, treasury), mint.toBase58(), wallet) };
    };
    const overCap = run({ openFeeLamports: 9_000_000 });
    await expect(overCap.result).rejects.toThrow('exceeds the cap');
    expect(overCap.connection.sent).toHaveLength(0);
    const mismatch = run({ openFeeLamports: openTransactionFeeLamports() - 1 });
    await expect(mismatch.result).rejects.toThrow('does not match the policy');
    expect(mismatch.connection.sent).toHaveLength(0);
    const overUnits = run({ unitsConsumed: 5_000_000 });
    await expect(overUnits.result).rejects.toThrow('exceeds the limit');
    expect(overUnits.connection.sent).toHaveLength(0);
    const noFee = run({ openFeeLamports: null });
    await expect(noFee.result).rejects.toThrow('unavailable');
    expect(noFee.connection.sent).toHaveLength(0);
    const mutated = run({}, walletFor(payer, async (tx) => {
      tx.instructions.push(ComputeBudgetProgram.setComputeUnitLimit({ units: 1 }));
      tx.partialSign(payer);
      return tx;
    }));
    await expect(mutated.result).rejects.toThrow('message changed');
    expect(mutated.connection.sent).toHaveLength(0);
  });

  it('rejects a bad mint, token account, or balance before submission', async () => {
    const payer = Keypair.generate();
    const payee = Keypair.generate().publicKey;
    const treasury = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const fundChannel = await fund();
    const run = (accounts: Map<string, { owner: PublicKey; data: Buffer } | null>) => {
      const connection = mockConnection({ accounts, openFails: false, submitFails: false });
      return fundChannel(sessionFor(connection, payee, treasury), mint.toBase58(), walletFor(payer));
    };
    await expect(fundChannel(sessionFor(mockConnection({ accounts: new Map(), openFails: false, submitFails: false }), payee, treasury), '', walletFor(payer))).rejects.toThrow('mint is required');
    const token2022 = readyAccounts(mint, payer.publicKey);
    token2022.set(mint.toBase58(), { owner: new PublicKey(TOKEN_2022), data: Buffer.alloc(82) });
    await expect(run(token2022)).rejects.toThrow('Token-2022 is not supported');
    await expect(run(readyAccounts(mint, payer.publicKey, 10n, Keypair.generate().publicKey))).rejects.toThrow('Token account mint does not match');
    await expect(run(readyAccounts(mint, payer.publicKey, 10n, mint, payee))).rejects.toThrow('authority does not match');
    await expect(run(readyAccounts(mint, payer.publicKey, 9n))).rejects.toThrow('Insufficient token balance');
  });

  it('stops on wallet rejection, a missing signature, and separates submit from confirmation', async () => {
    const payer = Keypair.generate();
    const payee = Keypair.generate().publicKey;
    const treasury = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const fundChannel = await fund();
    const rejected = mockConnection({ accounts: readyAccounts(mint, payer.publicKey), openFails: false, submitFails: false });
    await expect(fundChannel(sessionFor(rejected, payee, treasury), mint.toBase58(), walletFor(payer, async () => { throw new Error('User rejected the request'); }))).rejects.toThrow('User rejected');
    expect(rejected.sent).toHaveLength(0);
    const mutated = mockConnection({ accounts: readyAccounts(mint, payer.publicKey), openFails: false, submitFails: false });
    await expect(fundChannel(sessionFor(mutated, payee, treasury), mint.toBase58(), walletFor(payer, async (tx) => {
      tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }));
      tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }));
      tx.partialSign(payer);
      return tx;
    }))).rejects.toThrow('message changed');
    expect(mutated.sent).toHaveLength(0);
    const overCap = mockConnection({ accounts: readyAccounts(mint, payer.publicKey), openFails: false, submitFails: false, feeLamports: 9_000_000 });
    await expect(fundChannel(sessionFor(overCap, payee, treasury), mint.toBase58(), walletFor(payer))).rejects.toThrow('does not match the policy');
    expect(overCap.sent).toHaveLength(0);
    const overUnits = mockConnection({ accounts: readyAccounts(mint, payer.publicKey), openFails: false, submitFails: false, unitsConsumed: 5_000_000 });
    await expect(fundChannel(sessionFor(overUnits, payee, treasury), mint.toBase58(), walletFor(payer))).rejects.toThrow('exceeds the limit');
    expect(overUnits.sent).toHaveLength(0);
    const noFee = mockConnection({ accounts: readyAccounts(mint, payer.publicKey), openFails: false, submitFails: false, feeLamports: null });
    await expect(fundChannel(sessionFor(noFee, payee, treasury), mint.toBase58(), walletFor(payer))).rejects.toThrow('unavailable');
    expect(noFee.sent).toHaveLength(0);
    const unsigned = mockConnection({ accounts: readyAccounts(mint, payer.publicKey), openFails: false, submitFails: false });
    await expect(fundChannel(sessionFor(unsigned, payee, treasury), mint.toBase58(), walletFor(payer, async (tx) => tx))).rejects.toThrow('Missing required signature');
    expect(unsigned.sent).toHaveLength(0);
    const submit = mockConnection({ accounts: readyAccounts(mint, payer.publicKey), openFails: false, submitFails: true });
    await expect(fundChannel(sessionFor(submit, payee, treasury), mint.toBase58(), walletFor(payer))).rejects.toThrow('RPC submit failed');
    const confirm = mockConnection({ accounts: readyAccounts(mint, payer.publicKey), openFails: true, submitFails: false });
    await expect(fundChannel(sessionFor(confirm, payee, treasury), mint.toBase58(), walletFor(payer))).rejects.toThrow('Preflight failed');
    expect(confirm.sent).toHaveLength(2);
    await fundChannel(sessionFor(confirm, payee, treasury), mint.toBase58(), walletFor(payer));
    expect(confirm.sent).toHaveLength(3);
    expect(confirm.sent[2].instructions[2].programId.toBase58()).toBe(CHANNEL);
  });
});
