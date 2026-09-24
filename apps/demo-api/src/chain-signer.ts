import type { Address } from '@solana/kit';
import type { FacilitatorSvmSigner } from '@x402/svm';
import { ChainClient, DevnetKeypairSigner } from '@atlas-rail/solana';

/**
 * Adapts an Atlas Rail {@link ChainClient} plus a devnet keypair into the `FacilitatorSvmSigner`
 * the official `@x402/svm` facilitator scheme expects. The scheme performs all verification
 * (instruction layout, amounts, memo, compute limits, fee-payer isolation, duplicate-settlement
 * cache); this class only signs, simulates and submits. With a `Web3ChainClient` it settles on
 * devnet; with the in-memory cluster it runs the same official verification hermetically.
 */
export class ChainFacilitatorSigner implements FacilitatorSvmSigner {
  constructor(
    private readonly keypair: DevnetKeypairSigner,
    private readonly chain: ChainClient,
  ) {}

  getAddresses(): readonly Address[] {
    return [this.keypair.publicKey as Address];
  }

  async signTransaction(transaction: string, feePayer: Address, _network: string): Promise<string> {
    void _network;
    if (feePayer !== this.keypair.publicKey) throw new Error(`No signer for fee payer ${feePayer}`);
    return (await this.keypair.signTransaction(transaction)).signedBase64;
  }

  async simulateTransaction(transaction: string, _network: string): Promise<void> {
    void _network;
    const result = await this.chain.simulate(transaction);
    if (!result.success) throw new Error(`Simulation failed: ${result.error ?? 'unknown error'}`);
  }

  async sendTransaction(transaction: string, _network: string): Promise<string> {
    void _network;
    // sendAndConfirm submits and waits for confirmation; confirmTransaction below is then a no-op.
    return this.chain.sendAndConfirm(transaction);
  }

  async confirmTransaction(_signature: string, _network: string): Promise<void> {
    void _signature;
    void _network;
  }
}
