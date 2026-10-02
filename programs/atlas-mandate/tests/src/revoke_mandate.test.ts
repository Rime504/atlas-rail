import { expect } from 'chai';
import { Keypair } from '@solana/web3.js';
import { LiteSVM } from 'litesvm';
import {
  PROGRAM_ID,
  freshSvm,
  airdrop,
  freshParties,
  defaultArgs,
  buildCreateMandateIx,
  buildRevokeMandateIx,
  send,
  isFailure,
  logsOf,
  getRawAccountData,
  decodeMandateAccount,
  MandateErrorCode,
  MandateParties,
} from './helpers';

/** Fresh SVM with one already-created, active mandate, ready to be revoked. */
function setupWithMandate(): { svm: LiteSVM; parties: MandateParties; mandatePda: ReturnType<typeof buildCreateMandateIx>['mandatePda'] } {
  const svm = freshSvm(PROGRAM_ID);
  const parties = freshParties();
  airdrop(svm, parties.owner.publicKey);
  airdrop(svm, parties.approver.publicKey);
  airdrop(svm, parties.agent.publicKey);
  const args = defaultArgs();
  const { ix, mandatePda } = buildCreateMandateIx(PROGRAM_ID, parties, args);
  const createResult = send(svm, [ix], [parties.owner, parties.approver, parties.agent]);
  expect(isFailure(createResult), logsOf(createResult)).to.equal(false);
  return { svm, parties, mandatePda };
}

describe('revoke_mandate', () => {
  it('happy path: the owner can revoke an active mandate', () => {
    const { svm, parties, mandatePda } = setupWithMandate();
    const ix = buildRevokeMandateIx(PROGRAM_ID, mandatePda, parties.owner.publicKey);

    const result = send(svm, [ix], [parties.owner]);

    expect(isFailure(result), logsOf(result)).to.equal(false);
    const mandate = decodeMandateAccount(getRawAccountData(svm, mandatePda)!);
    expect(mandate.revoked).to.equal(true);
    expect(mandate.revokedBy.toBase58()).to.equal(parties.owner.publicKey.toBase58());
  });

  it('happy path: the approver can revoke an active mandate', () => {
    const { svm, parties, mandatePda } = setupWithMandate();
    const ix = buildRevokeMandateIx(PROGRAM_ID, mandatePda, parties.approver.publicKey);

    const result = send(svm, [ix], [parties.approver]);

    expect(isFailure(result), logsOf(result)).to.equal(false);
    const mandate = decodeMandateAccount(getRawAccountData(svm, mandatePda)!);
    expect(mandate.revoked).to.equal(true);
    expect(mandate.revokedBy.toBase58()).to.equal(parties.approver.publicKey.toBase58());
  });

  it('fails when a stranger tries to revoke', () => {
    const { svm, mandatePda } = setupWithMandate();
    const stranger = Keypair.generate();
    airdrop(svm, stranger.publicKey);
    const ix = buildRevokeMandateIx(PROGRAM_ID, mandatePda, stranger.publicKey);

    const result = send(svm, [ix], [stranger]);

    expect(isFailure(result), logsOf(result)).to.equal(true);
    expect(logsOf(result)).to.include(`Error Number: ${MandateErrorCode.NotAuthorizedToRevoke}`);
  });

  it('fails when the agent tries to revoke (only owner or approver may)', () => {
    const { svm, parties, mandatePda } = setupWithMandate();
    const ix = buildRevokeMandateIx(PROGRAM_ID, mandatePda, parties.agent.publicKey);

    const result = send(svm, [ix], [parties.agent]);

    expect(isFailure(result), logsOf(result)).to.equal(true);
    expect(logsOf(result)).to.include(`Error Number: ${MandateErrorCode.NotAuthorizedToRevoke}`);
  });

  it('fails on a second revoke attempt', () => {
    const { svm, parties, mandatePda } = setupWithMandate();
    const firstIx = buildRevokeMandateIx(PROGRAM_ID, mandatePda, parties.owner.publicKey);
    const firstResult = send(svm, [firstIx], [parties.owner]);
    expect(isFailure(firstResult), logsOf(firstResult)).to.equal(false);

    const secondIx = buildRevokeMandateIx(PROGRAM_ID, mandatePda, parties.approver.publicKey);
    const secondResult = send(svm, [secondIx], [parties.approver]);

    expect(isFailure(secondResult), logsOf(secondResult)).to.equal(true);
    expect(logsOf(secondResult)).to.include(`Error Number: ${MandateErrorCode.AlreadyRevoked}`);
  });
});
