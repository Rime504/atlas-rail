import { Keypair, VersionedTransaction } from '@solana/web3.js';
import { LocalEd25519Signer, type AgentMandate, type MessageSigner } from '@atlas-rail/mandate';
import type { SignerAdapter } from '@atlas-rail/solana';
import { EscalationRequiredError, GatedSignerAdapter, MandateDeniedError, VoucherAuthorizer } from '@atlas-rail/x402';

/** Signs with a caller-held key. This is the agent path when the HTTP signer is not running. */
class KeypairAgentSigner implements SignerAdapter, MessageSigner {
  readonly name = 'KeypairAgentSigner';

  constructor(private readonly keypair: Keypair) {}

  get publicKey(): string {
    return this.keypair.publicKey.toBase58();
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    return new LocalEd25519Signer(this.keypair.secretKey.subarray(0, 32)).signMessage(message);
  }

  async signTransaction(transactionBase64: string): Promise<{ signedBase64: string; signature: string }> {
    const tx = VersionedTransaction.deserialize(Buffer.from(transactionBase64, 'base64'));
    tx.sign([this.keypair]);
    const index = tx.message.staticAccountKeys.findIndex((key) => key.equals(this.keypair.publicKey));
    return {
      signedBase64: Buffer.from(tx.serialize()).toString('base64'),
      signature: Buffer.from(tx.signatures[index] ?? new Uint8Array()).toString('base64'),
    };
  }
}

export function messageSigner(keypair: Keypair, label: string): LocalEd25519Signer {
  const signer = new LocalEd25519Signer(keypair.secretKey.subarray(0, 32));
  if (signer.publicKey !== keypair.publicKey.toBase58()) {
    throw new Error(`${label} public key does not match its Ed25519 seed`);
  }
  return signer;
}

export interface LocalVoucherRequest {
  mandate: AgentMandate;
  agent: Keypair;
  gate: Keypair;
  channelId: string;
  cumulativeAmount: string;
  expiresAt: number;
  recipient: string;
  resourceUrl: string;
  asset: string;
  network: string;
  feePayer: string;
  settled: bigint;
}

/** Same shape `askAtlasRail` returns, produced by the in-process gate. */
export async function askWithAgent(input: LocalVoucherRequest): Promise<{
  signed: boolean;
  message?: string;
  messageBase64?: string;
  signatureBase64?: string;
  messageHash?: string;
  deltaAmount?: string;
  decision?: import('@atlas-rail/mandate').SignedDecision;
}> {
  if (input.agent.publicKey.toBase58() !== input.mandate.agent.publicKey) {
    throw new Error('Agent key does not match the mandate agent');
  }
  const instance = messageSigner(input.gate, 'Gate');
  const authorizer = new VoucherAuthorizer({
    mandate: input.mandate,
    instance,
    signer: new GatedSignerAdapter({
      inner: new KeypairAgentSigner(input.agent),
      trustedInstanceKeys: [instance.publicKey],
    }),
    organizationId: input.mandate.issuer.organizationId,
    channelPayer: input.feePayer,
    settledWatermark: async () => input.settled,
  });
  try {
    const allowed = await authorizer.requestVoucher({
      channelId: input.channelId,
      cumulativeAmount: input.cumulativeAmount,
      expiresAt: input.expiresAt,
      recipient: input.recipient,
      resourceUrl: input.resourceUrl,
      asset: input.asset,
      network: input.network,
      feePayer: input.feePayer,
    });
    return {
      signed: true,
      messageBase64: Buffer.from(allowed.message).toString('base64'),
      signatureBase64: Buffer.from(allowed.signature).toString('base64'),
      messageHash: allowed.messageHash,
      deltaAmount: allowed.deltaAmount,
      decision: allowed.decision,
    };
  } catch (error) {
    // In-process tests have no owner to ask: over-limit stays blocked.
    if (error instanceof MandateDeniedError || error instanceof EscalationRequiredError) return { signed: false, message: error.name };
    throw error;
  }
}
