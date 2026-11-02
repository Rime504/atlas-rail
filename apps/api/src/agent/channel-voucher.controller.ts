import { Body, Controller, Headers, HttpException, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodError } from 'zod';
import { askChannelVoucher, voucherTokenProblem } from './channel-voucher';

/** The voucher ask. A bearer token (ATLAS_VOUCHER_TOKEN) is the credential, and a down signer returns nothing. */
@ApiTags('Channel voucher')
@Controller('v1')
export class ChannelVoucherController {
  @Post('channel-voucher')
  @ApiOperation({ summary: 'Evaluate a channel voucher and return a signer signature only when the gate allows it' })
  async ask(@Body() body: unknown, @Headers('authorization') authorization?: string) {
    const problem = voucherTokenProblem(authorization);
    if (problem) throw new HttpException({ error: problem.error }, problem.status);
    try {
      return await askChannelVoucher(body);
    } catch (error) {
      if (error instanceof ZodError) throw new HttpException({ error: 'Invalid voucher request' }, 400);
      const message = error instanceof Error ? error.message : 'Voucher request failed';
      const down = /down|unavailable|fetch failed|ECONNREFUSED/i.test(message);
      throw new HttpException({ error: message }, down ? 503 : 400);
    }
  }
}
