import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { ChainClient } from './chain';

/**
 * Devnet demo asset preparation: fund keys, create the demo USDC-like mint, create associated token
 * accounts and mint balances. Written against {@link ChainClient} so the identical code runs on
 * devnet, against the offline mock validator, and in unit tests.
 */

export interface FundableChain extends ChainClient {
  getBalanceLamports(address: string): Promise<bigint>;
  /** Requests a faucet airdrop. May be rate limited on public devnet. */
  requestAirdrop(address: string, lamports: bigint): Promise<void>;
}

export class FundingError extends Error {
  constructor(
    message: string,
    public readonly address: string,
  ) {
    super(message);
    this.name = 'FundingError';
  }
}

async function send(chain: ChainClient, feePayer: Keypair, instructions: TransactionInstruction[], extraSigners: Keypair[] = []) {
  const { blockhash } = await chain.getLatestBlockhash();
  const message = new TransactionMessage({ payerKey: feePayer.publicKey, recentBlockhash: blockhash, instructions }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([feePayer, ...extraSigners]);
  return chain.sendAndConfirm(Buffer.from(tx.serialize()).toString('base64'));
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface EnsureSolOptions {
  /** A devnet wallet you funded (e.g. from faucet.solana.com) used when the public airdrop is rate limited. */
  funder?: Keypair | null;
  attempts?: number;
  log?: (message: string) => void;
  sleepMs?: (attempt: number) => number;
}

/**
 * Makes sure `target` holds at least `minLamports`. Tries the faucet with backoff (the public devnet
 * faucet is frequently rate limited), then falls back to transferring from a pre-funded wallet.
 * Throws a {@link FundingError} with concrete next steps if neither works.
 */
export async function ensureSol(chain: FundableChain, target: string, minLamports: bigint, options: EnsureSolOptions = {}): Promise<void> {
  const log = options.log ?? (() => {});
  if ((await chain.getBalanceLamports(target)) >= minLamports) return;

  const attempts = options.attempts ?? 4;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      log(`airdrop attempt ${attempt}/${attempts} to ${target}`);
      await chain.requestAirdrop(target, minLamports > 1_000_000_000n ? minLamports : 1_000_000_000n);
      for (let poll = 0; poll < 20; poll++) {
        if ((await chain.getBalanceLamports(target)) >= minLamports) return;
        await sleep(500);
      }
    } catch (error) {
      log(`airdrop failed: ${error instanceof Error ? error.message.slice(0, 120) : String(error)}`);
    }
    await sleep(options.sleepMs ? options.sleepMs(attempt) : attempt * 2000);
  }

  const funder = options.funder;
  if (funder && funder.publicKey.toBase58() !== target) {
    const funderBalance = await chain.getBalanceLamports(funder.publicKey.toBase58());
    if (funderBalance > minLamports + 10_000n) {
      log(`falling back to the pre-funded wallet ${funder.publicKey.toBase58()}`);
      await send(chain, funder, [SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: new PublicKey(target), lamports: minLamports })]);
      return;
    }
  }
  throw new FundingError(
    `Could not fund ${target} with devnet SOL: the public faucet is rate limited and no pre-funded wallet with enough balance was available. ` +
      `Send at least ${Number(minLamports) / 1e9} SOL to ${target} from https://faucet.solana.com (or set DEMO_FUNDER_SECRET_KEY to a funded devnet wallet) and re-run.`,
    target,
  );
}

/** Creates the mint if it does not exist yet. Returns true if it was created. */
export async function ensureMint(
  chain: FundableChain,
  payer: Keypair,
  mint: Keypair,
  decimals: number,
): Promise<boolean> {
  if (await chain.getMintInfo(mint.publicKey.toBase58())) return false;
  const lamports = 1_461_600; // rent-exempt minimum for an 82-byte mint account
  await send(
    chain,
    payer,
    [
      SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey, lamports, space: 82, programId: TOKEN_PROGRAM_ID }),
      createInitializeMint2Instruction(mint.publicKey, decimals, payer.publicKey, null, TOKEN_PROGRAM_ID),
    ],
    [mint],
  );
  return true;
}

/** Creates the owner's associated token account for `mint` if missing (idempotent). Returns its address. */
export async function ensureAta(chain: FundableChain, payer: Keypair, owner: string, mint: string): Promise<string> {
  const ata = getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner), true, TOKEN_PROGRAM_ID);
  await send(chain, payer, [
    createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, new PublicKey(owner), new PublicKey(mint), TOKEN_PROGRAM_ID),
  ]);
  return ata.toBase58();
}

export async function mintTokens(
  chain: FundableChain,
  payer: Keypair,
  mintAuthority: Keypair,
  mint: string,
  destinationOwner: string,
  amountBaseUnits: bigint,
): Promise<string> {
  const ata = await ensureAta(chain, payer, destinationOwner, mint);
  const signers = mintAuthority.publicKey.equals(payer.publicKey) ? [] : [mintAuthority];
  return send(
    chain,
    payer,
    [createMintToInstruction(new PublicKey(mint), new PublicKey(ata), mintAuthority.publicKey, amountBaseUnits, [], TOKEN_PROGRAM_ID)],
    signers,
  );
}
