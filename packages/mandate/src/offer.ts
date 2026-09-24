import { z } from 'zod';
import { hashCanonical } from './crypto';
import { JsonValue } from './jcs';
import { SOLANA_DEVNET_CAIP2, addressSchema, baseUnitsSchema } from './schema';

/**
 * The part of an x402 `PaymentRequirements` (plus the resource it was issued for) that a mandate
 * reasons about, in canonical form. Ephemeral fields such as `recentBlockhash` are deliberately
 * excluded so the same commercial offer always hashes to the same value.
 */
export const x402OfferSchema = z
  .object({
    x402Version: z.literal(2),
    scheme: z.literal('exact'),
    network: z.string().min(3).max(64),
    asset: addressSchema,
    payTo: addressSchema,
    amount: baseUnitsSchema,
    resourceUrl: z.string().url().max(2048),
    feePayer: addressSchema.nullable(),
    memo: z.string().max(256).nullable(),
  })
  .strict();

export type X402Offer = z.infer<typeof x402OfferSchema>;

/** Minimal shape of an x402 v2 PaymentRequirements object as it appears in a 402 response. */
export interface X402PaymentRequirementsLike {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  extra?: Record<string, unknown> | null;
}

/** x402 v1 used short network names; v2 uses CAIP-2. Atlas Rail accepts the devnet alias only. */
export function normalizeNetwork(network: string): string {
  return network === 'solana-devnet' ? SOLANA_DEVNET_CAIP2 : network;
}

/** Canonical form of a resource URL: WHATWG-normalised, fragment removed. Throws on invalid URLs. */
export function canonicalResourceUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = '';
  return parsed.href;
}

export class OfferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfferError';
  }
}

/** Builds the canonical offer. Throws {@link OfferError} if the requirements are not a well-formed exact/SVM offer. */
export function offerFromRequirements(
  requirements: X402PaymentRequirementsLike,
  resourceUrl: string,
  x402Version = 2,
): X402Offer {
  let canonicalUrl: string;
  try {
    canonicalUrl = canonicalResourceUrl(resourceUrl);
  } catch {
    throw new OfferError(`Resource URL is not a valid URL: ${resourceUrl}`);
  }
  const extra = requirements.extra ?? {};
  const candidate = {
    x402Version,
    scheme: requirements.scheme,
    network: normalizeNetwork(requirements.network),
    asset: requirements.asset,
    payTo: requirements.payTo,
    amount: requirements.amount,
    resourceUrl: canonicalUrl,
    feePayer: typeof extra.feePayer === 'string' ? extra.feePayer : null,
    memo: typeof extra.memo === 'string' ? extra.memo : null,
  };
  const parsed = x402OfferSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new OfferError(`Malformed x402 offer: ${issue.path.join('.') || '<root>'}: ${issue.message}`);
  }
  return parsed.data;
}

export function hashOffer(offer: X402Offer): string {
  return hashCanonical(offer as unknown as JsonValue);
}
