import { Keypair, Transaction } from '@solana/web3.js';
import { SignerAdapter } from './types';

export class MockDevnetSignerAdapter implements SignerAdapter {
  public name = 'MockDevnetSignerAdapter';
  private devnetKeypair: Keypair;

  constructor() {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('CRITICAL SAFETY FATAL: MockDevnetSignerAdapter cannot be used in production environment!');
    }
    if (process.env.ATLAS_ALLOW_MOCK_SIGNER !== 'true') {
      throw new Error('MockDevnetSignerAdapter is disabled. Set ATLAS_ALLOW_MOCK_SIGNER=true for devnet testing.');
    }
    // Generate deterministic ephemeral keypair for devnet testing only
    this.devnetKeypair = Keypair.generate();
  }

  /**
   * Returns the mock public key so callers can set it as fee payer when building transactions.
   */
  public get publicKey() {
    return this.devnetKeypair.publicKey;
  }

  public async signTransaction(transactionBase64: string): Promise<{ signedBase64: string; signature: string }> {
    const txBuffer = Buffer.from(transactionBase64, 'base64');
    const tx = Transaction.from(txBuffer);

    // Override feePayer to match our ephemeral keypair so partialSign succeeds
    tx.feePayer = this.devnetKeypair.publicKey;

    tx.partialSign(this.devnetKeypair);

    const signature = tx.signature ? tx.signature.toString('hex') : 'mock_sig_' + Date.now();
    const signedBase64 = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');

    return {
      signedBase64,
      signature: `devnet_mock_sig_${signature.slice(0, 44)}`,
    };
  }
}

export class ExternalCustodySignerAdapter implements SignerAdapter {
  public name = 'ExternalCustodySignerAdapter';

  public async signTransaction(_transactionBase64: string): Promise<{ signedBase64: string; signature: string }> {
    throw new Error(
      'ExternalCustodySignerAdapter is not configured. Integrate a customer-controlled HSM/custody signer adapter before enabling production signing.',
    );
  }
}
