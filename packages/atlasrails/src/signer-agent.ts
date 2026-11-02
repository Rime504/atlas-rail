import type { MandateAgentSigner } from './mandate-program';

export interface SignerAgentOptions {
  /** The signer service, `ATLAS_SIGNER_URL`. */
  signerUrl: string;
  /** Off-chain mandate id. The signer keeps one voucher key per id. */
  mandateId: string;
  /** `ATLAS_SIGNER_TOKEN`, when the signer requires one. */
  token?: string;
  fetch?: typeof fetch;
}

/** The agent key that lives in the signer service. It never enters this process. */
export interface SignerAgent extends MandateAgentSigner {
  /** Signs the mandate acceptance (`signMandate` with role AGENT). The signer refuses other bytes. */
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}

/**
 * Mints (or reuses) the signer's voucher key for this mandate id and returns a handle that signs
 * the mandate acceptance and co-signs `create_mandate`. Use its `publicKey` as the mandate agent and
 * as the channel's authorized signer.
 */
export async function signerAgent(options: SignerAgentOptions): Promise<SignerAgent> {
  const url = options.signerUrl.replace(/\/$/, '');
  const doFetch = options.fetch ?? fetch;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  const call = async <T>(path: string, body: unknown): Promise<T> => {
    let response: Response;
    try {
      response = await doFetch(`${url}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    } catch {
      throw new Error('Signer is down');
    }
    const json = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) throw new Error(`Signer ${path} failed: ${json.error ?? response.status}`);
    return json;
  };
  const { publicKey } = await call<{ publicKey: string }>('/v1/voucher-key', { mandateId: options.mandateId });
  return {
    publicKey,
    async signMessage(message) {
      const { signatureBase64 } = await call<{ signatureBase64: string }>('/v1/sign-message', {
        messageBase64: Buffer.from(message).toString('base64'),
        mandateId: options.mandateId,
      });
      return Uint8Array.from(Buffer.from(signatureBase64, 'base64'));
    },
    async signCreateMandate(transactionBase64) {
      const { signedBase64 } = await call<{ signedBase64: string }>('/v1/sign-mandate-create', {
        transactionBase64,
        mandateId: options.mandateId,
      });
      return signedBase64;
    },
  };
}
