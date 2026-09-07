import { Controller, Get, Post, Delete, Param, Body, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthGuard, RequirePermission } from '../common/auth.guard';
import { WebhookService } from './webhook.service';

@ApiTags('Webhooks')
@UseGuards(AuthGuard)
@Controller('v1/webhooks')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  @Get()
  @RequirePermission('webhook:manage')
  @ApiOperation({ summary: 'List webhook endpoints' })
  async findAll(@Req() req: any) {
    return this.webhookService.findAll(req.user.organizationId);
  }

  @Post()
  @RequirePermission('webhook:manage')
  @ApiOperation({ summary: 'Create webhook endpoint' })
  async create(@Req() req: any, @Body() body: { url: string; eventTypes: string[] }) {
    return this.webhookService.create(req.user.organizationId, body.url, body.eventTypes || ['payout.*']);
  }

  @Delete(':webhookEndpointId')
  @RequirePermission('webhook:manage')
  @ApiOperation({ summary: 'Delete webhook endpoint' })
  async delete(@Req() req: any, @Param('webhookEndpointId') id: string) {
    return this.webhookService.delete(req.user.organizationId, id);
  }

  @Post(':webhookEndpointId/test')
  @RequirePermission('webhook:manage')
  @ApiOperation({ summary: 'Send test signed webhook delivery' })
  async testDelivery(@Req() req: any, @Param('webhookEndpointId') id: string) {
    return this.webhookService.testDelivery(req.user.organizationId, id);
  }

  @Get(':webhookEndpointId/deliveries')
  @RequirePermission('webhook:manage')
  @ApiOperation({ summary: 'Get webhook delivery history' })
  async getDeliveries(@Req() req: any, @Param('webhookEndpointId') id: string) {
    return this.webhookService.getDeliveries(req.user.organizationId, id);
  }
}
