import type { Transaction, VersionedTransaction } from '@solana/web3.js';

export const DEVNET_RPC = 'https://api.devnet.solana.com';
/** Genesis hash read from this RPC. A Phantom banner is not this check. */
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const FUND_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
/** Public key only. The secret was not stored, so this payee cannot seal. */
export const FUND_PAYEE = 'Ayc7LB6Mw9pHp5e3ZH38HdLErHrpztnuyb9aT2g4nhGM';
/** Public key only. Channel open records it. It is not the backend voucher signer. */
export const FUND_AGENT = '7t3ysVSbrX7ww7i3ptff5YQ1UQYBQ97TRgrCPR41tVos';
export const CHANNEL_PROGRAM = 'CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX';
export const DEPOSIT_TOKENS = '0.01';
export const FUND_SALT = 1n;
export const FUND_GRACE_SECONDS = 3600;

export type WalletTransaction = Transaction | VersionedTransaction;

export interface InjectedProvider {
  publicKey: { toBase58(): string } | null;
  connect: () => Promise<{ publicKey: { toBase58(): string } }>;
  disconnect: () => Promise<void>;
  signTransaction?: <T extends WalletTransaction>(transaction: T) => Promise<T>;
}

export interface FundSigner {
  publicKey: string;
  signTransaction(transaction: Transaction): Promise<Transaction>;
}

export function injectedWallet(): InjectedProvider | null {
  const scope = window as Window & { solana?: InjectedProvider };
  return scope.solana ?? null;
}

/** The existing WalletSigner shape. Phantom stays in the page, not in the package. */
export function phantomSigner(provider: InjectedProvider): FundSigner {
  if (!provider.publicKey) throw new Error('Wallet is not connected');
  if (!provider.signTransaction) throw new Error('Wallet cannot sign transactions');
  const publicKey = provider.publicKey.toBase58();
  const sign = provider.signTransaction.bind(provider);
  return {
    publicKey,
    signTransaction(transaction) {
      return sign(transaction);
    },
  };
}

export function depositBaseUnits(amount: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(amount)) throw new Error('Deposit amount is not a number');
  const [whole, fraction = ''] = amount.split('.');
  if (fraction.length > decimals) throw new Error('Deposit amount has more precision than the mint');
  const scale = 10n ** BigInt(decimals);
  return BigInt(whole) * scale + BigInt(fraction.padEnd(decimals, '0') || '0');
}

export interface FundingReviewInput {
  rpc: string;
  genesis: string;
  mint: string;
  mintOwner: string | null;
  decimals: number | null;
  payer: string;
  payerAta: string;
  tokenMint: string | null;
  tokenOwner: string | null;
  tokenBalance: bigint | null;
  solLamports: bigint;
  solFloor: bigint;
  payee: string;
  treasury: string;
  payeeAta: string;
  treasuryAta: string;
  payeeAtaExists: boolean;
  treasuryAtaExists: boolean;
  ataTransactionRequired: boolean;
  computeUnitLimit: number | null;
  priorityPriceMicroLamports: number | null;
  maxPriorityFeeLamports: number | null;
  baseFeeLamports: number | null;
  ataRentLamports: number | null;
  feeCapLamports: number | null;
  feeLamports: number | null;
}

export interface FundingReview {
  errors: string[];
  depositBase: bigint | null;
  steps: string[];
  ataTransactionRequired: boolean;
  computeUnitLimit: number | null;
  priorityPriceMicroLamports: number | null;
  maxPriorityFeeLamports: number | null;
  baseFeeLamports: number | null;
  ataRentLamports: number | null;
  feeCapLamports: number | null;
  feeLamports: number | null;
}

