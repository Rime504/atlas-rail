import { expect } from 'chai';
import { LiteSVM } from 'litesvm';
import {
  PROGRAM_ID,
  freshSvm,
  airdrop,
  freshParties,
  defaultArgs,
  buildCreateMandateIx,
  send,
  sendWithMissingSignature,
  isFailure,
  logsOf,
  getRawAccountData,
  decodeMandateAccount,
  MandateErrorCode,
  FIXED_NOW,
  MandateParties,
  CreateMandateArgs,
} from './helpers';

function setup(): { svm: LiteSVM; parties: MandateParties } {
  const svm = freshSvm(PROGRAM_ID);
  const parties = freshParties();
  airdrop(svm, parties.owner.publicKey);
  airdrop(svm, parties.approver.publicKey);
  airdrop(svm, parties.agent.publicKey);
  return { svm, parties };
}

/** Sends create_mandate with all three required signers and returns the result. */
function createMandate(svm: LiteSVM, parties: MandateParties, args: CreateMandateArgs) {
  const { ix, mandatePda } = buildCreateMandateIx(PROGRAM_ID, parties, args);
  const result = send(svm, [ix], [parties.owner, parties.approver, parties.agent]);
  return { result, mandatePda };
}

describe('create_mandate', () => {
  it('happy path: creates the mandate account with the expected data', () => {
    const { svm, parties } = setup();
    const args = defaultArgs();

    const { result, mandatePda } = createMandate(svm, parties, args);

    expect(isFailure(result), logsOf(result)).to.equal(false);

    const data = getRawAccountData(svm, mandatePda);
    expect(data).to.not.equal(null);
    const mandate = decodeMandateAccount(data!);
    expect(mandate.owner.toBase58()).to.equal(parties.owner.publicKey.toBase58());
    expect(mandate.approver.toBase58()).to.equal(parties.approver.publicKey.toBase58());
    expect(mandate.agent.toBase58()).to.equal(parties.agent.publicKey.toBase58());
    expect(mandate.gateAuthority.toBase58()).to.equal(args.gateAuthority.toBase58());
    expect(mandate.maxPerPayment).to.equal(args.maxPerPayment);
    expect(mandate.maxPerWindow).to.equal(args.maxPerWindow);
    expect(mandate.maxTotal).to.equal(args.maxTotal);
    expect(mandate.notBefore).to.equal(args.notBefore);
    expect(mandate.expiresAt).to.equal(args.expiresAt);
    expect(mandate.revoked).to.equal(false);
    expect(Buffer.from(mandate.mandateHash)).to.deep.equal(Buffer.from(args.mandateHash));
  });

  it('fails without the approver signature', () => {
    const { svm, parties } = setup();
    const args = defaultArgs();
    const { ix } = buildCreateMandateIx(PROGRAM_ID, parties, args);

    // Owner and agent sign; approver's signature slot is left empty.
    const result = sendWithMissingSignature(svm, [ix], parties.owner, [parties.owner, parties.agent]);

    expect(isFailure(result)).to.equal(true);
  });

  it('fails without the agent signature', () => {
    const { svm, parties } = setup();
    const args = defaultArgs();
    const { ix } = buildCreateMandateIx(PROGRAM_ID, parties, args);

    // Owner and approver sign; agent's signature slot is left empty.
    const result = sendWithMissingSignature(svm, [ix], parties.owner, [parties.owner, parties.approver]);

    expect(isFailure(result)).to.equal(true);
  });

  it('rejects the approver being the same key as the owner', () => {
    const { svm, parties } = setup();
    const sameKeyParties: MandateParties = { ...parties, approver: parties.owner };
    const args = defaultArgs();

    const { result } = createMandate(svm, sameKeyParties, args);

    expect(isFailure(result), logsOf(result)).to.equal(true);
    expect(logsOf(result)).to.include(`Error Number: ${MandateErrorCode.ApproverIsOwner}`);
  });

  it('rejects the agent reusing the owner key', () => {
    const { svm, parties } = setup();
    const reusedKeyParties: MandateParties = { ...parties, agent: parties.owner };
    const args = defaultArgs();

    const { result } = createMandate(svm, reusedKeyParties, args);

    expect(isFailure(result), logsOf(result)).to.equal(true);
    expect(logsOf(result)).to.include(`Error Number: ${MandateErrorCode.AgentNotIndependent}`);
  });

  it('rejects the agent reusing the approver key', () => {
    const { svm, parties } = setup();
    const reusedKeyParties: MandateParties = { ...parties, agent: parties.approver };
    const args = defaultArgs();

    const { result } = createMandate(svm, reusedKeyParties, args);

    expect(isFailure(result), logsOf(result)).to.equal(true);
    expect(logsOf(result)).to.include(`Error Number: ${MandateErrorCode.AgentNotIndependent}`);
  });

  it('rejects a zero max_per_payment', () => {
    const { svm, parties } = setup();
    const args = defaultArgs({ maxPerPayment: 0n });

    const { result } = createMandate(svm, parties, args);

    expect(isFailure(result), logsOf(result)).to.equal(true);
    expect(logsOf(result)).to.include(`Error Number: ${MandateErrorCode.ZeroLimit}`);
  });

  it('rejects max_per_payment above max_total', () => {
    const { svm, parties } = setup();
    const args = defaultArgs({ maxPerPayment: 500_000_001n, maxTotal: 500_000_000n });

    const { result } = createMandate(svm, parties, args);

    expect(isFailure(result), logsOf(result)).to.equal(true);
    expect(logsOf(result)).to.include(`Error Number: ${MandateErrorCode.PerPaymentAboveTotal}`);
  });

  it('rejects max_per_window above max_total', () => {
    const { svm, parties } = setup();
    const args = defaultArgs({ maxPerWindow: 500_000_001n, maxTotal: 500_000_000n });

    const { result } = createMandate(svm, parties, args);

    expect(isFailure(result), logsOf(result)).to.equal(true);
    expect(logsOf(result)).to.include(`Error Number: ${MandateErrorCode.WindowAboveTotal}`);
  });

  it('rejects a window_seconds below the minimum', () => {
    const { svm, parties } = setup();
    const args = defaultArgs({ windowSeconds: 59n });

    const { result } = createMandate(svm, parties, args);

    expect(isFailure(result), logsOf(result)).to.equal(true);
    expect(logsOf(result)).to.include(`Error Number: ${MandateErrorCode.InvalidWindow}`);
  });

  it('rejects a window_seconds above the maximum', () => {
    const { svm, parties } = setup();
    const args = defaultArgs({ windowSeconds: 31_536_001n });

    const { result } = createMandate(svm, parties, args);

    expect(isFailure(result), logsOf(result)).to.equal(true);
    expect(logsOf(result)).to.include(`Error Number: ${MandateErrorCode.InvalidWindow}`);
  });

  it('rejects expires_at at or before not_before', () => {
    const { svm, parties } = setup();
    const args = defaultArgs({ notBefore: FIXED_NOW, expiresAt: FIXED_NOW });

    const { result } = createMandate(svm, parties, args);

    expect(isFailure(result), logsOf(result)).to.equal(true);
    expect(logsOf(result)).to.include(`Error Number: ${MandateErrorCode.InvalidValidity}`);
  });

  it('rejects a mandate that is already expired at creation time', () => {
    const { svm, parties } = setup();
    const args = defaultArgs({ notBefore: FIXED_NOW - 2_000n, expiresAt: FIXED_NOW - 1_000n });

    const { result } = createMandate(svm, parties, args);

    expect(isFailure(result), logsOf(result)).to.equal(true);
    expect(logsOf(result)).to.include(`Error Number: ${MandateErrorCode.AlreadyExpired}`);
  });
});
