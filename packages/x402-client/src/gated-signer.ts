import {
  GateAuthorization,
  MessageSigner,
  verifyGateAuthorization,
} from '@atlas-rail/mandate';
import { SignerAdapter, decodeTransaction, transactionMessageHash } from '@atlas-rail/solana';
import { GateAuthorizationRequiredError } from './errors';

export interface GatedSignerOptions {
  /** The wallet that actually holds the agent key (mock keyring, or a custody vendor adapter). */
  inner: SignerAdapter & MessageSigner;
  /** Atlas Rail instance keys whose gate authorisations this wallet honours. */
  trustedInstanceKeys: readonly string[];
  /** Epoch seconds. */
  clock?: () => number;
}

/**
 * The enforcement point. Wraps any {@link SignerAdapter} so it will only sign a transaction when
 * handed a gate authorisation that (a) was issued by a trusted Atlas Rail instance, (b) covers the
 * SHA-256 of *this transaction's message bytes*, (c) was issued to *this* key, and (d) is unexpired.
 *
 * An agent that skips the client library, or is talked into paying somewhere else by a prompt
 * injection, cannot get a signature: the plain `signTransaction` always refuses, and
 * `signWithAuthorization` refuses anything the gate did not evaluate and ALLOW.
 *
 * Custody vendors (Turnkey, Privy, Crossmint, Coinbase) implement the same check inside their own
 * signing-policy hook; this class is the reference for that contract.
 */
export class GatedSignerAdapter implements SignerAdapter, MessageSigner {
  readonly name: string;
  private readonly clock: () => number;

  constructor(private readonly options: GatedSignerOptions) {
    this.name = `GatedSigner(${options.inner.name})`;
    this.clock = options.clock ?? (() => Math.floor(Date.now() / 1000));
  }

  get publicKey(): string {
    return this.options.inner.publicKey;
  }

  signMessage(message: Uint8Array): Promise<Uint8Array> {
    return this.options.inner.signMessage(message);
  }

  /** Always refuses: every payment signature must carry a gate authorisation. */
  async signTransaction(_transactionBase64: string): Promise<{ signedBase64: string; signature: string }> {
    void _transactionBase64;
    throw new GateAuthorizationRequiredError();
  }

  async signWithAuthorization(
    transactionBase64: string,
    authorization: GateAuthorization | null,
  ): Promise<{ signedBase64: string; signature: string }> {
    if (!authorization) throw new GateAuthorizationRequiredError('No gate authorisation was provided for this transaction');
    let messageHash: string;
    try {
      messageHash = transactionMessageHash(decodeTransaction(transactionBase64));
    } catch {
      throw new GateAuthorizationRequiredError('Transaction could not be decoded');
    }
    const check = verifyGateAuthorization(authorization, {
      trustedInstanceKeys: this.options.trustedInstanceKeys,
      now: this.clock(),
      txMessageHash: messageHash,
      agentPublicKey: this.publicKey,
    });
    if (!check.ok) throw new GateAuthorizationRequiredError(check.error ?? 'Gate authorisation is not valid');
    return this.options.inner.signTransaction(transactionBase64);
  }
}
