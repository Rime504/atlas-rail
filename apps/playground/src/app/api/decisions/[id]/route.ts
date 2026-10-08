import { NextRequest } from 'next/server';
import { servePublished } from '@/lib/published-route';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return servePublished(req, 'decision', (await params).id);
}
