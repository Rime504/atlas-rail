import { describe, it, expect } from 'vitest';
import { assertNotMainnet } from './guards';
import { SplTokenPayoutTransactionBuilder } from './builder';
import { DevnetTransactionSimulator } from './simulator';
import { MockDevnetSignerAdapter, ExternalCustodySignerAdapter } from './signer';

describe('Solana Adapter Package', () => {
  const senderWallet = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
  const recipientWallet = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
  const devnetUsdcMint = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  const dummyBlockhash = '4uQevwaSCPxFLBspwVTSYjQQZsMotP5j84vPf15pVM35';

  it('rejects mainnet URLs and configurations strictly', () => {
    expect(() => assertNotMainnet('https://api.mainnet-beta.solana.com')).toThrow('CRITICAL SAFETY FATAL');
  });

  it('builds an unsigned base64 SPL token payout transaction', () => {
    const res = SplTokenPayoutTransactionBuilder.buildUnsignedPayoutTransaction({
      senderWallet,
      recipientWallet,
      mintAddress: devnetUsdcMint,
      amountBaseUnits: '1500000000',
      decimals: 6,
      memo: 'Test Invoice #100',
      recentBlockhash: dummyBlockhash,
    });

    expect(res.transactionBase64).toBeDefined();
    expect(res.destinationTokenAccount).toBeDefined();
  });

  it('simulates a built transaction and checks allowed program IDs', () => {
    const { transactionBase64 } = SplTokenPayoutTransactionBuilder.buildUnsignedPayoutTransaction({
      senderWallet,
      recipientWallet,
      mintAddress: devnetUsdcMint,
      amountBaseUnits: '100000000',
      recentBlockhash: dummyBlockhash,
    });

    const sim = DevnetTransactionSimulator.analyzeTransactionBase64(transactionBase64, {
      err: null,
      unitsConsumed: 5000,
    });

    expect(sim.success).toBe(true);
    expect(sim.unknownProgramIds.length).toBe(0);
    expect(sim.programIds.length).toBeGreaterThan(0);
  });

  it('signs transaction with mock signer adapter when allowed', async () => {
    process.env.ATLAS_ALLOW_MOCK_SIGNER = 'true';
    const signer = new MockDevnetSignerAdapter();

    const { transactionBase64 } = SplTokenPayoutTransactionBuilder.buildUnsignedPayoutTransaction({
      senderWallet,
      recipientWallet,
      mintAddress: devnetUsdcMint,
      amountBaseUnits: '100000000',
      recentBlockhash: dummyBlockhash,
    });

    const res = await signer.signTransaction(transactionBase64);
    expect(res.signature).toContain('devnet_mock_sig_');
    expect(res.signedBase64).toBeDefined();
  });

  it('throws helpful error for unconfigured external custody signer', async () => {
    const signer = new ExternalCustodySignerAdapter();
    await expect(signer.signTransaction('dGVzdA==')).rejects.toThrow('ExternalCustodySignerAdapter is not configured');
  });
});
