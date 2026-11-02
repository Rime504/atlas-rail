import { NextRequest, NextResponse } from 'next/server';
import {
  DEFAULT_MANDATE_PROGRAM_ID,
  buildCreateMandateTransaction,
  buildRevokeMandateTransaction,
  findMandatePda,
} from '@atlas-rail/solana';

export const runtime = 'nodejs';

type CreateBody = {
  action: 'create';
  owner: string;
  approver: string;
  agent: string;
  recentBlockhash: string;
  mandateHashHex: string;
  gateAuthority: string;
  mint: string;
  maxPerPayment: string;
  maxPerWindow: string;
  windowSeconds: string;
  maxTotal: string;
  escalationThreshold: string;
  notBefore: string;
  expiresAt: string;
};

type RevokeBody = {
  action: 'revoke';
  mandatePda: string;
  authority: string;
  recentBlockhash: string;
};

export async function POST(req: NextRequest) {
  const body = (await req.json()) as CreateBody | RevokeBody;
  try {
    if (body.action === 'revoke') {
      const unsignedBase64 = buildRevokeMandateTransaction({
        programId: DEFAULT_MANDATE_PROGRAM_ID,
        mandatePda: body.mandatePda,
        authority: body.authority,
        recentBlockhash: body.recentBlockhash,
      });
      return NextResponse.json({ unsignedBase64, programId: DEFAULT_MANDATE_PROGRAM_ID });
    }

    const mandateHash = Buffer.from(body.mandateHashHex.trim(), 'hex');
    if (mandateHash.length !== 32) {
      return NextResponse.json({ error: 'mandateHashHex must be 64 hex chars' }, { status: 400 });
    }
    const { address: mandatePda } = findMandatePda(DEFAULT_MANDATE_PROGRAM_ID, mandateHash);
    const unsignedBase64 = buildCreateMandateTransaction({
      programId: DEFAULT_MANDATE_PROGRAM_ID,
      owner: body.owner,
      approver: body.approver,
      agent: body.agent,
      recentBlockhash: body.recentBlockhash,
      mandateHash,
      gateAuthority: body.gateAuthority,
      mint: body.mint,
      maxPerPayment: BigInt(body.maxPerPayment),
      maxPerWindow: BigInt(body.maxPerWindow),
      windowSeconds: BigInt(body.windowSeconds),
      maxTotal: BigInt(body.maxTotal),
      escalationThreshold: BigInt(body.escalationThreshold || '0'),
      notBefore: BigInt(body.notBefore),
      expiresAt: BigInt(body.expiresAt),
    });
    return NextResponse.json({ unsignedBase64, mandatePda, programId: DEFAULT_MANDATE_PROGRAM_ID });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'prepare failed' },
      { status: 400 },
    );
  }
}
