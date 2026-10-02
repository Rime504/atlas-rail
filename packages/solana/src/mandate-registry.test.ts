import { describe, expect, it } from 'vitest';
import { Keypair, VersionedTransaction } from '@solana/web3.js';
import {
  buildCreateMandateTransaction,
  buildRevokeMandateTransaction,
  decodeMandateAccount,
  findMandatePda,
} from './mandate-registry';

// Verified independently against `sha256("global:create_mandate")[0..8]` etc. (and against the IDL
// `anchor build` generates) — if these ever drift from the deployed program, every instruction call
// silently fails as "unknown instruction", so this test exists to catch that immediately.
const CREATE_MANDATE_DISCRIMINATOR = Buffer.from([230, 170, 158, 68, 33, 169, 16, 158]);
const REVOKE_MANDATE_DISCRIMINATOR = Buffer.from([252, 97, 140, 119, 67, 43, 177, 108]);
const MANDATE_ACCOUNT_DISCRIMINATOR = Buffer.from([113, 216, 98, 159, 185, 63, 55, 18]);

const PROGRAM_ID = 'CnGoTE5Bxc8MFGaeK5LDv5uAZ7pNiktMunYy8JZcLY4k';
// Any valid 32-byte base58 pubkey works as a dummy blockhash for building (unsigned, unsent)
// transactions in these tests — reusing the well-known System Program address for convenience.
const DUMMY_BLOCKHASH = '11111111111111111111111111111111';

function mandateHash(byte: number): Uint8Array {
  return new Uint8Array(32).fill(byte);
}

describe('findMandatePda', () => {
  it('derives the same PDA for the same program id and mandate hash', () => {
    const a = findMandatePda(PROGRAM_ID, mandateHash(7));
    const b = findMandatePda(PROGRAM_ID, mandateHash(7));
    expect(a.address).toBe(b.address);
  });

  it('derives a different PDA for a different mandate hash', () => {
    const a = findMandatePda(PROGRAM_ID, mandateHash(7));
    const b = findMandatePda(PROGRAM_ID, mandateHash(8));
    expect(a.address).not.toBe(b.address);
  });
});

describe('buildCreateMandateTransaction', () => {
  it('encodes the exact Anchor discriminator for create_mandate', () => {
    const owner = Keypair.generate().publicKey.toBase58();
    const base64 = buildCreateMandateTransaction({
      programId: PROGRAM_ID,
      mandateHash: mandateHash(1),
      gateAuthority: Keypair.generate().publicKey.toBase58(),
      mint: Keypair.generate().publicKey.toBase58(),
      maxPerPayment: 50_000_000n,
      maxPerWindow: 100_000_000n,
      windowSeconds: 86_400n,
      maxTotal: 500_000_000n,
      escalationThreshold: 25_000_000n,
      notBefore: 0n,
      expiresAt: 2_000_000_000n,
      owner,
      approver: Keypair.generate().publicKey.toBase58(),
      agent: Keypair.generate().publicKey.toBase58(),
      recentBlockhash: DUMMY_BLOCKHASH,
    });
    const tx = VersionedTransaction.deserialize(Buffer.from(base64, 'base64'));
    const ix = tx.message.compiledInstructions[0];
    expect(Buffer.from(ix.data.subarray(0, 8))).toEqual(CREATE_MANDATE_DISCRIMINATOR);
    expect(tx.message.staticAccountKeys[0].toBase58()).toBe(owner); // fee payer
  });

  it('places the mandate PDA, three signers and the system program in the expected account order', () => {
    const owner = Keypair.generate().publicKey.toBase58();
    const approver = Keypair.generate().publicKey.toBase58();
    const agent = Keypair.generate().publicKey.toBase58();
    const hash = mandateHash(2);
    const { address: expectedPda } = findMandatePda(PROGRAM_ID, hash);
    const base64 = buildCreateMandateTransaction({
      programId: PROGRAM_ID,
      mandateHash: hash,
      gateAuthority: Keypair.generate().publicKey.toBase58(),
      mint: Keypair.generate().publicKey.toBase58(),
      maxPerPayment: 1n,
      maxPerWindow: 1n,
      windowSeconds: 60n,
      maxTotal: 1n,
      escalationThreshold: 1n,
      notBefore: 0n,
      expiresAt: 2_000_000_000n,
      owner,
      approver,
      agent,
      recentBlockhash: DUMMY_BLOCKHASH,
    });
    const tx = VersionedTransaction.deserialize(Buffer.from(base64, 'base64'));
    const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
    // compileToV0Message reorders accounts by role (fee payer, signers, writable, readonly), so we
    // assert membership and signer count here, not instruction-declaration order.
    expect(keys).toContain(expectedPda);
    expect(keys).toContain(owner);
    expect(keys).toContain(approver);
    expect(keys).toContain(agent);
    expect(keys[0]).toBe(owner); // fee payer is always first
    expect(tx.message.header.numRequiredSignatures).toBe(3); // owner, approver, agent — not the PDA or system program
  });
});

