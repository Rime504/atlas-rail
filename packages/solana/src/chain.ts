import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, getMint } from '@solana/spl-token';
import { ALLOWED_SOLANA_PROGRAM_IDS } from '@atlas-rail/config';
import { assertNotMainnet } from './guards';
import { PreflightSimulation, decodeTransaction, simulatePaymentTransaction } from './x402-payment';

/**
 * The narrow view of a Solana cluster that mandates, receipts and the x402 client need. Production
 * uses {@link Web3ChainClient} against devnet; tests use an in-memory implementation, so the whole
 * 402 → gate → sign → settle → receipt loop can run hermetically.
 */
export interface ChainTokenTransfer {
  source: string;
  destination: string;
  mint: string;
  amount: string;
  authority: string;
}

export interface ChainTransactionSummary {
  signature: string;
  slot: number | null;
  blockTime: number | null;
  /** null when the transaction succeeded. */
  err: unknown | null;
  feePayer: string;
  /** Addresses that were required signers. */
  signers: string[];
  tokenTransfers: ChainTokenTransfer[];
  memos: string[];
  programIds: string[];
}

export interface MintInfo {
  decimals: number;
  tokenProgram: string;
}

export interface ChainClient {
  getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  getMintInfo(mint: string): Promise<MintInfo | null>;
  simulate(transactionBase64: string): Promise<PreflightSimulation>;
  /** Sends a fully-signed transaction and waits for confirmation. Returns the signature. */
  sendAndConfirm(signedTransactionBase64: string): Promise<string>;
  getTransactionSummary(signature: string): Promise<ChainTransactionSummary | null>;
}

const TOKEN_ID = ALLOWED_SOLANA_PROGRAM_IDS.TOKEN_PROGRAM;
const MEMO_ID = ALLOWED_SOLANA_PROGRAM_IDS.MEMO_PROGRAM;

interface CompiledLike {
  programIdIndex: number;
  accountKeyIndexes: number[];
  data: Uint8Array;
}

interface MessageLike {
  staticAccountKeys: PublicKey[];
  compiledInstructions: CompiledLike[];
  header: { numRequiredSignatures: number };
}

/** Decodes a compiled message into the facts receipts and settlement checks care about. */
export function summarizeMessage(
  signature: string,
  message: MessageLike,
  meta: { slot: number | null; blockTime: number | null; err: unknown | null },
): ChainTransactionSummary {
  const keys = message.staticAccountKeys;
  const tokenTransfers: ChainTokenTransfer[] = [];
  const memos: string[] = [];
  const programIds: string[] = [];

  for (const ix of message.compiledInstructions) {
    const programId = keys[ix.programIdIndex].toBase58();
    if (!programIds.includes(programId)) programIds.push(programId);
    const accounts = ix.accountKeyIndexes.map((i) => keys[i].toBase58());
    if (programId === TOKEN_ID && ix.data.length === 10 && ix.data[0] === 12) {
      const amount = new DataView(ix.data.buffer, ix.data.byteOffset, ix.data.byteLength).getBigUint64(1, true);
      tokenTransfers.push({
        source: accounts[0],
        mint: accounts[1],
        destination: accounts[2],
        authority: accounts[3],
        amount: amount.toString(),
      });
    } else if (programId === MEMO_ID) {
      memos.push(Buffer.from(ix.data).toString('utf8'));
    }
  }

  return {
    signature,
    slot: meta.slot,
    blockTime: meta.blockTime,
    err: meta.err,
    feePayer: keys[0].toBase58(),
    signers: keys.slice(0, message.header.numRequiredSignatures).map((k) => k.toBase58()),
    tokenTransfers,
    memos,
    programIds,
  };
}

export function summarizeTransaction(
  signature: string,
  tx: VersionedTransaction,
  meta: { slot: number | null; blockTime: number | null; err: unknown | null },
): ChainTransactionSummary {
  return summarizeMessage(signature, tx.message, meta);
}

export interface SettlementExpectation {
  payTo: string;
  mint: string;
  amountBaseUnits: string;
}

export interface SettlementCheck {
  ok: boolean;
  reason: string;
  slot: number | null;
  blockTime: number | null;
  payer: string | null;
}