export function reviewFunding(input: FundingReviewInput): FundingReview {
  const errors: string[] = [];
  if (input.rpc !== DEVNET_RPC) errors.push('RPC is not the devnet endpoint');
  if (input.genesis !== DEVNET_GENESIS) errors.push('RPC cluster is not Solana devnet');
  if (input.mint !== FUND_MINT) errors.push('mint is required');
  if (!input.mintOwner) errors.push('mint is required');
  else if (input.mintOwner === TOKEN_2022) errors.push('Token-2022 is not supported by the channel deposit instruction');
  else if (input.mintOwner !== TOKEN_PROGRAM) errors.push('Unsupported token program');
  let depositBase: bigint | null = null;
  if (input.decimals === null) errors.push('Mint decimals are missing');
  else {
    try {
      depositBase = depositBaseUnits(DEPOSIT_TOKENS, input.decimals);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Deposit amount is not a number');
    }
  }
  if (!input.payer) errors.push('Connect the wallet first');
  if (input.tokenMint === null || input.tokenBalance === null) errors.push(`Payer token account ${input.payerAta} does not exist`);
  else {
    if (input.tokenMint !== input.mint) errors.push('Token account mint does not match');
    if (input.tokenOwner !== input.payer) errors.push('Token account authority does not match the payer');
    if (input.tokenBalance === 0n) errors.push('Payer token account has zero balance');
    else if (depositBase !== null && input.tokenBalance < depositBase) errors.push('Insufficient token balance');
  }
  if (input.solLamports < input.solFloor) errors.push('Insufficient SOL for fees or rent');
  if (input.ataTransactionRequired) {
    const limit = input.computeUnitLimit;
    const price = input.priorityPriceMicroLamports;
    const priority = input.maxPriorityFeeLamports;
    const base = input.baseFeeLamports;
    const rent = input.ataRentLamports;
    const cap = input.feeCapLamports;
    const fee = input.feeLamports;
    if (limit === null || price === null || priority === null || base === null || rent === null || cap === null || fee === null) errors.push('Transaction fee estimate is unavailable');
    else if (fee > cap || base + priority > cap) errors.push('Transaction fee exceeds the cap');
    else if (base + priority !== fee) errors.push('Transaction fee does not match the policy');
  }
  const steps = [
    input.payeeAtaExists ? `Payee token account ${input.payeeAta} already exists` : `Create payee token account ${input.payeeAta}`,
    input.treasuryAtaExists ? `Treasury token account ${input.treasuryAta} already exists` : `Create treasury token account ${input.treasuryAta}`,
    'Open the channel. The payer signs. The payee does not.',
  ];
  return {
    errors,
    depositBase,
    steps,
    ataTransactionRequired: input.ataTransactionRequired,
    computeUnitLimit: input.computeUnitLimit,
    priorityPriceMicroLamports: input.priorityPriceMicroLamports,
    maxPriorityFeeLamports: input.maxPriorityFeeLamports,
    baseFeeLamports: input.baseFeeLamports,
    ataRentLamports: input.ataRentLamports,
    feeCapLamports: input.feeCapLamports,
    feeLamports: input.feeLamports,
  };
}

/** Session fields fundChannel reads. There is no payer secret on this object. */
export function browserFundingSession(options: { connection: unknown; depositBase: bigint }): Record<string, unknown> {
  return {
    connection: options.connection,
    depositAmount: options.depositBase,
    payment: { salt: FUND_SALT, graceSeconds: FUND_GRACE_SECONDS },
    recipient: FUND_PAYEE,
    agent: { publicKey: FUND_AGENT },
  };
}

export interface ChannelOpenReview {
  mint: string;
  deposit: string;
  channel: string;
  payer: string;
  payee: string;
  agent: string;
  programId: string;
  computeUnitLimit: number | null;
  priorityPriceMicroLamports: number | null;
  maxPriorityFeeLamports: number | null;
  baseFeeLamports: number | null;
  channelRentLamports: number | null;
  tokenRentLamports: number | null;
  feeLamports: number | null;
  feeCapLamports: number | null;
}

/** Checks the prepared open quote. A null field or a fee over the cap blocks signing. */
export function reviewChannelOpen(quote: ChannelOpenReview | null, expected: { payer: string; payee: string; agent: string; deposit: string }): string[] {
  if (!quote) return ['Transaction fee estimate is unavailable'];
  const errors: string[] = [];
  if (quote.mint !== FUND_MINT || quote.deposit !== expected.deposit) errors.push('mint is required');
  if (quote.payer !== expected.payer || quote.payee !== expected.payee || quote.agent !== expected.agent || !quote.channel) errors.push('Wallet public key does not match the review');
  if (quote.programId !== CHANNEL_PROGRAM) errors.push('Unexpected instruction');
  const limit = quote.computeUnitLimit;
  const price = quote.priorityPriceMicroLamports;
  const priority = quote.maxPriorityFeeLamports;
  const base = quote.baseFeeLamports;
  const channelRent = quote.channelRentLamports;
  const tokenRent = quote.tokenRentLamports;
  const fee = quote.feeLamports;
  const cap = quote.feeCapLamports;
  if (limit === null || price === null || priority === null || base === null || channelRent === null || tokenRent === null || fee === null || cap === null) errors.push('Transaction fee estimate is unavailable');
  else if (fee > cap || base + priority > cap) errors.push('Transaction fee exceeds the cap');
  else if (base + priority !== fee) errors.push('Transaction fee does not match the policy');
  return errors;
}
