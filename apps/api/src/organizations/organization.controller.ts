import { Controller, Get, Patch, Body, Req, UseGuards, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthGuard, RequirePermission } from '../common/auth.guard';
import { prisma } from '@atlas-rail/database';

@ApiTags('Organizations')
@UseGuards(AuthGuard)
@Controller('v1/organizations')
export class OrganizationController {
  @Get('current')
  @RequirePermission('organization:read')
  @ApiOperation({ summary: 'Get current tenant organization' })
  async getCurrent(@Req() req: any) {
    const org = await prisma.organization.findUnique({
      where: { id: req.user.organizationId },
    });
    if (!org) throw new NotFoundException('Organization not found.');
    return org;
  }

  @Patch('current')
  @RequirePermission('organization:write')
  @ApiOperation({ summary: 'Update organization details' })
  async updateCurrent(@Req() req: any, @Body() body: { name?: string }) {
    return prisma.organization.update({
      where: { id: req.user.organizationId },
      data: { name: body.name },
    });
  }
}
