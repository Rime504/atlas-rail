import { expect } from 'chai';
import { createHash } from 'crypto';
import { Keypair, PublicKey } from '@solana/web3.js';
import { LiteSVM } from 'litesvm';
import {
  PROGRAM_ID,
  FIXED_NOW,
  freshSvm,
  airdrop,
  freshParties,
  defaultArgs,
  buildCreateMandateIx,
  buildRevokeMandateIx,
  buildAnchorRootIx,
  buildAnchorRootV2Ix,
  send,
  isFailure,
  logsOf,
  getRawAccountData,
  decodeMandateAccount,
  decodeRootAccount,
  decodeRootV2Account,
  MandateErrorCode,
  AnchorRootV2Args,
} from './helpers';

function hash(seed: string): Uint8Array {
  return createHash('sha256').update(seed).digest();
}

/** Same bytes as encodeBatchHeader in packages/receipt/src/batch-file.ts. */
function batchHeader(mandate: PublicKey, seq: bigint, leafCount: number, merkleRoot: Uint8Array, batchFileHash: Uint8Array): Uint8Array {
  const seqBytes = Buffer.alloc(8);
  seqBytes.writeBigUInt64LE(seq);
  const countBytes = Buffer.alloc(4);
  countBytes.writeUInt32LE(leafCount);
  return createHash('sha256')
    .update(Buffer.from('atlasrail.batch-header/1\0'))
    .update(mandate.toBuffer())
    .update(seqBytes)
    .update(countBytes)
    .update(merkleRoot)
    .update(batchFileHash)
    .digest();
}

function v2Args(mandate: PublicKey, overrides: Partial<AnchorRootV2Args> = {}): AnchorRootV2Args {
  const base = { seq: 0n, merkleRoot: hash('batch-0'), leafCount: 3, batchFileHash: hash('file-0'), ...overrides };
  return { ...base, batchHeader: overrides.batchHeader ?? batchHeader(mandate, base.seq, base.leafCount, base.merkleRoot, base.batchFileHash) };
}

function setupWithMandate(): { svm: LiteSVM; gateAuthority: Keypair; mandatePda: PublicKey; owner: Keypair } {
  const svm = freshSvm(PROGRAM_ID);
  const parties = freshParties();
  const gateAuthority = Keypair.generate();
  airdrop(svm, parties.owner.publicKey);
  airdrop(svm, parties.approver.publicKey);
  airdrop(svm, parties.agent.publicKey);
  airdrop(svm, gateAuthority.publicKey);
  const { ix, mandatePda } = buildCreateMandateIx(PROGRAM_ID, parties, defaultArgs({ gateAuthority: gateAuthority.publicKey }));
  const created = send(svm, [ix], [parties.owner, parties.approver, parties.agent]);
  expect(isFailure(created), logsOf(created)).to.equal(false);
  return { svm, gateAuthority, mandatePda, owner: parties.owner };
}

