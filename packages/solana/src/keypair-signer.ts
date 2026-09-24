import { ed25519 } from '@noble/curves/ed25519';
import { base58 } from '@scure/base';
import { Keypair, VersionedTransaction } from '@solana/web3.js';
import { SignerAdapter } from './types';

/**
 * Something that can sign arbitrary bytes with an Ed25519 key (mandate links, decisions, receipts).
 * Structurally identical to `MessageSigner` in `@atlas-rail/mandate`; declared here so this package
 * does not depend on it.
 */
export interface MessageSignerLike {
  readonly publicKey: string;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}

export interface SignedTransaction {
  signedBase64: string;
  signature: string;
}

/**
 * Devnet-only signer over a caller-supplied keypair. Unlike {@link MockDevnetSignerAdapter} it keeps
 * the transaction's fee payer as built (x402 payments are fee-paid by the facilitator, not the
 * payer), understands versioned (v0) transactions, and can sign arbitrary messages.
 *
 * It refuses to construct in production or unless ATLAS_ALLOW_MOCK_SIGNER=true, exactly like the mock
 * signer. Production keys belong behind an ExternalCustodySignerAdapter (ADR 0003); this class
 * exists so the demo agent, the demo user keyring and the instance attestation key can be real
 * Ed25519 keys on devnet without Atlas Rail ever handling a production key.
 */
export class DevnetKeypairSigner implements SignerAdapter, MessageSignerLike {
  public readonly name = 'DevnetKeypairSigner';
  private readonly keypair: Keypair;

  /** @param secret 64-byte Solana secret key (seed || public key) or a 32-byte Ed25519 seed. */
  constructor(secret: Uint8Array) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('CRITICAL SAFETY FATAL: DevnetKeypairSigner cannot be used in production environment!');
    }
    if (process.env.ATLAS_ALLOW_MOCK_SIGNER !== 'true') {
      throw new Error('DevnetKeypairSigner is disabled. Set ATLAS_ALLOW_MOCK_SIGNER=true for devnet testing.');
    }
    if (secret.length === 64) this.keypair = Keypair.fromSecretKey(secret);
    else if (secret.length === 32) this.keypair = Keypair.fromSeed(secret);
    else throw new Error('DevnetKeypairSigner expects a 32-byte seed or a 64-byte secret key');
  }

  static generate(): DevnetKeypairSigner {
    return new DevnetKeypairSigner(Keypair.generate().secretKey);
  }

  get publicKey(): string {
    return this.keypair.publicKey.toBase58();
  }

  /** Exposed only so devnet tooling (keyring files, airdrops) can persist the demo key. Never log it. */
  exportSecretKey(): Uint8Array {
    return Uint8Array.from(this.keypair.secretKey);
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    return ed25519.sign(message, this.keypair.secretKey.slice(0, 32));
  }

  /** Signs a base64 legacy or versioned transaction, leaving any other required signature slots untouched. */
  async signTransaction(transactionBase64: string): Promise<SignedTransaction> {
    const tx = VersionedTransaction.deserialize(Buffer.from(transactionBase64, 'base64'));
    const index = tx.message.staticAccountKeys.findIndex((key) => key.equals(this.keypair.publicKey));
    if (index < 0 || index >= tx.message.header.numRequiredSignatures) {
      throw new Error('This signer is not a required signer of the transaction');
    }
    tx.sign([this.keypair]);
    const signature = tx.signatures[index];
    return {
      signedBase64: Buffer.from(tx.serialize()).toString('base64'),
      signature: base58.encode(signature),
    };
  }
}
