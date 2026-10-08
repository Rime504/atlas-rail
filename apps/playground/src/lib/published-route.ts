import { NextRequest, NextResponse } from 'next/server';
import { createLimiter, clientIp } from './rate-limit';
import { loadPublished, storeConfigured } from './receipt-store';

const limited = createLimiter(60, 60_000);

/** Shared GET handler for /api/receipts/:id and /api/decisions/:id. Published records never change,
 * so a hit is cached at the edge for a year and repeat reads cost no Blob operations. */
export async function servePublished(req: NextRequest, kind: 'receipt' | 'decision', id: string): Promise<NextResponse> {
  if (limited(clientIp(req))) return NextResponse.json({ error: 'Too many requests, try again in a minute' }, { status: 429 });
  if (!storeConfigured()) return NextResponse.json({ error: 'Public receipt store is not configured on this deployment' }, { status: 503 });
  const record = await loadPublished(kind, id);
  if (!record) {
    return NextResponse.json({ error: `No published ${kind} with id ${id}` }, { status: 404, headers: { 'Cache-Control': 'public, s-maxage=60' } });
  }
  return NextResponse.json(record, {
    headers: { 'Cache-Control': 'public, max-age=300, s-maxage=31536000, immutable', 'Access-Control-Allow-Origin': '*' },
  });
}
