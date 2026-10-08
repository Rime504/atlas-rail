import { NextRequest, NextResponse } from 'next/server';
import { PublicKey } from '@solana/web3.js';
import { clientIp, createLimiter } from '@/lib/rate-limit';
import { BreakAttack, tryToBreak } from '@/lib/scenario';

export const runtime = 'nodejs';

const ATTACKS: BreakAttack[] = ['pay-stranger', 'overcharge', 'split', 'after-revoke'];
const limited = createLimiter(20, 60_000);

/** Pure computation on a fresh, throwaway mandate: no chain, no storage, nothing a visitor sends can move funds. */
export async function POST(req: NextRequest) {
  if (limited(clientIp(req))) return NextResponse.json({ error: 'Too many attempts, try again in a minute' }, { status: 429 });
  let body: { attack?: string; amountUsd?: number | string; recipient?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request' }, { status: 400 });
  }
  const attack = body.attack as BreakAttack;
  if (!ATTACKS.includes(attack)) return NextResponse.json({ error: 'Pick one of the attacks' }, { status: 400 });

  let amountBaseUnits: string | undefined;
  if (body.amountUsd !== undefined && body.amountUsd !== '') {
    const usd = Number(body.amountUsd);
    if (!Number.isFinite(usd) || usd <= 0 || usd > 1_000_000) return NextResponse.json({ error: 'Amount must be between $0.000001 and $1,000,000' }, { status: 400 });
    amountBaseUnits = String(Math.round(usd * 1_000_000));
    if (amountBaseUnits === '0') return NextResponse.json({ error: 'Amount is too small' }, { status: 400 });
  }

  let recipient: string | undefined;
  if (body.recipient) {
    try {
      recipient = new PublicKey(body.recipient.trim()).toBase58();
    } catch {
      return NextResponse.json({ error: 'Recipient must be a Solana address' }, { status: 400 });
    }
  }

  return NextResponse.json(await tryToBreak(attack, { amountBaseUnits, recipient }));
}
