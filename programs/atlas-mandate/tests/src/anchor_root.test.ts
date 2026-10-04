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
  send,
  isFailure,
  logsOf,
  getRawAccountData,
  decodeMandateAccount,
  decodeRootAccount,
  MandateErrorCode,
  MandateParties,
  AnchorRootArgs,
} from './helpers';

function merkleRoot(seed: string): Uint8Array {
  return createHash('sha256').update(seed).digest();
}

function defaultRootArgs(overrides: Partial<AnchorRootArgs> = {}): AnchorRootArgs {
  return {
    seq: 0n,
    merkleRoot: merkleRoot('batch-0'),
    leafCount: 3,
    ...overrides,
  };
}

/** Fresh SVM with one already-created mandate and a known gate_authority keypair. */
function setupWithMandate(): {
  svm: LiteSVM;
  parties: MandateParties;
  gateAuthority: Keypair;
  mandatePda: PublicKey;
} {
  const svm = freshSvm(PROGRAM_ID);
  const parties = freshParties();
  const gateAuthority = Keypair.generate();
  airdrop(svm, parties.owner.publicKey);
  airdrop(svm, parties.approver.publicKey);
  airdrop(svm, parties.agent.publicKey);
  airdrop(svm, gateAuthority.publicKey);
  const args = defaultArgs({ gateAuthority: gateAuthority.publicKey });
  const { ix, mandatePda } = buildCreateMandateIx(PROGRAM_ID, parties, args);
  const createResult = send(svm, [ix], [parties.owner, parties.approver, parties.agent]);
  expect(isFailure(createResult), logsOf(createResult)).to.equal(false);
  return { svm, parties, gateAuthority, mandatePda };
}

