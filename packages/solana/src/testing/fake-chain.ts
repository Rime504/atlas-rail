import { ed25519 } from '@noble/curves/ed25519';
import { base58 } from '@scure/base';
import { Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { ALLOWED_SOLANA_PROGRAM_IDS } from '@atlas-rail/config';
import { ChainClient, ChainTransactionSummary, MintInfo, summarizeTransaction } from '../chain';
import { PreflightSimulation, decodeTransaction } from '../x402-payment';

/**
 * A small in-memory Solana cluster for hermetic tests and the offline demo (`apps/mock-validator`
 * serves it over JSON-RPC). It is NOT the Solana runtime: it implements exactly the instructions the
 * x402 exact scheme, Atlas Rail and the demo setup use — compute-budget, memo, System transfer /
 * create-account, SPL Token TransferChecked / InitializeMint2 / MintTo, and the Associated Token
 * Account program — with the checks that matter for correctness (signatures, blockhash validity,
 * replay, balances, ownership, mint/decimals, mint authority, ATA derivation).
 *
 * Live-cluster behaviour is verified separately against devnet (see docs/DEMO.md).
 */

const COMPUTE_BUDGET = ALLOWED_SOLANA_PROGRAM_IDS.COMPUTE_BUDGET_PROGRAM;
const MEMO = ALLOWED_SOLANA_PROGRAM_IDS.MEMO_PROGRAM;
const TOKEN = ALLOWED_SOLANA_PROGRAM_IDS.TOKEN_PROGRAM;
const SYSTEM = ALLOWED_SOLANA_PROGRAM_IDS.SYSTEM_PROGRAM;
const ATA = ALLOWED_SOLANA_PROGRAM_IDS.ASSOCIATED_TOKEN_PROGRAM;
const LAMPORTS_PER_SIGNATURE = 5000n;
const RENT_TOKEN_ACCOUNT = 2_039_280n;
const RENT_MINT = 1_461_600n;

interface TokenAccount {
  mint: string;
  owner: string;
  amount: bigint;
}

interface MintAccount {
  decimals: number;
  authority: string | null;
  supply: bigint;
}

interface State {
  lamports: Map<string, bigint>;
  tokenAccounts: Map<string, TokenAccount>;
  mints: Map<string, MintAccount>;
  /** Accounts created by System CreateAccount for the Token program, awaiting InitializeMint2. */
  pendingMints: Set<string>;
}

function cloneState(state: State): State {
  return {
    lamports: new Map(state.lamports),
    tokenAccounts: new Map([...state.tokenAccounts].map(([k, v]) => [k, { ...v }])),
    mints: new Map([...state.mints].map(([k, v]) => [k, { ...v }])),
    pendingMints: new Set(state.pendingMints),
  };
}

const PROGRAMS = new Set<string>([COMPUTE_BUDGET, MEMO, TOKEN, SYSTEM, ATA]);

export interface FakeAccountInfo {
  owner: string;
  lamports: bigint;
  executable: boolean;
  data: Uint8Array;
}

export class FakeChain implements ChainClient {
  private state: State = { lamports: new Map(), tokenAccounts: new Map(), mints: new Map(), pendingMints: new Set() };
  private readonly blockhashes = new Set<string>();
  private readonly processed = new Map<string, { summary: ChainTransactionSummary; tx: VersionedTransaction }>();
  slot = 1000;
  /** Unix seconds reported as block time; tests can move it. */
  now: () => number = () => Math.floor(Date.now() / 1000);
  /** Every memo that has been successfully processed, in order. */
  readonly memos: string[] = [];
  simulateCalls = 0;
  sendCalls = 0;

  /* ---- test setup (direct state manipulation) ------------------------------------------------- */

  airdrop(address: string, lamports: bigint): void {
    this.state.lamports.set(address, (this.state.lamports.get(address) ?? 0n) + lamports);
  }

  createMint(mint: string, decimals: number, authority: string | null = null): void {
    this.state.mints.set(mint, { decimals, authority, supply: 0n });
  }

  /** Creates (or tops up) the owner's associated token account for `mint`. */
  fundTokens(owner: string, mint: string, amount: bigint): string {
    const ata = getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner), false, TOKEN_PROGRAM_ID).toBase58();
    const existing = this.state.tokenAccounts.get(ata);
    this.state.tokenAccounts.set(ata, { mint, owner, amount: (existing?.amount ?? 0n) + amount });
    return ata;
  }

  tokenBalance(owner: string, mint: string): bigint {
    const ata = getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner), false, TOKEN_PROGRAM_ID).toBase58();
    return this.state.tokenAccounts.get(ata)?.amount ?? 0n;
  }

  lamportBalance(address: string): bigint {
    return this.state.lamports.get(address) ?? 0n;
  }

  async getBalanceLamports(address: string): Promise<bigint> {
    return this.lamportBalance(address);
  }

  async requestAirdrop(address: string, lamports: bigint): Promise<void> {
    this.airdrop(address, lamports);
  }

  async getTokenBalance(owner: string, mint: string): Promise<bigint> {
    return this.tokenBalance(owner, mint);
  }

  /* ---- ChainClient --------------------------------------------------------------------------- */

  async getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    const blockhash = Keypair.generate().publicKey.toBase58();
    this.blockhashes.add(blockhash);
    return { blockhash, lastValidBlockHeight: this.slot + 150 };
  }

  async getMintInfo(mint: string): Promise<MintInfo | null> {
    const found = this.state.mints.get(mint);
    return found ? { decimals: found.decimals, tokenProgram: TOKEN } : null;
  }

  async simulate(transactionBase64: string): Promise<PreflightSimulation> {
    this.simulateCalls += 1;
    const tx = decodeTransaction(transactionBase64);
    const scratch = cloneState(this.state);
    const result = this.execute(tx, scratch, { requireSignatures: false, checkBlockhash: false });
    return { success: result.err === null, error: result.err, logs: result.logs, unitsConsumed: result.err === null ? 18_000 : null };
  }

  async sendAndConfirm(signedTransactionBase64: string): Promise<string> {
    this.sendCalls += 1;
    return this.submit(decodeTransaction(signedTransactionBase64));
  }

  async getTransactionSummary(signature: string): Promise<ChainTransactionSummary | null> {
    const found = this.processed.get(signature);
    return found ? structuredClone(found.summary) : null;
  }

  /** Executes and records a signed transaction. Throws on failure. Used by ChainClient and the RPC server. */
  submit(tx: VersionedTransaction): string {
    const signature = base58.encode(tx.signatures[0]);
    if (this.processed.has(signature)) throw new Error('AlreadyProcessed');
    const scratch = cloneState(this.state);
    const result = this.execute(tx, scratch, { requireSignatures: true, checkBlockhash: true });
    if (result.err !== null) throw new Error(`Transaction ${signature} failed: ${result.err}`);
    this.state = scratch;
    this.slot += 1;
    this.memos.push(...result.memos);
    this.processed.set(signature, {
      summary: summarizeTransaction(signature, tx, { slot: this.slot, blockTime: this.now(), err: null }),
      tx,
    });
    return signature;
  }

  /* ---- read views used by the JSON-RPC server -------------------------------------------------- */

  getAccount(address: string): FakeAccountInfo | null {
    if (PROGRAMS.has(address)) return { owner: 'NativeLoader1111111111111111111111111111111', lamports: 1n, executable: true, data: new Uint8Array() };
    const mint = this.state.mints.get(address);
    if (mint) return { owner: TOKEN, lamports: RENT_MINT, executable: false, data: encodeMint(mint) };
    const token = this.state.tokenAccounts.get(address);
    if (token) return { owner: TOKEN, lamports: RENT_TOKEN_ACCOUNT, executable: false, data: encodeTokenAccount(token) };
    const lamports = this.state.lamports.get(address);
    if (lamports !== undefined) return { owner: SYSTEM, lamports, executable: false, data: new Uint8Array() };
    return null;
  }

  getProcessed(signature: string): { summary: ChainTransactionSummary; tx: VersionedTransaction } | null {
    return this.processed.get(signature) ?? null;
  }

  isKnownBlockhash(blockhash: string): boolean {
    return this.blockhashes.has(blockhash);
  }

  /* ---- execution ----------------------------------------------------------------------------- */

  private execute(
    tx: VersionedTransaction,
    state: State,
    options: { requireSignatures: boolean; checkBlockhash: boolean },
  ): { err: string | null; logs: string[]; memos: string[] } {
    const logs: string[] = [];
    const memos: string[] = [];
    const message = tx.message;
    const keys = message.staticAccountKeys;
    const fail = (err: string) => ({ err, logs, memos: [] as string[] });

    if (message.addressTableLookups.length > 0) return fail('AddressLookupTableNotSupported');
    if (options.checkBlockhash && !this.blockhashes.has(message.recentBlockhash)) return fail('BlockhashNotFound');

    const required = message.header.numRequiredSignatures;
    if (options.requireSignatures) {
      const bytes = message.serialize();
      for (let i = 0; i < required; i++) {
        const sig = tx.signatures[i];
        if (!sig || sig.every((b) => b === 0) || !ed25519.verify(sig, bytes, keys[i].toBytes())) {
          return fail(`SignatureFailure: missing or invalid signature for ${keys[i].toBase58()}`);
        }
      }
    }
    const signers = new Set(keys.slice(0, required).map((k) => k.toBase58()));

    // Fees: 5000 lamports per signature from the fee payer.
    const feePayer = keys[0].toBase58();
    const fee = LAMPORTS_PER_SIGNATURE * BigInt(required);
    const feePayerBalance = state.lamports.get(feePayer);
    if (feePayerBalance === undefined) return fail('AccountNotFound');
    if (feePayerBalance < fee) return fail('InsufficientFundsForFee');
    state.lamports.set(feePayer, feePayerBalance - fee);

    const debit = (address: string, amount: bigint): boolean => {
      const balance = state.lamports.get(address) ?? 0n;
      if (balance < amount) return false;
      state.lamports.set(address, balance - amount);
      return true;
    };

    for (const ix of message.compiledInstructions) {
      const programId = keys[ix.programIdIndex].toBase58();
      const accounts = ix.accountKeyIndexes.map((i) => keys[i].toBase58());
      const data = ix.data;
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

      if (programId === COMPUTE_BUDGET) {
        logs.push('Program ComputeBudget invoke');
      } else if (programId === MEMO) {
        const text = Buffer.from(data).toString('utf8');
        memos.push(text);
        logs.push(`Program log: Memo (len ${data.length}): "${text}"`);
        // The memo program requires any accounts passed to it to be signers.
        for (const account of accounts) if (!signers.has(account)) return fail('MemoRequiresSigner');
      } else if (programId === SYSTEM) {
        const kind = data.length >= 4 ? view.getUint32(0, true) : -1;
        if (kind === 2 && data.length === 12) {
          const lamports = view.getBigUint64(4, true);
          const [from, to] = accounts;
          if (!signers.has(from)) return fail('MissingRequiredSignature');
          if (!debit(from, lamports)) return fail('InsufficientFunds');
          state.lamports.set(to, (state.lamports.get(to) ?? 0n) + lamports);
        } else if (kind === 0 && data.length === 52) {
          // CreateAccount { lamports, space, owner }
          const lamports = view.getBigUint64(4, true);
          const owner = new PublicKey(data.slice(20, 52)).toBase58();
          const [from, created] = accounts;
          if (!signers.has(from) || !signers.has(created)) return fail('MissingRequiredSignature');
          if (state.mints.has(created) || state.tokenAccounts.has(created) || state.pendingMints.has(created)) return fail('AccountAlreadyInUse');
          if (!debit(from, lamports)) return fail('InsufficientFunds');
          if (owner === TOKEN) state.pendingMints.add(created);
          else state.lamports.set(created, (state.lamports.get(created) ?? 0n) + lamports);
        } else {
          return fail('UnsupportedSystemInstruction');
        }
      } else if (programId === TOKEN) {
        const kind = data[0];
        if (kind === 12 && data.length === 10) {
          const amount = view.getBigUint64(1, true);
          const decimals = data[9];
          const [source, mint, destination, authority] = accounts;
          const from = state.tokenAccounts.get(source);
          const to = state.tokenAccounts.get(destination);
          const mintInfo = state.mints.get(mint);
          if (!from || !to || !mintInfo) return fail('AccountNotFound');
          if (from.mint !== mint || to.mint !== mint) return fail('MintMismatch');
          if (mintInfo.decimals !== decimals) return fail('MintDecimalsMismatch');
          if (from.owner !== authority) return fail('OwnerMismatch');
          if (!signers.has(authority)) return fail('MissingRequiredSignature');
          if (from.amount < amount) return fail('InsufficientFunds');
          from.amount -= amount;
          to.amount += amount;
          logs.push('Program log: Instruction: TransferChecked');
        } else if (kind === 20 && data.length >= 34) {
          // InitializeMint2 { decimals, mintAuthority, freezeAuthority? }
          const [mint] = accounts;
          if (!state.pendingMints.has(mint)) return fail('InvalidAccountData');
          const authority = new PublicKey(data.slice(2, 34)).toBase58();
          state.pendingMints.delete(mint);
          state.mints.set(mint, { decimals: data[1], authority, supply: 0n });
          logs.push('Program log: Instruction: InitializeMint2');
        } else if ((kind === 7 && data.length === 9) || (kind === 14 && data.length === 10)) {
          // MintTo / MintToChecked
          const amount = view.getBigUint64(1, true);
          const [mint, destination, authority] = accounts;
          const mintInfo = state.mints.get(mint);
          const to = state.tokenAccounts.get(destination);
          if (!mintInfo || !to) return fail('AccountNotFound');
          if (to.mint !== mint) return fail('MintMismatch');
          if (mintInfo.authority !== authority) return fail('OwnerMismatch');
          if (!signers.has(authority)) return fail('MissingRequiredSignature');
          if (kind === 14 && data[9] !== mintInfo.decimals) return fail('MintDecimalsMismatch');
          mintInfo.supply += amount;
          to.amount += amount;
          logs.push('Program log: Instruction: MintTo');
        } else {
          return fail('UnsupportedTokenInstruction');
        }
      } else if (programId === ATA) {
        // Create (empty data or [0]) / CreateIdempotent ([1])
        const idempotent = data.length === 1 && data[0] === 1;
        const [payer, ata, owner, mint] = accounts;
        if (!signers.has(payer)) return fail('MissingRequiredSignature');
        const derived = getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner), true, TOKEN_PROGRAM_ID).toBase58();
        if (derived !== ata) return fail('InvalidSeeds');
        if (!state.mints.has(mint)) return fail('InvalidMint');
        if (state.tokenAccounts.has(ata)) {
          if (!idempotent) return fail('AccountAlreadyInUse');
        } else {
          if (!debit(payer, RENT_TOKEN_ACCOUNT)) return fail('InsufficientFunds');
          state.tokenAccounts.set(ata, { mint, owner, amount: 0n });
        }
        logs.push('Program log: Create');
      } else {
        return fail(`InvalidProgramForExecution: ${programId}`);
      }
    }
    return { err: null, logs, memos };
  }
}

/** SPL Token Mint account layout (82 bytes). */
function encodeMint(mint: MintAccount): Uint8Array {
  const out = new Uint8Array(82);
  const view = new DataView(out.buffer);
  if (mint.authority) {
    view.setUint32(0, 1, true);
    out.set(new PublicKey(mint.authority).toBytes(), 4);
  }
  view.setBigUint64(36, mint.supply, true);
  out[44] = mint.decimals;
  out[45] = 1; // initialized
  return out;
}

/** SPL Token Account layout (165 bytes). */
function encodeTokenAccount(account: TokenAccount): Uint8Array {
  const out = new Uint8Array(165);
  const view = new DataView(out.buffer);
  out.set(new PublicKey(account.mint).toBytes(), 0);
  out.set(new PublicKey(account.owner).toBytes(), 32);
  view.setBigUint64(64, account.amount, true);
  out[108] = 1; // initialized
  return out;
}
