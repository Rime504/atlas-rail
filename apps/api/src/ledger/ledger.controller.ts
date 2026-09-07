import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { AuthGuard, RequirePermission } from '../common/auth.guard';
import { LedgerService } from './ledger.service';

@ApiTags('Ledger & Reconciliation')
@UseGuards(AuthGuard)
@Controller('v1')
export class LedgerController {
  constructor(private readonly ledgerService: LedgerService) {}

  @Get('ledger')
  @RequirePermission('ledger:read')
  @ApiOperation({ summary: 'Get append-only financial ledger entries' })
  async getLedger(@Req() req: any) {
    return this.ledgerService.getLedgerEntries(req.user.organizationId);
  }

  @Get('reconciliation/summary')
  @RequirePermission('ledger:read')
  @ApiOperation({ summary: 'Get reconciliation volume summary' })
  async getSummary(@Req() req: any) {
    return this.ledgerService.getReconciliationSummary(req.user.organizationId);
  }

  @Get('reconciliation/export.csv')
  @RequirePermission('reconciliation:export')
  @ApiOperation({ summary: 'Export reconciliation ledger as CSV' })
  async exportCsv(@Req() req: any, @Res() res: FastifyReply) {
    const csv = await this.ledgerService.exportReconciliationCsv(req.user.organizationId, req.user.userId);
    res
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="atlas_rail_reconciliation_${Date.now()}.csv"`)
      .send(csv);
  }
}
