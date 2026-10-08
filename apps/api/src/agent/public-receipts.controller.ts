import { BadRequestException, Body, Controller, Get, HttpException, HttpStatus, NotFoundException, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { prisma } from '@atlas-rail/database';
import { publishPublicReceipt } from './public-receipts.service';

const publishSchema = z.object({
  receipt: z.unknown(),
  source: z.enum(['demo-agent', 'playground']),
});

const PUBLISH_LIMIT_PER_HOUR = 60;
const publishCounts = new Map<string, { count: number; windowStart: number }>();

/** Per-IP, in-memory, one-hour sliding-ish window — this process is long-lived (unlike the
 * playground's serverless functions), so a Map survives between requests. Generous: a real visitor
 * walking through the playground or demo issues at most a handful of receipts per run. */
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = publishCounts.get(ip);
  if (!entry || now - entry.windowStart > 3_600_000) {
    publishCounts.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > PUBLISH_LIMIT_PER_HOUR;
}

/**
 * N2's public receipt store (see public-receipts.service.ts). Deliberately unauthenticated — the
 * whole point is that anyone, with no account, can look a receipt up by the id its payment's memo
 * names. Never exposes anything beyond what `document` itself already discloses (a devnet-only,
 * already-on-chain payment record) and never trusts a submission further than verifyReceipt does.
 */
@ApiTags('Public receipts (unauthenticated)')
@Controller('v1/public/receipts')
export class PublicReceiptsController {
  @Post()
  @ApiOperation({ summary: 'Publish a receipt to the public store, where anyone can fetch it by id (verified before being accepted)' })
  async publish(@Req() req: any, @Body() body: unknown) {
    const ip = req.ip ?? 'unknown';
    if (rateLimited(ip)) throw new HttpException('Publish rate limit reached — try again later', HttpStatus.TOO_MANY_REQUESTS);
    const parsed = publishSchema.parse(body);
    const result = await publishPublicReceipt(parsed.receipt, parsed.source);
    if (!result.accepted) throw new BadRequestException(result.reason ?? 'Receipt was not accepted');
    return { ok: true };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch a published receipt by id — 404 if nothing with this id has been published' })
  async get(@Param('id') id: string) {
    const row = await prisma.publicReceipt.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('No public receipt with this id');
    return { document: row.document, source: row.source, createdAt: row.createdAt };
  }
}