describe('anchor_root', () => {
  it('happy path: gate authority anchors seq 0 and advances next_root_seq', () => {
    const { svm, gateAuthority, mandatePda } = setupWithMandate();
    const args = defaultRootArgs();
    const { ix, rootPda } = buildAnchorRootIx(PROGRAM_ID, mandatePda, gateAuthority.publicKey, args);

    const result = send(svm, [ix], [gateAuthority]);

    expect(isFailure(result), logsOf(result)).to.equal(false);

    const mandate = decodeMandateAccount(getRawAccountData(svm, mandatePda)!);
    expect(mandate.nextRootSeq).to.equal(1n);

    const root = decodeRootAccount(getRawAccountData(svm, rootPda)!);
    expect(root.mandate.toBase58()).to.equal(mandatePda.toBase58());
    expect(root.seq).to.equal(0n);
    expect(Buffer.from(root.merkleRoot).equals(Buffer.from(args.merkleRoot))).to.equal(true);
    expect(root.leafCount).to.equal(3);
    expect(root.anchoredAt).to.equal(FIXED_NOW);
  });

  it('happy path: sequential seq 0 then seq 1', () => {
    const { svm, gateAuthority, mandatePda } = setupWithMandate();

    const first = buildAnchorRootIx(PROGRAM_ID, mandatePda, gateAuthority.publicKey, defaultRootArgs());
    const firstResult = send(svm, [first.ix], [gateAuthority]);
    expect(isFailure(firstResult), logsOf(firstResult)).to.equal(false);

    const secondArgs = defaultRootArgs({ seq: 1n, merkleRoot: merkleRoot('batch-1'), leafCount: 7 });
    const second = buildAnchorRootIx(PROGRAM_ID, mandatePda, gateAuthority.publicKey, secondArgs);
    const secondResult = send(svm, [second.ix], [gateAuthority]);
    expect(isFailure(secondResult), logsOf(secondResult)).to.equal(false);

    const mandate = decodeMandateAccount(getRawAccountData(svm, mandatePda)!);
    expect(mandate.nextRootSeq).to.equal(2n);

    const root = decodeRootAccount(getRawAccountData(svm, second.rootPda)!);
    expect(root.seq).to.equal(1n);
    expect(root.leafCount).to.equal(7);
  });

  it('fails when the owner tries to anchor (UnauthorizedAnchor)', () => {
    const { svm, parties, mandatePda } = setupWithMandate();
    const { ix } = buildAnchorRootIx(PROGRAM_ID, mandatePda, parties.owner.publicKey, defaultRootArgs());

    const result = send(svm, [ix], [parties.owner]);

    expect(isFailure(result), logsOf(result)).to.equal(true);
    expect(logsOf(result)).to.include(`Error Number: ${MandateErrorCode.UnauthorizedAnchor}`);
  });

  it('fails when the agent tries to anchor (UnauthorizedAnchor)', () => {
    const { svm, parties, mandatePda } = setupWithMandate();
    airdrop(svm, parties.agent.publicKey);
    const { ix } = buildAnchorRootIx(PROGRAM_ID, mandatePda, parties.agent.publicKey, defaultRootArgs());

    const result = send(svm, [ix], [parties.agent]);

    expect(isFailure(result), logsOf(result)).to.equal(true);
    expect(logsOf(result)).to.include(`Error Number: ${MandateErrorCode.UnauthorizedAnchor}`);
  });

  it('fails when a stranger tries to anchor (UnauthorizedAnchor)', () => {
    const { svm, mandatePda } = setupWithMandate();
    const stranger = Keypair.generate();
    airdrop(svm, stranger.publicKey);
    const { ix } = buildAnchorRootIx(PROGRAM_ID, mandatePda, stranger.publicKey, defaultRootArgs());

    const result = send(svm, [ix], [stranger]);

    expect(isFailure(result), logsOf(result)).to.equal(true);
    expect(logsOf(result)).to.include(`Error Number: ${MandateErrorCode.UnauthorizedAnchor}`);
  });

  it('fails when seq skips ahead (OutOfOrderSeq)', () => {
    const { svm, gateAuthority, mandatePda } = setupWithMandate();
    const { ix } = buildAnchorRootIx(
      PROGRAM_ID,
      mandatePda,
      gateAuthority.publicKey,
      defaultRootArgs({ seq: 1n }),
    );

    const result = send(svm, [ix], [gateAuthority]);

    expect(isFailure(result), logsOf(result)).to.equal(true);
    expect(logsOf(result)).to.include(`Error Number: ${MandateErrorCode.OutOfOrderSeq}`);
  });

  it('fails when seq is replayed (OutOfOrderSeq)', () => {
    const { svm, gateAuthority, mandatePda } = setupWithMandate();
    const args = defaultRootArgs();
    const first = buildAnchorRootIx(PROGRAM_ID, mandatePda, gateAuthority.publicKey, args);
    const firstResult = send(svm, [first.ix], [gateAuthority]);
    expect(isFailure(firstResult), logsOf(firstResult)).to.equal(false);

    // Same seq again — PDA already exists, but even a fresh PDA would fail the seq check.
    // Use a different merkle root so we are testing program logic, not account collision alone.
    const replay = buildAnchorRootIx(
      PROGRAM_ID,
      mandatePda,
      gateAuthority.publicKey,
      defaultRootArgs({ merkleRoot: merkleRoot('replay') }),
    );
    const result = send(svm, [replay.ix], [gateAuthority]);

    expect(isFailure(result), logsOf(result)).to.equal(true);
    // Replaying seq 0 after next_root_seq advanced hits OutOfOrderSeq; if the PDA already
    // exists Anchor rejects with an account-init error first — either is a hard failure.
    const logs = logsOf(result);
    const outOfOrder = logs.includes(`Error Number: ${MandateErrorCode.OutOfOrderSeq}`);
    const alreadyInUse = logs.includes('already in use');
    expect(outOfOrder || alreadyInUse, logs).to.equal(true);
  });

  it('fails when leaf_count is zero (EmptyBatch)', () => {
    const { svm, gateAuthority, mandatePda } = setupWithMandate();
    const { ix } = buildAnchorRootIx(
      PROGRAM_ID,
      mandatePda,
      gateAuthority.publicKey,
      defaultRootArgs({ leafCount: 0 }),
    );

    const result = send(svm, [ix], [gateAuthority]);

    expect(isFailure(result), logsOf(result)).to.equal(true);
    expect(logsOf(result)).to.include(`Error Number: ${MandateErrorCode.EmptyBatch}`);
  });

  it('succeeds after the mandate has been revoked', () => {
    const { svm, parties, gateAuthority, mandatePda } = setupWithMandate();
    const revokeIx = buildRevokeMandateIx(PROGRAM_ID, mandatePda, parties.owner.publicKey);
    const revokeResult = send(svm, [revokeIx], [parties.owner]);
    expect(isFailure(revokeResult), logsOf(revokeResult)).to.equal(false);

    const args = defaultRootArgs();
    const { ix, rootPda } = buildAnchorRootIx(PROGRAM_ID, mandatePda, gateAuthority.publicKey, args);
    const result = send(svm, [ix], [gateAuthority]);

    expect(isFailure(result), logsOf(result)).to.equal(false);
    const mandate = decodeMandateAccount(getRawAccountData(svm, mandatePda)!);
    expect(mandate.revoked).to.equal(true);
    expect(mandate.nextRootSeq).to.equal(1n);
    const root = decodeRootAccount(getRawAccountData(svm, rootPda)!);
    expect(root.seq).to.equal(0n);
  });
});
