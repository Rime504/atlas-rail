import { Controller, Get, Post, Patch, Param, Body, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthGuard, RequirePermission } from '../common/auth.guard';
import { TreasuryService } from './treasury.service';

@ApiTags('Treasuries')
@UseGuards(AuthGuard)
@Controller('v1/treasuries')
export class TreasuryController {
  constructor(private readonly treasuryService: TreasuryService) {}

  @Get()
  @RequirePermission('treasury:read')
  @ApiOperation({ summary: 'List organization treasuries' })
  async findAll(@Req() req: any) {
    return this.treasuryService.findAll(req.user.organizationId);
  }

  @Post()
  @RequirePermission('treasury:write')
  @ApiOperation({ summary: 'Create new devnet treasury' })
  async create(
    @Req() req: any,
    @Body() body: { name: string; slug: string; mintAddress: string; settlementWalletAddress: string },
  ) {
    return this.treasuryService.create(req.user.organizationId, body);
  }

  @Get(':treasuryId')
  @RequirePermission('treasury:read')
  @ApiOperation({ summary: 'Get treasury details' })
  async findOne(@Req() req: any, @Param('treasuryId') treasuryId: string) {
    return this.treasuryService.findOne(req.user.organizationId, treasuryId);
  }

  @Post(':treasuryId/freeze')
  @RequirePermission('treasury:freeze')
  @ApiOperation({ summary: 'Freeze treasury' })
  async freeze(@Req() req: any, @Param('treasuryId') treasuryId: string) {
    return this.treasuryService.setFreezeStatus(req.user.organizationId, treasuryId, true);
  }

  @Post(':treasuryId/unfreeze')
  @RequirePermission('treasury:freeze')
  @ApiOperation({ summary: 'Unfreeze treasury' })
  async unfreeze(@Req() req: any, @Param('treasuryId') treasuryId: string) {
    return this.treasuryService.setFreezeStatus(req.user.organizationId, treasuryId, false);
  }

  @Get(':treasuryId/balance')
  @RequirePermission('treasury:read')
  @ApiOperation({ summary: 'Get devnet treasury token balance' })
  async getBalance(@Req() req: any, @Param('treasuryId') treasuryId: string) {
    return this.treasuryService.getBalance(req.user.organizationId, treasuryId);
  }
}
