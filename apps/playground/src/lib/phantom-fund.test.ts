import { describe, expect, it } from 'vitest';
import { Transaction } from '@solana/web3.js';
import {
  DEVNET_GENESIS,
  DEVNET_RPC,
  FUND_MINT,
  TOKEN_2022,
  TOKEN_PROGRAM,
  browserFundingSession,
  depositBaseUnits,
  phantomSigner,
  reviewChannelOpen,
  reviewFunding,
  type ChannelOpenReview,
  type FundingReviewInput,
  type WalletTransaction,
} from './phantom-fund';

function review(overrides: Partial<FundingReviewInput> = {}): FundingReviewInput {
  return {
    rpc: DEVNET_RPC,
    genesis: DEVNET_GENESIS,
    mint: FUND_MINT,
    mintOwner: TOKEN_PROGRAM,
    decimals: 6,
    payer: 'Payer11111111111111111111111111111111111111',
    payerAta: 'PayerAta11111111111111111111111111111111111',
    tokenMint: FUND_MINT,
    tokenOwner: 'Payer11111111111111111111111111111111111111',
    tokenBalance: 10_000n,
    solLamports: 50_000_000n,
    solFloor: 20_000_000n,
    payee: 'Payee11111111111111111111111111111111111111',
    treasury: 'Treasury111111111111111111111111111111111',
    payeeAta: 'PayeeAta1111111111111111111111111111111111',
    treasuryAta: 'TreasuryAta111111111111111111111111111111',
    payeeAtaExists: false,
    treasuryAtaExists: true,
    ataTransactionRequired: false,
    computeUnitLimit: null,
    priorityPriceMicroLamports: null,
    maxPriorityFeeLamports: null,
    baseFeeLamports: null,
    ataRentLamports: null,
    feeCapLamports: null,
    feeLamports: null,
    ...overrides,
  };
}

