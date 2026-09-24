import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { base58 } from '@scure/base';
import { canonicalBytes } from './jcs';

/**
 * Domain separation tags. Every signature in the system covers `domain + "\n" + hex(hash)`, so a
 * signature produced for one purpose (say a mandate link) can never be replayed as another (a
 * decision or a receipt) even if the hashed payloads happened to collide.
 */
export const SIGNATURE_DOMAIN = {
  mandateLink: 'atlasrail/v0.1/mandate-link',
  decision: 'atlasrail/v0.1/decision',
  receipt: 'atlasrail/v0.1/receipt',
  gateAuthorization: 'atlasrail/v0.1/gate-authorization',
  agentRequest: 'atlasrail/v0.1/agent-request',
} as const;

export type SignatureDomain = (typeof SIGNATURE_DOMAIN)[keyof typeof SIGNATURE_DOMAIN];

/** Anything that can produce Ed25519 signatures over arbitrary bytes (HSM, MPC, keyring, ...). */
export interface MessageSigner {
  /** Base58 Ed25519 public key (a Solana address). */
  readonly publicKey: string;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}

export function sha256Bytes(data: Uint8Array | string): Uint8Array {
  return sha256(typeof data === 'string' ? utf8ToBytes(data) : data);
}

export function sha256Hex(data: Uint8Array | string): string {
  return bytesToHex(sha256Bytes(data));
}

/** SHA-256 over the JCS serialisation of `value`, lowercase hex. */
export function hashCanonical(value: unknown): string {
  return bytesToHex(sha256(canonicalBytes(value)));
}

export function toBase58(bytes: Uint8Array): string {
  return base58.encode(bytes);
}

export function fromBase58(value: string): Uint8Array {
  return base58.decode(value);
}

export function toHex(bytes: Uint8Array): string {
  return bytesToHex(bytes);
}

const HEX_64 = /^[0-9a-f]{64}$/;

export function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && HEX_64.test(value);
}

export function fromHex(value: string): Uint8Array {
  if (!/^([0-9a-f]{2})*$/.test(value)) throw new Error('Invalid lowercase hex string');
  return hexToBytes(value);
}

/** The exact bytes that get signed for a given purpose and content hash. */
export function domainMessage(domain: SignatureDomain, hashHex: string): Uint8Array {
  if (!isSha256Hex(hashHex)) throw new Error('domainMessage expects a lowercase hex SHA-256 digest');
  return utf8ToBytes(`${domain}\n${hashHex}`);
}

/** Verifies an Ed25519 signature. Never throws: malformed input is simply "not valid". */
export function verifyEd25519(publicKeyBase58: string, message: Uint8Array, signatureBase58: string): boolean {
  try {
    const publicKey = base58.decode(publicKeyBase58);
    const signature = base58.decode(signatureBase58);
    if (publicKey.length !== 32 || signature.length !== 64) return false;
    return ed25519.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}

export async function signDomainHash(
  signer: MessageSigner,
  domain: SignatureDomain,
  hashHex: string,
): Promise<string> {
  const signature = await signer.signMessage(domainMessage(domain, hashHex));
  if (signature.length !== 64) throw new Error('Signer returned a malformed Ed25519 signature');
  return toBase58(signature);
}

export function verifyDomainHash(
  publicKeyBase58: string,
  domain: SignatureDomain,
  hashHex: string,
  signatureBase58: string,
): boolean {
  if (!isSha256Hex(hashHex)) return false;
  return verifyEd25519(publicKeyBase58, domainMessage(domain, hashHex), signatureBase58);
}

/** In-process signer for tests and the devnet demo keyring. NOT for production keys. */
export class LocalEd25519Signer implements MessageSigner {
  readonly publicKey: string;
  private readonly seed: Uint8Array;

  /** @param seed 32-byte Ed25519 seed, or a 64-byte Solana secret key (seed || public key). */
  constructor(seed: Uint8Array) {
    if (seed.length !== 32 && seed.length !== 64) {
      throw new Error('LocalEd25519Signer expects a 32-byte seed or a 64-byte Solana secret key');
    }
    this.seed = seed.slice(0, 32);
    this.publicKey = toBase58(ed25519.getPublicKey(this.seed));
  }

  static generate(): LocalEd25519Signer {
    return new LocalEd25519Signer(ed25519.utils.randomPrivateKey());
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    return ed25519.sign(message, this.seed);
  }
}
