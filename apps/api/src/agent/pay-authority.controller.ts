import { Body, Controller, Get, Headers, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { timingSafeEqual } from 'node:crypto';
import { decisionReceipts, defaultPayAuthority } from './pay-authority.wiring';

function tokenOk(header: string | undefined, token: string | undefined): boolean {
  if (!token) return true;
  const presented = Buffer.from(header?.startsWith('Bearer ') ? header.slice(7) : '', 'utf8');
  const expected = Buffer.from(token, 'utf8');
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

/**
 * pay.sh spending authority. pay's HTTP provider (PR #525) sends no credentials, so the endpoint
 * should only be reachable by the pay host. ATLAS_PAY_AUTHORITY_TOKEN, when set, is required as a
 * bearer token for hosts whose provider can send one. Always 200 with a verdict: pay reads a non-2xx
 * as unavailable, which is still a refusal.
 */
@ApiTags('pay.sh spending authority')
@Controller('v1/pay-authority')
export class PayAuthorityController {
  @Post('authorize')
  @HttpCode(200)
  @ApiOperation({ summary: 'Allow, deny, or ask the owner about one pay.sh payment. Every decision gets a receipt.' })
  async authorize(@Body() body: unknown, @Headers('authorization') authorization?: string) {
    if (!tokenOk(authorization, process.env.ATLAS_PAY_AUTHORITY_TOKEN)) {
      return { decision: 'deny', unavailable: false, reason: 'Missing or wrong bearer token.' };
    }
    return defaultPayAuthority().authorize(body);
  }

  @Get('receipts/:id')
  @ApiOperation({ summary: 'A decision receipt, for anyone to verify against Solana' })
  async receipt(@Param('id') id: string) {
    const receipt = await decisionReceipts().get(id);
    if (!receipt) throw new NotFoundException('No decision receipt with that id');
    return receipt;
  }
}