describe('anchor_root_v2', () => {
  it('stores the root, the leaf count, the batch header hash and the batch file hash', () => {
    const { svm, gateAuthority, mandatePda } = setupWithMandate();
    const args = v2Args(mandatePda);
    const { ix, rootPda } = buildAnchorRootV2Ix(PROGRAM_ID, mandatePda, gateAuthority.publicKey, args);
    const result = send(svm, [ix], [gateAuthority]);
    expect(isFailure(result), logsOf(result)).to.equal(false);

    const root = decodeRootV2Account(getRawAccountData(svm, rootPda)!);
    expect(root.mandate.toBase58()).to.equal(mandatePda.toBase58());
    expect(root.seq).to.equal(0n);
    expect(Buffer.from(root.merkleRoot).equals(Buffer.from(args.merkleRoot))).to.equal(true);
    expect(root.leafCount).to.equal(3);
    expect(root.anchoredAt).to.equal(FIXED_NOW);
    expect(Buffer.from(root.batchHeader).equals(Buffer.from(args.batchHeader))).to.equal(true);
    expect(Buffer.from(root.batchFileHash).equals(Buffer.from(args.batchFileHash))).to.equal(true);
    expect(decodeMandateAccount(getRawAccountData(svm, mandatePda)!).nextRootSeq).to.equal(1n);
  });

  it('shares next_root_seq with the deprecated anchor_root, and both account types stay readable', () => {
    const { svm, gateAuthority, mandatePda } = setupWithMandate();
    const old = buildAnchorRootIx(PROGRAM_ID, mandatePda, gateAuthority.publicKey, { seq: 0n, merkleRoot: hash('old'), leafCount: 2 });
    const oldResult = send(svm, [old.ix], [gateAuthority]);
    expect(isFailure(oldResult), logsOf(oldResult)).to.equal(false);

    const replayOldSeq = buildAnchorRootV2Ix(PROGRAM_ID, mandatePda, gateAuthority.publicKey, v2Args(mandatePda, { seq: 0n }));
    expect(isFailure(send(svm, [replayOldSeq.ix], [gateAuthority]))).to.equal(true);

    const next = buildAnchorRootV2Ix(PROGRAM_ID, mandatePda, gateAuthority.publicKey, v2Args(mandatePda, { seq: 1n }));
    const nextResult = send(svm, [next.ix], [gateAuthority]);
    expect(isFailure(nextResult), logsOf(nextResult)).to.equal(false);

    expect(decodeRootAccount(getRawAccountData(svm, old.rootPda)!).leafCount).to.equal(2);
    expect(decodeRootV2Account(getRawAccountData(svm, next.rootPda)!).seq).to.equal(1n);
    expect(decodeMandateAccount(getRawAccountData(svm, mandatePda)!).nextRootSeq).to.equal(2n);
  });

  it('rejects an all-zero batch header or batch file hash (MissingBatchHash)', () => {
    for (const missing of [{ batchHeader: new Uint8Array(32) }, { batchFileHash: new Uint8Array(32) }]) {
      const { svm, gateAuthority, mandatePda } = setupWithMandate();
      const { ix } = buildAnchorRootV2Ix(PROGRAM_ID, mandatePda, gateAuthority.publicKey, v2Args(mandatePda, missing));
      const result = send(svm, [ix], [gateAuthority]);
      expect(isFailure(result), logsOf(result)).to.equal(true);
      expect(logsOf(result)).to.include(`Error Number: ${MandateErrorCode.MissingBatchHash}`);
    }
  });

  it('fails for anyone but the gate authority, out of order, or empty', () => {
    const { svm, gateAuthority, mandatePda, owner } = setupWithMandate();
    const byOwner = buildAnchorRootV2Ix(PROGRAM_ID, mandatePda, owner.publicKey, v2Args(mandatePda));
    expect(logsOf(send(svm, [byOwner.ix], [owner]))).to.include(`Error Number: ${MandateErrorCode.UnauthorizedAnchor}`);
    const skip = buildAnchorRootV2Ix(PROGRAM_ID, mandatePda, gateAuthority.publicKey, v2Args(mandatePda, { seq: 1n }));
    expect(logsOf(send(svm, [skip.ix], [gateAuthority]))).to.include(`Error Number: ${MandateErrorCode.OutOfOrderSeq}`);
    const empty = buildAnchorRootV2Ix(PROGRAM_ID, mandatePda, gateAuthority.publicKey, v2Args(mandatePda, { leafCount: 0 }));
    expect(logsOf(send(svm, [empty.ix], [gateAuthority]))).to.include(`Error Number: ${MandateErrorCode.EmptyBatch}`);
  });

  it('rejects a batch header that is not the hash of the other fields (BatchHeaderMismatch)', () => {
    const { svm, gateAuthority, mandatePda } = setupWithMandate();
    const forged = buildAnchorRootV2Ix(PROGRAM_ID, mandatePda, gateAuthority.publicKey, v2Args(mandatePda, { batchHeader: hash('not-the-header') }));
    expect(logsOf(send(svm, [forged.ix], [gateAuthority]))).to.include(`Error Number: ${MandateErrorCode.BatchHeaderMismatch}`);
    // A header made for a different seq does not match this seq either.
    const wrongSeq = v2Args(mandatePda, { seq: 0n, batchHeader: batchHeader(mandatePda, 5n, 3, hash('batch-0'), hash('file-0')) });
    const moved = buildAnchorRootV2Ix(PROGRAM_ID, mandatePda, gateAuthority.publicKey, wrongSeq);
    expect(logsOf(send(svm, [moved.ix], [gateAuthority]))).to.include(`Error Number: ${MandateErrorCode.BatchHeaderMismatch}`);
  });

  it('succeeds after the mandate has been revoked', () => {
    const { svm, gateAuthority, mandatePda, owner } = setupWithMandate();
    const revoked = send(svm, [buildRevokeMandateIx(PROGRAM_ID, mandatePda, owner.publicKey)], [owner]);
    expect(isFailure(revoked), logsOf(revoked)).to.equal(false);
    const { ix } = buildAnchorRootV2Ix(PROGRAM_ID, mandatePda, gateAuthority.publicKey, v2Args(mandatePda));
    const result = send(svm, [ix], [gateAuthority]);
    expect(isFailure(result), logsOf(result)).to.equal(false);
  });
});
