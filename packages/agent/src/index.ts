import type { MessageSigner, SignedDecision } from '@atlas-rail/mandate';
import { ChainClient, SignerAdapter, Web3ChainClient } from '@atlas-rail/solana';
import {
  AtlasFetch,
  AtlasPaymentInfo,
  AuthorizedSigner,
  EscalationConfig,
  GateClient,
  GatedSignerAdapter,
  HttpGateClient,
  MandateDeniedError,
  createAtlasFetch,
} from '@atlas-rail/x402';

export type { AtlasFetch, AtlasPaymentInfo, AtlasResponse, EscalationConfig } from '@atlas-rail/x402';
export { HttpSignerClient, startSignerService } from '@atlas-rail/x402';
export type { AuthorizedSigner } from '@atlas-rail/x402';
export { EscalationDeniedError, EscalationRequiredError, EscalationTimeoutError, PaymentSettlementError, PaymentUnconfirmedError, UnsupportedPaymentError } from '@atlas-rail/x402';

/** Thrown when the mandate refuses a payment. Nothing was signed and nothing left the wallet. */
export class AtlasDenied extends Error {
  readonly reasons: string[];
  readonly decision: SignedDecision;
  constructor(decision: SignedDecision) {
    super(`Atlas Rail refused this payment: ${decision.record.reason}`);
    this.name = 'AtlasDenied';
    this.reasons = decision.record.failedRules;
    this.decision = decision;
  }
}

interface WrapFetchBaseOptions {
  /** The mandate this agent pays under. */
  mandateId: string;
  /** A running Atlas Rail gate (`{ url, apiKey }`), or any GateClient. */
  gate: { url: string; apiKey: string } | GateClient;
  /** Solana devnet RPC (default: $SOLANA_RPC_URL or the public devnet endpoint). */
  rpcUrl?: string;
  chain?: ChainClient;
  escalation?: EscalationConfig;
  /** Epoch seconds; defaults to real time. */
  clock?: () => number;
  onEvent?: Parameters<typeof createAtlasFetch>[0]['onEvent'];
}

export type WrapFetchOptions = WrapFetchBaseOptions &
  (
    | {
        /**
         * The agent's signer service (`await HttpSignerClient.connect({ url })`): the key stays in
         * another process and only signs what the gate authorised. Use this in production.
         */
        signer: AuthorizedSigner;
        wallet?: never;
        trustedInstanceKeys?: never;
      }
    | {
        /**
         * A wallet in this process, wrapped in the gate check here. Only for tests and local demos:
         * an agent that can read its key can sign anything.
         */
        wallet: SignerAdapter & MessageSigner;
        /** Atlas Rail instance keys whose authorizations the wallet will honour. */
        trustedInstanceKeys: string[];
        signer?: never;
      }
  );

/**
 * Wraps `fetch` so x402 payments go through the mandate gate first. Requests that don't need payment
 * pass straight through; a payment the mandate allows is signed, paid and returned with its receipt
 * on `response.atlas`; one it refuses throws {@link AtlasDenied} with the rules that refused it.
 */
export function wrapFetch(baseFetch: typeof fetch, options: WrapFetchOptions): AtlasFetch {
  const gate: GateClient = 'evaluate' in options.gate ? options.gate : new HttpGateClient({ baseUrl: options.gate.url, apiKey: options.gate.apiKey, fetch: baseFetch });
  const inner = createAtlasFetch({
    mandateId: options.mandateId,
    signer: options.signer ?? new GatedSignerAdapter({ inner: options.wallet, trustedInstanceKeys: options.trustedInstanceKeys, clock: options.clock }),
    gate,
    chain: options.chain ?? Web3ChainClient.fromUrl(options.rpcUrl ?? process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com'),
    fetch: baseFetch,
    clock: options.clock,
    escalation: options.escalation,
    onEvent: options.onEvent,
  });
  return async (input, init) => {
    try {
      return await inner(input, init);
    } catch (error) {
      if (error instanceof MandateDeniedError) throw new AtlasDenied(error.decision);
      throw error;
    }
  };
}
