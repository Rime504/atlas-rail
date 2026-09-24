import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { Keypair } from '@solana/web3.js';
import { DevnetKeypairSigner } from './keypair-signer';

/**
 * A file of devnet keys for the demo (the Atlas Rail instance attestation key, per-user signing keys,
 * demo wallets). The file lives in `.demo/` (git-ignored), holds ONLY worthless devnet keys, and the
 * class refuses to load in production or without ATLAS_ALLOW_MOCK_SIGNER=true. Production keys never
 * touch this code path: they sit behind a customer-controlled SignerAdapter (ADR 0003).
 */
export interface KeyringFile {
  version: 1;
  keys: Record<string, { publicKey: string; secretKey: number[] }>;
}

export function defaultKeyringPath(): string {
  return resolve(process.env.ATLAS_KEYRING_PATH ?? '.demo/keyring.json');
}

export class DevnetKeyring {
  private constructor(
    private readonly path: string,
    private file: KeyringFile,
  ) {}

  /** Loads the keyring, creating an empty one if it does not exist yet. */
  static load(path = defaultKeyringPath()): DevnetKeyring {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('CRITICAL SAFETY FATAL: the devnet keyring cannot be used in production environment!');
    }
    if (process.env.ATLAS_ALLOW_MOCK_SIGNER !== 'true') {
      throw new Error('The devnet keyring is disabled. Set ATLAS_ALLOW_MOCK_SIGNER=true for devnet testing.');
    }
    const file: KeyringFile = existsSync(path)
      ? (JSON.parse(readFileSync(path, 'utf8')) as KeyringFile)
      : { version: 1, keys: {} };
    return new DevnetKeyring(path, file);
  }

  has(label: string): boolean {
    this.reload();
    return label in this.file.keys;
  }

  labels(): string[] {
    return Object.keys(this.file.keys);
  }

  publicKey(label: string): string | null {
    this.reload();
    return this.file.keys[label]?.publicKey ?? null;
  }

  /** Returns the signer for `label`, generating and persisting a fresh devnet key on first use. */
  signer(label: string): DevnetKeypairSigner {
    this.reload(); // another process (API, worker, setup script) may have created the key since we loaded
    let entry = this.file.keys[label];
    if (!entry) {
      const keypair = Keypair.generate();
      entry = { publicKey: keypair.publicKey.toBase58(), secretKey: Array.from(keypair.secretKey) };
      this.file.keys[label] = entry;
      this.persist();
    }
    return new DevnetKeypairSigner(Uint8Array.from(entry.secretKey));
  }

  /** Signer for a known public key (used to sign on behalf of a console user), or null. */
  signerByPublicKey(publicKey: string): DevnetKeypairSigner | null {
    this.reload();
    const entry = Object.values(this.file.keys).find((k) => k.publicKey === publicKey);
    return entry ? new DevnetKeypairSigner(Uint8Array.from(entry.secretKey)) : null;
  }

  private reload(): void {
    if (existsSync(this.path)) this.file = JSON.parse(readFileSync(this.path, 'utf8')) as KeyringFile;
  }

  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(this.file, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.path);
  }
}
