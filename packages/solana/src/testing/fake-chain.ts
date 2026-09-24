import { ed25519 } from '@noble/curves/ed25519';
import { base58 } from '@scure/base';
import { Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { ALLOWED_SOLANA_PROGRAM_IDS } from '@atlas-rail/config';
import {
  ChainClient,
  ChainTransactionSummary,
  MintInfo,
  summarizeTransaction,
} from '../chain';
import { PreflightSimulation, decodeTransaction } from '../x402-payment';

/**
 * A small in-memory Solana cluster for hermetic tests and the offline demo. It is NOT the Solana
 * runtime: it implements exactly the instructions the x402 exact scheme and Atlas Rail use
 * (compute-budget, memo, SPL Token TransferChecked, System transfer) with the checks that matter for
 * correctness (signatures, blockhash validity, replay, balances, ownership, mint/decimals), so the
 * whole 402 → gate → sign → settle → receipt → anchor loop can run without a network.
 *
 * Live-cluster behaviour is verified separately against devnet (see docs/DEMO.md).
 */

const COMPUTE_BUDGET = ALLOWED_SOLANA_PROGRAM_IDS.COMPUTE_BUDGET_PROGRAM;
const MEMO = ALLOWED_SOLANA_PROGRAM_IDS.MEMO_PROGRAM;
const TOKEN = ALLOWED_SOLANA_PROGRAM_IDS.TOKEN_PROGRAM;
const SYSTEM = ALLOWED_SOLANA_PROGRAM_IDS.SYSTEM_PROGRAM;
const LAMPORTS_PER_SIGNATURE = 5000n;

interface TokenAccount {
  mint: string;
  owner: string;
  amount: bigint;
}

interface State {
  lamports: Map<string, bigint>;
  tokenAccounts: Map<string, TokenAccount>;
}

function cloneState(state: State): State {
  return {
    lamports: new Map(state.lamports),
    tokenAccounts: new Map([...state.tokenAccounts].map(([k, v]) => [k, { ...v }])),
  };
}

export class FakeChain implements ChainClient {
  private state: State = { lamports: new Map(), tokenAccounts: new Map() };
  private readonly mints = new Map<string, MintInfo>();
  private readonly blockhashes = new Set<string>();
  private readonly processed = new Map<string, ChainTransactionSummary>();
  slot = 1000;
  /** Unix seconds reported as block time; tests can move it. */
  now: () => number = () => Math.floor(Date.now() / 1000);
  /** Every memo that has been successfully processed, in order. */
  readonly memos: string[] = [];
  simulateCalls = 0;
  sendCalls = 0;

  /* ---- test setup ---------------------------------------------------------------------------- */

  airdrop(address: string, lamports: bigint): void {
    this.state.lamports.set(address, (this.state.lamports.get(address) ?? 0n) + lamports);
  }

  createMint(mint: string, decimals: number): void {
    this.mints.set(mint, { decimals, tokenProgram: TOKEN });
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

  /* ---- ChainClient --------------------------------------------------------------------------- */

  async getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    const blockhash = Keypair.generate().publicKey.toBase58();
    this.blockhashes.add(blockhash);
    return { blockhash, lastValidBlockHeight: this.slot + 150 };
  }

  async getMintInfo(mint: string): Promise<MintInfo | null> {
    return this.mints.get(mint) ?? null;
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
    const tx = decodeTransaction(signedTransactionBase64);
    const signature = base58.encode(tx.signatures[0]);
    if (this.processed.has(signature)) throw new Error('AlreadyProcessed');
    const scratch = cloneState(this.state);
    const result = this.execute(tx, scratch, { requireSignatures: true, checkBlockhash: true });
    if (result.err !== null) throw new Error(`Transaction ${signature} failed: ${result.err}`);
    this.state = scratch;
    this.slot += 1;
    this.memos.push(...result.memos);
    this.processed.set(
      signature,
      summarizeTransaction(signature, tx, { slot: this.slot, blockTime: this.now(), err: null }),
    );
    return signature;
  }

  async getTransactionSummary(signature: string): Promise<ChainTransactionSummary | null> {
    const found = this.processed.get(signature);
    return found ? structuredClone(found) : null;
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

    for (const ix of message.compiledInstructions) {
      const programId = keys[ix.programIdIndex].toBase58();
      const accounts = ix.accountKeyIndexes.map((i) => keys[i].toBase58());
      const data = ix.data;

      if (programId === COMPUTE_BUDGET) {
        logs.push('Program ComputeBudget invoke');
      } else if (programId === MEMO) {
        const text = Buffer.from(data).toString('utf8');
        memos.push(text);
        logs.push(`Program log: Memo (len ${data.length}): "${text}"`);
        // The memo program requires any accounts passed to it to be signers.
        for (const account of accounts) if (!signers.has(account)) return fail('MemoRequiresSigner');
      } else if (programId === SYSTEM) {
        if (data.length !== 12 || new DataView(data.buffer, data.byteOffset).getUint32(0, true) !== 2) return fail('UnsupportedSystemInstruction');
        const lamports = new DataView(data.buffer, data.byteOffset).getBigUint64(4, true);
        const [from, to] = accounts;
        if (!signers.has(from)) return fail('MissingRequiredSignature');
        const balance = state.lamports.get(from) ?? 0n;
        if (balance < lamports) return fail('InsufficientFunds');
        state.lamports.set(from, balance - lamports);
        state.lamports.set(to, (state.lamports.get(to) ?? 0n) + lamports);
      } else if (programId === TOKEN) {
        if (data.length !== 10 || data[0] !== 12) return fail('UnsupportedTokenInstruction');
        const amount = new DataView(data.buffer, data.byteOffset).getBigUint64(1, true);
        const decimals = data[9];
        const [source, mint, destination, authority] = accounts;
        const from = state.tokenAccounts.get(source);
        const to = state.tokenAccounts.get(destination);
        const mintInfo = this.mints.get(mint);
        if (!from || !to || !mintInfo) return fail('AccountNotFound');
        if (from.mint !== mint || to.mint !== mint) return fail('MintMismatch');
        if (mintInfo.decimals !== decimals) return fail('MintDecimalsMismatch');
        if (from.owner !== authority) return fail('OwnerMismatch');
        if (!signers.has(authority)) return fail('MissingRequiredSignature');
        if (from.amount < amount) return fail('InsufficientFunds');
        from.amount -= amount;
        to.amount += amount;
        logs.push('Program log: Instruction: TransferChecked');
      } else {
        return fail(`InvalidProgramForExecution: ${programId}`);
      }
    }
    return { err: null, logs, memos };
  }
}