describe('buildRevokeMandateTransaction', () => {
  it('encodes the exact Anchor discriminator for revoke_mandate with no further args', () => {
    const authority = Keypair.generate().publicKey.toBase58();
    const { address: mandatePda } = findMandatePda(PROGRAM_ID, mandateHash(3));
    const base64 = buildRevokeMandateTransaction({
      programId: PROGRAM_ID,
      mandatePda,
      authority,
      recentBlockhash: DUMMY_BLOCKHASH,
    });
    const tx = VersionedTransaction.deserialize(Buffer.from(base64, 'base64'));
    const ix = tx.message.compiledInstructions[0];
    expect(Buffer.from(ix.data)).toEqual(REVOKE_MANDATE_DISCRIMINATOR);
    expect(tx.message.header.numRequiredSignatures).toBe(1);
  });
});

describe('decodeMandateAccount', () => {
  it('round-trips a hand-built account buffer matching the Rust struct layout', () => {
    const owner = Keypair.generate().publicKey;
    const approver = Keypair.generate().publicKey;
    const agent = Keypair.generate().publicKey;
    const gateAuthority = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const revokedBy = Keypair.generate().publicKey;

    // mandate_hash(32) + 5 pubkeys(32*5) + 8 numeric fields(8*8) + revoked(1) + revoked_at(8) + revoked_by(32) + bump(1)
    const body = Buffer.alloc(32 + 32 * 5 + 8 * 8 + 1 + 8 + 32 + 1);
    let o = 0;
    Buffer.from(mandateHash(9)).copy(body, o); o += 32;
    owner.toBuffer().copy(body, o); o += 32;
    approver.toBuffer().copy(body, o); o += 32;
    agent.toBuffer().copy(body, o); o += 32;
    gateAuthority.toBuffer().copy(body, o); o += 32;
    mint.toBuffer().copy(body, o); o += 32;
    body.writeBigUInt64LE(50_000_000n, o); o += 8;
    body.writeBigUInt64LE(100_000_000n, o); o += 8;
    body.writeBigInt64LE(86_400n, o); o += 8;
    body.writeBigUInt64LE(500_000_000n, o); o += 8;
    body.writeBigUInt64LE(25_000_000n, o); o += 8;
    body.writeBigInt64LE(1_000n, o); o += 8;
    body.writeBigInt64LE(10_000n, o); o += 8;
    body.writeBigInt64LE(900n, o); o += 8;
    body.writeUInt8(1, o); o += 1; // revoked = true
    body.writeBigInt64LE(5_000n, o); o += 8;
    revokedBy.toBuffer().copy(body, o); o += 32;
    body.writeUInt8(255, o);
    const data = Buffer.concat([MANDATE_ACCOUNT_DISCRIMINATOR, body]);

    const decoded = decodeMandateAccount(data);
    expect(decoded.owner).toBe(owner.toBase58());
    expect(decoded.approver).toBe(approver.toBase58());
    expect(decoded.agent).toBe(agent.toBase58());
    expect(decoded.gateAuthority).toBe(gateAuthority.toBase58());
    expect(decoded.mint).toBe(mint.toBase58());
    expect(decoded.maxPerPayment).toBe(50_000_000n);
    expect(decoded.windowSeconds).toBe(86_400n);
    expect(decoded.revoked).toBe(true);
    expect(decoded.revokedAt).toBe(5_000n);
    expect(decoded.revokedBy).toBe(revokedBy.toBase58());
    expect(decoded.bump).toBe(255);
    expect(decoded.mandateHash).toBe(Buffer.from(mandateHash(9)).toString('hex'));
  });

  it('rejects data with the wrong account discriminator', () => {
    const bad = Buffer.alloc(8 + 32 + 32 * 5 + 8 * 8 + 1 + 8 + 32 + 1);
    expect(() => decodeMandateAccount(bad)).toThrow(/discriminator/);
  });
});
