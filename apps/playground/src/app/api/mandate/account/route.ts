import { NextRequest, NextResponse } from 'next/server';
import { Connection } from '@solana/web3.js';
import {
  DEFAULT_MANDATE_PROGRAM_ID,
  exportMandateAccountJson,
  isMandateAccountActive,
  loadMandateAccount,
} from '@atlas-rail/solana';

export const runtime = 'nodejs';

const RPC = process.env.PLAYGROUND_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address');
  if (!address) return NextResponse.json({ error: 'address is required' }, { status: 400 });
  try {
    const connection = new Connection(RPC, 'confirmed');
    const account = await loadMandateAccount(connection, address, DEFAULT_MANDATE_PROGRAM_ID);
    const exported = exportMandateAccountJson(address, account, {
      programId: DEFAULT_MANDATE_PROGRAM_ID,
    });
    return NextResponse.json({
      account: {
        ...account,
        maxPerPayment: account.maxPerPayment.toString(),
        maxPerWindow: account.maxPerWindow.toString(),
        windowSeconds: account.windowSeconds.toString(),
        maxTotal: account.maxTotal.toString(),
        escalationThreshold: account.escalationThreshold.toString(),
        notBefore: account.notBefore.toString(),
        expiresAt: account.expiresAt.toString(),
        createdAt: account.createdAt.toString(),
        revokedAt: account.revokedAt.toString(),
        nextRootSeq: account.nextRootSeq.toString(),
      },
      active: isMandateAccountActive(account),
      export: exported,
      programId: DEFAULT_MANDATE_PROGRAM_ID,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'load failed' },
      { status: 400 },
    );
  }
}
