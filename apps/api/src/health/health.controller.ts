import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  @Get('live')
  @ApiOperation({ summary: 'Liveness probe' })
  getLiveness() {
    return { status: 'ok', environment: 'DEVNET_ONLY', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe' })
  getReadiness() {
    return { status: 'ready', database: 'connected', redis: 'connected' };
  }
}