/** Confirms a settled transaction moved exactly the expected amount of the expected mint to payTo (exactly one transfer). */
export function checkSettlement(
  summary: ChainTransactionSummary | null,
  expected: SettlementExpectation,
): SettlementCheck {
  if (!summary) return { ok: false, reason: 'transaction not found on the cluster', slot: null, blockTime: null, payer: null };
  const base = { slot: summary.slot, blockTime: summary.blockTime };
  if (summary.err !== null) {
    return { ...base, ok: false, reason: `transaction failed on-chain: ${JSON.stringify(summary.err)}`, payer: null };
  }
  const destination = getAssociatedTokenAddressSync(
    new PublicKey(expected.mint),
    new PublicKey(expected.payTo),
    false,
    TOKEN_PROGRAM_ID,
  ).toBase58();
  const matching = summary.tokenTransfers.filter(
    (t) => t.destination === destination && t.mint === expected.mint && t.amount === expected.amountBaseUnits,
  );
  if (matching.length !== 1) {
    return {
      ...base,
      ok: false,
      reason:
        matching.length === 0
          ? 'no transfer of the expected amount, mint and recipient in this transaction'
          : 'more than one matching transfer in this transaction',
      payer: null,
    };
  }
  return { ...base, ok: true, reason: 'exactly one matching TransferChecked succeeded on-chain', payer: matching[0].authority };
}

export interface AnchorCheck {
  ok: boolean;
  reason: string;
  slot: number | null;
  blockTime: number | null;
}

/** Confirms a transaction succeeded, was signed by `signer`, and carries exactly the expected memo. */
export function checkMemoAnchor(
  summary: ChainTransactionSummary | null,
  expected: { memo: string; signer: string },
): AnchorCheck {
  if (!summary) return { ok: false, reason: 'anchor transaction not found on the cluster', slot: null, blockTime: null };
  const base = { slot: summary.slot, blockTime: summary.blockTime };
  if (summary.err !== null) return { ...base, ok: false, reason: `anchor transaction failed: ${JSON.stringify(summary.err)}` };
  if (!summary.signers.includes(expected.signer)) {
    return { ...base, ok: false, reason: 'anchor transaction was not signed by the expected instance key' };
  }
  if (!summary.memos.includes(expected.memo)) {
    return { ...base, ok: false, reason: 'anchor transaction does not carry the expected Merkle root memo' };
  }
  return { ...base, ok: true, reason: 'Merkle root memo is on-chain in a transaction signed by the instance key' };
}

/** {@link ChainClient} over a web3.js Connection. Refuses mainnet endpoints (ADR 0004). */
export class Web3ChainClient implements ChainClient {
  constructor(private readonly connection: Connection) {
    assertNotMainnet(connection.rpcEndpoint);
  }

  static fromUrl(rpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com'): Web3ChainClient {
    assertNotMainnet(rpcUrl);
    return new Web3ChainClient(new Connection(rpcUrl, 'confirmed'));
  }

  async getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    return this.connection.getLatestBlockhash('confirmed');
  }

  async getBalanceLamports(address: string): Promise<bigint> {
    return BigInt(await this.connection.getBalance(new PublicKey(address), 'confirmed'));
  }

  async requestAirdrop(address: string, lamports: bigint): Promise<void> {
    await this.connection.requestAirdrop(new PublicKey(address), Number(lamports));
  }

  async getMintInfo(mint: string): Promise<MintInfo | null> {
    const key = new PublicKey(mint);
    const info = await this.connection.getAccountInfo(key, 'confirmed');
    if (!info) return null;
    const parsed = await getMint(this.connection, key, 'confirmed', info.owner);
    return { decimals: parsed.decimals, tokenProgram: info.owner.toBase58() };
  }

  simulate(transactionBase64: string): Promise<PreflightSimulation> {
    return simulatePaymentTransaction(this.connection, transactionBase64);
  }

  async sendAndConfirm(signedTransactionBase64: string): Promise<string> {
    const tx = decodeTransaction(signedTransactionBase64);
    const latest = await this.connection.getLatestBlockhash('confirmed');
    const signature = await this.connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
    // Poll instead of websocket subscriptions: works against every RPC (public devnet, local
    // validators, the offline mock) and is robust to dropped subscriptions.
    const deadline = Date.now() + 60_000;
    for (;;) {
      const { value } = await this.connection.getSignatureStatuses([signature]);
      const status = value[0];
      if (status?.err) throw new Error(`Transaction ${signature} failed: ${JSON.stringify(status.err)}`);
      if (status && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) return signature;
      if (Date.now() > deadline) throw new Error(`Timed out waiting for confirmation of ${signature} (last valid block height ${latest.lastValidBlockHeight})`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  async getTransactionSummary(signature: string): Promise<ChainTransactionSummary | null> {
    const tx = await this.connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    if (!tx) return null;
    const message = tx.transaction.message as unknown as {
      staticAccountKeys?: PublicKey[];
      accountKeys?: PublicKey[];
      compiledInstructions: CompiledLike[];
      header: { numRequiredSignatures: number };
    };
    return summarizeMessage(
      signature,
      {
        staticAccountKeys: message.staticAccountKeys ?? message.accountKeys ?? [],
        compiledInstructions: message.compiledInstructions,
        header: message.header,
      },
      { slot: tx.slot, blockTime: tx.blockTime ?? null, err: tx.meta?.err ?? null },
    );
  }
}
