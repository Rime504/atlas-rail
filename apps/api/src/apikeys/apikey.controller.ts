import { Controller, Get, Post, Delete, Param, Body, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthGuard, RequirePermission } from '../common/auth.guard';
import { ApiKeyService } from './apikey.service';

@ApiTags('API Keys')
@UseGuards(AuthGuard)
@Controller('v1/api-keys')
export class ApiKeyController {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  @Get()
  @RequirePermission('apikey:manage')
  @ApiOperation({ summary: 'List active organization API keys' })
  async findAll(@Req() req: any) {
    return this.apiKeyService.findAll(req.user.organizationId);
  }

  @Post()
  @RequirePermission('apikey:manage')
  @ApiOperation({ summary: 'Generate new API key' })
  async create(@Req() req: any, @Body() body: { name: string; scopes?: string[] }) {
    return this.apiKeyService.create(req.user.organizationId, req.user.userId, body.name, body.scopes);
  }

  @Delete(':apiKeyId')
  @RequirePermission('apikey:manage')
  @ApiOperation({ summary: 'Revoke API key' })
  async revoke(@Req() req: any, @Param('apiKeyId') apiKeyId: string) {
    return this.apiKeyService.revoke(req.user.organizationId, apiKeyId);
  }
}
