import { Controller, Get, Post, Param, Body, Req, UseGuards, UseInterceptors, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthGuard, RequirePermission } from '../common/auth.guard';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { PayoutService } from './payout.service';

@ApiTags('Payouts')
@UseGuards(AuthGuard)
@Controller('v1/payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Get()
  @RequirePermission('payout:read')
  @ApiOperation({ summary: 'List payouts' })
  async findAll(@Req() req: any) {
    return this.payoutService.findAll(req.user.organizationId);
  }

  @Post()
  @UseInterceptors(IdempotencyInterceptor)
  @RequirePermission('payout:create')
  @ApiOperation({ summary: 'Create new payout request (requires Idempotency-Key header)' })
  async create(
    @Req() req: any,
    @Headers('idempotency-key') idempotencyKeyHeader: string,
    @Body()
    body: {
      treasuryId: string;
      recipientId: string;
      amountBaseUnits: string;
      externalReference?: string;
      invoiceReference?: string;
      memo?: string;
    },
  ) {
    return this.payoutService.create(req.user.organizationId, req.user.userId, idempotencyKeyHeader, body);
  }

  @Get(':payoutId')
  @RequirePermission('payout:read')
  @ApiOperation({ summary: 'Get payout details' })
  async findOne(@Req() req: any, @Param('payoutId') payoutId: string) {
    return this.payoutService.findOne(req.user.organizationId, payoutId);
  }

  @Post(':payoutId/approve')
  @RequirePermission('payout:approve')
  @ApiOperation({ summary: 'Approve payout request' })
  async approve(@Req() req: any, @Param('payoutId') payoutId: string, @Body() body: { comment?: string }) {
    return this.payoutService.approve(req.user.organizationId, req.user.userId, payoutId, body.comment);
  }

  @Post(':payoutId/reject')
  @RequirePermission('payout:reject')
  @ApiOperation({ summary: 'Reject payout request' })
  async reject(@Req() req: any, @Param('payoutId') payoutId: string, @Body() body: { comment?: string }) {
    return this.payoutService.reject(req.user.organizationId, req.user.userId, payoutId, body.comment);
  }

  @Post(':payoutId/queue-execution')
  @RequirePermission('payout:execute')
  @ApiOperation({ summary: 'Queue approved payout for execution' })
  async queueExecution(@Req() req: any, @Param('payoutId') payoutId: string) {
    return this.payoutService.queueExecution(req.user.organizationId, req.user.userId, payoutId);
  }

  @Get(':payoutId/audit')
  @RequirePermission('payout:read')
  @ApiOperation({ summary: 'Get immutable audit timeline for payout' })
  async getAudit(@Req() req: any, @Param('payoutId') payoutId: string) {
    return this.payoutService.getAudit(req.user.organizationId, payoutId);
  }
}
