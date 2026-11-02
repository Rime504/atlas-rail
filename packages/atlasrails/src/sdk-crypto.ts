import { toBase58, verifyEd25519 as verifyEd25519Base58 } from '@atlas-rail/mandate';

/** Verifies a raw 64-byte Ed25519 signature using the mandate package verifier. */
export function verifyEd25519(publicKeyBytes: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  if (publicKeyBytes.length !== 32 || signature.length !== 64) return false;
  return verifyEd25519Base58(toBase58(publicKeyBytes), message, toBase58(signature));
}