describe('phantom funding review', () => {
  it('converts 0.01 tokens at 6 decimals to 10000 base units', () => {
    expect(depositBaseUnits('0.01', 6)).toBe(10_000n);
  });

  it('adapts a connected provider and does not keep a secret', async () => {
    let signed = false;
    const signer = phantomSigner({
      publicKey: { toBase58: () => 'Payer11111111111111111111111111111111111111' },
      connect: async () => ({ publicKey: { toBase58: () => 'nope' } }),
      disconnect: async () => undefined,
      async signTransaction<T extends WalletTransaction>(transaction: T) {
        signed = true;
        return transaction;
      },
    });
    expect(signer.publicKey).toBe('Payer11111111111111111111111111111111111111');
    expect('secretKey' in signer).toBe(false);
    await signer.signTransaction(new Transaction());
    expect(signed).toBe(true);
    expect(() => phantomSigner({
      publicKey: null,
      connect: async () => ({ publicKey: { toBase58: () => 'x' } }),
      disconnect: async () => undefined,
    })).toThrow('Wallet is not connected');
    expect(() => phantomSigner({
      publicKey: { toBase58: () => 'Payer11111111111111111111111111111111111111' },
      connect: async () => ({ publicKey: { toBase58: () => 'x' } }),
      disconnect: async () => undefined,
    })).toThrow('Wallet cannot sign transactions');
  });

  it('passes a wallet rejection through', async () => {
    const signer = phantomSigner({
      publicKey: { toBase58: () => 'Payer11111111111111111111111111111111111111' },
      connect: async () => ({ publicKey: { toBase58: () => 'x' } }),
      disconnect: async () => undefined,
      signTransaction: async () => {
        throw new Error('User rejected the request');
      },
    });
    await expect(signer.signTransaction(new Transaction())).rejects.toThrow('User rejected');
  });

  it('fails closed on the cluster, the mint, the token account, and the balances', () => {
    expect(reviewFunding(review()).errors).toEqual([]);
    expect(reviewFunding(review()).steps[0]).toContain('Create payee token account');
    expect(reviewFunding(review()).steps[1]).toContain('already exists');
    expect(reviewFunding(review({ rpc: 'https://api.mainnet-beta.solana.com' })).errors).toContain('RPC is not the devnet endpoint');
    expect(reviewFunding(review({ genesis: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' })).errors).toContain('RPC cluster is not Solana devnet');
    expect(reviewFunding(review({ mint: '' })).errors).toContain('mint is required');
    expect(reviewFunding(review({ mintOwner: null })).errors).toContain('mint is required');
    expect(reviewFunding(review({ mintOwner: TOKEN_2022 })).errors).toContain('Token-2022 is not supported by the channel deposit instruction');
    expect(reviewFunding(review({ mintOwner: 'other' })).errors).toContain('Unsupported token program');
    expect(reviewFunding(review({ tokenMint: null, tokenBalance: null })).errors).toContain('Payer token account PayerAta11111111111111111111111111111111111 does not exist');
    expect(reviewFunding(review({ tokenBalance: 0n })).errors).toContain('Payer token account has zero balance');
    expect(reviewFunding(review({ tokenMint: 'other' })).errors).toContain('Token account mint does not match');
    expect(reviewFunding(review({ tokenOwner: 'other' })).errors).toContain('Token account authority does not match the payer');
    expect(reviewFunding(review({ tokenBalance: 9n })).errors).toContain('Insufficient token balance');
    expect(reviewFunding(review({ solLamports: 1n })).errors).toContain('Insufficient SOL for fees or rent');
    expect(reviewFunding(review({ payeeAtaExists: true, treasuryAtaExists: false })).steps[1]).toContain('Create treasury token account');
    expect(reviewFunding(review({ ataTransactionRequired: true })).errors).toContain('Transaction fee estimate is unavailable');
    expect(reviewFunding(review({
      ataTransactionRequired: true,
      computeUnitLimit: 27_336,
      priorityPriceMicroLamports: 1_000,
      maxPriorityFeeLamports: 28,
      baseFeeLamports: 5_000,
      ataRentLamports: 1_488_440,
      feeCapLamports: 5_055,
      feeLamports: 9_000,
    })).errors).toContain('Transaction fee exceeds the cap');
    expect(reviewFunding(review({
      ataTransactionRequired: true,
      computeUnitLimit: 27_336,
      priorityPriceMicroLamports: 1_000,
      maxPriorityFeeLamports: 28,
      baseFeeLamports: 5_000,
      ataRentLamports: 1_488_440,
      feeCapLamports: 5_055,
      feeLamports: 5_028,
    })).errors).toEqual([]);
  });

  it('builds a funding session without a payer secret', () => {
    const session = browserFundingSession({ connection: {}, depositBase: 10_000n });
    expect(session).not.toHaveProperty('payer');
    expect(session).not.toHaveProperty('secretKey');
    expect(session.depositAmount).toBe(10_000n);
  });

  it('blocks an open review when the fee or instruction does not match', () => {
    const expected = {
      payer: 'Payer11111111111111111111111111111111111111',
      payee: 'Payee11111111111111111111111111111111111111',
      agent: '7t3ysVSbrX7ww7i3ptff5YQ1UQYBQ97TRgrCPR41tVos',
      deposit: '10000',
    };
    const quote: ChannelOpenReview = {
      mint: FUND_MINT,
      deposit: '10000',
      channel: 'Channel111111111111111111111111111111111111',
      payer: expected.payer,
      payee: expected.payee,
      agent: expected.agent,
      programId: 'CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX',
      computeUnitLimit: 75_292,
      priorityPriceMicroLamports: 1_000,
      maxPriorityFeeLamports: 76,
      baseFeeLamports: 5_000,
      channelRentLamports: 1_950_720,
      tokenRentLamports: 1_488_440,
      feeLamports: 5_076,
      feeCapLamports: 5_076,
    };
    expect(reviewChannelOpen(quote, expected)).toEqual([]);
    expect(reviewChannelOpen(null, expected)).toContain('Transaction fee estimate is unavailable');
    expect(reviewChannelOpen({ ...quote, feeLamports: 9_000 }, expected)).toContain('Transaction fee exceeds the cap');
    expect(reviewChannelOpen({ ...quote, feeLamports: 5_000, feeCapLamports: 5_076, maxPriorityFeeLamports: 76 }, expected)).toContain('Transaction fee does not match the policy');
    expect(reviewChannelOpen({ ...quote, programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }, expected)).toContain('Unexpected instruction');
  });
});
