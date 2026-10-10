import { NextRequest, NextResponse } from 'next/server';
import { proveBlockedAttempt, provePayment } from '@atlas-rail/receipt';
import { Web3ChainClient, fetchMandateAccount, findMandatePda } from '@atlas-rail/solana';
import { clientIp, createLimiter } from '@/lib/rate-limit';
import { loadPublished } from '@/lib/receipt-store';
import { isFinal } from '@/lib/verify-cache';

export const runtime = 'nodejs';

const RPC_URL = process.env.PLAYGROUND_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
const PROGRAM_ID = process.env.MANDATE_PROGRAM_ID ?? 'CnGoTE5Bxc8MFGaeK5LDv5uAZ7pNiktMunYy8JZcLY4k';
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const limited = createLimiter(20, 60_000);

// A verdict about a past transaction never changes (the memo, the published receipt and the anchor
// are all immutable; "revoked at payment time" is fixed once the payment has landed), so final
// answers are cached at the edge and repeat checks of the same payment cost no RPC calls at all.
const FINAL = { headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800' } };

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

const isRateLimit =(err: unknown) => /429|Too Many Requests/i.test(err instanceof Error ? err.message : String(err));

async function withOneRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isRateLimit(err)) throw err;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return fn();
  }
}

/** Server side of /verify: a handful of public devnet reads plus one store read per request, so the
 * page works on any phone without the visitor needing an RPC endpoint of their own. */
export async function GET(req: NextRequest) {
  if (limited(clientIp(req))) return NextResponse.json({ error: 'Too many checks, try again in a minute' }, { status: 429 });
  const tx = req.nextUrl.searchParams.get('tx')?.trim();
  const decision = req.nextUrl.searchParams.get('decision')?.trim();

  try {
    if (decision) {
      const record = await loadPublished('decision', decision);
      if (!record) return NextResponse.json({ kind: 'decision', verdict: 'NOT_FOUND', reason: `No published decision record with id ${decision}.` });
      return NextResponse.json({ kind: 'decision', ...proveBlockedAttempt(record) }, FINAL);
    }
    if (!tx || !SIGNATURE.test(tx)) {
      return NextResponse.json({ error: 'Paste a Solana devnet transaction signature (base58, about 88 characters).' }, { status: 400 });
    }
    const chain = Web3ChainClient.fromUrl(RPC_URL);
    let receiptMissing = false;
    const proof = await withOneRetry(() => provePayment(tx, {
      chain,
      loadReceipt: async (id) => {
        const record = await loadPublished('receipt', id);
        receiptMissing = record === null;
        return record;
      },
      loadMandateState: async (hashHex) => {
        const account = await fetchMandateAccount(RPC_URL, findMandatePda(PROGRAM_ID, Buffer.from(hashHex, 'hex')).address).catch(() => null);
        return account ? { revoked: account.revoked, revokedAt: Number(account.revokedAt) } : null;
      },
      programId: PROGRAM_ID,
    }));
    return NextResponse.json({ kind: 'payment', ...proof }, isFinal(proof.verdict, receiptMissing) ? FINAL : NO_STORE);
  } catch (err) {
    const message = isRateLimit(err)
      ? 'Solana devnet’s public RPC is rate-limiting requests right now. Wait a few seconds and try again.'
      : `Could not complete the check: ${err instanceof Error ? err.message : String(err)}`;
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
