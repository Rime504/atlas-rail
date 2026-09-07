import { Controller, Get, Post, Param, Body, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthGuard, RequirePermission } from '../common/auth.guard';
import { PolicyService } from './policy.service';

@ApiTags('Policies')
@UseGuards(AuthGuard)
@Controller('v1')
export class PolicyController {
  constructor(private readonly policyService: PolicyService) {}

  @Get('treasuries/:treasuryId/policies')
  @RequirePermission('policy:read')
  @ApiOperation({ summary: 'List treasury policies' })
  async findByTreasury(@Req() req: any, @Param('treasuryId') treasuryId: string) {
    return this.policyService.findByTreasury(req.user.organizationId, treasuryId);
  }

  @Post('treasuries/:treasuryId/policies')
  @RequirePermission('policy:write')
  @ApiOperation({ summary: 'Draft new policy for treasury' })
  async create(
    @Req() req: any,
    @Param('treasuryId') treasuryId: string,
    @Body() body: { name: string; rules: any },
  ) {
    return this.policyService.create(req.user.organizationId, treasuryId, req.user.userId, body.name, body.rules);
  }

  @Get('policies/:policyId')
  @RequirePermission('policy:read')
  @ApiOperation({ summary: 'Get policy details' })
  async findOne(@Req() req: any, @Param('policyId') policyId: string) {
    return this.policyService.findOne(req.user.organizationId, policyId);
  }

  @Post('policies/:policyId/activate')
  @RequirePermission('policy:activate')
  @ApiOperation({ summary: 'Activate draft policy' })
  async activate(@Req() req: any, @Param('policyId') policyId: string) {
    return this.policyService.activate(req.user.organizationId, policyId);
  }

  @Post('policies/evaluate')
  @RequirePermission('policy:read')
  @ApiOperation({ summary: 'Preview policy evaluation for hypothetical payout' })
  async evaluate(@Req() req: any, @Body() body: any) {
    return this.policyService.evaluateRequest(req.user.organizationId, body);
  }
}
