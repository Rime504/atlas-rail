import { Controller, Get, Post, Patch, Param, Body, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthGuard, RequirePermission } from '../common/auth.guard';
import { RecipientService } from './recipient.service';
import { RecipientStatus, RecipientType } from '@atlas-rail/database';

@ApiTags('Recipients')
@UseGuards(AuthGuard)
@Controller('v1/recipients')
export class RecipientController {
  constructor(private readonly recipientService: RecipientService) {}

  @Get()
  @RequirePermission('recipient:read')
  @ApiOperation({ summary: 'List recipients' })
  async findAll(@Req() req: any) {
    return this.recipientService.findAll(req.user.organizationId);
  }

  @Post()
  @RequirePermission('recipient:write')
  @ApiOperation({ summary: 'Create new recipient' })
  async create(
    @Req() req: any,
    @Body()
    body: {
      displayName: string;
      recipientType: RecipientType;
      walletAddress: string;
      expectedMintAddress: string;
      countryCode?: string;
      email?: string;
      referenceCode?: string;
      verificationNotes?: string;
    },
  ) {
    return this.recipientService.create(req.user.organizationId, body);
  }

  @Get(':recipientId')
  @RequirePermission('recipient:read')
  @ApiOperation({ summary: 'Get recipient details' })
  async findOne(@Req() req: any, @Param('recipientId') recipientId: string) {
    return this.recipientService.findOne(req.user.organizationId, recipientId);
  }

  @Post(':recipientId/verify')
  @RequirePermission('recipient:verify')
  @ApiOperation({ summary: 'Verify recipient' })
  async verify(@Req() req: any, @Param('recipientId') recipientId: string, @Body() body: { notes?: string }) {
    return this.recipientService.setStatus(req.user.organizationId, recipientId, RecipientStatus.VERIFIED, body.notes);
  }

  @Post(':recipientId/block')
  @RequirePermission('recipient:block')
  @ApiOperation({ summary: 'Block recipient' })
  async block(@Req() req: any, @Param('recipientId') recipientId: string, @Body() body: { notes?: string }) {
    return this.recipientService.setStatus(req.user.organizationId, recipientId, RecipientStatus.BLOCKED, body.notes);
  }

  @Post(':recipientId/archive')
  @RequirePermission('recipient:write')
  @ApiOperation({ summary: 'Archive recipient' })
  async archive(@Req() req: any, @Param('recipientId') recipientId: string) {
    return this.recipientService.setStatus(req.user.organizationId, recipientId, RecipientStatus.ARCHIVED);
  }
}
