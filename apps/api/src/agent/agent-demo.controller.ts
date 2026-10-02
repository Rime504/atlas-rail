import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { z } from 'zod';
import { AuthGuard, RequirePermission } from '../common/auth.guard';
import { AgentFacade } from './agent.facade';
import { AgentDemoService } from './agent-demo.service';

const runSchema = z.object({
  scenes: z.array(z.number().int().min(1).max(6)).max(6).optional(),
  autoApprove: z.boolean().optional(),
});

/**
 * Drives the scripted demo agent from the console ("Demo Lab") so a judge or investor can run every
 * scene from a browser with no terminal. See {@link AgentDemoService} for what this actually spawns.
 */
@ApiTags('Agent Mandates — Demo Lab')
@UseGuards(AuthGuard)
@Controller('v1/agent/demo')
export class AgentDemoController {
  constructor(
    private readonly demo: AgentDemoService,
    private readonly agent: AgentFacade,
  ) {}

  @Get('status')
  @RequirePermission('mandate:read')
  @ApiOperation({ summary: 'Whether demo mode is available on this server, a run is in progress, and an active demo mandate exists' })
  async status(@Req() req: any) {
    const records = await this.agent.store.mandates.list(req.user.organizationId);
    const now = this.agent.now();
    const hasActiveMandate = records.some(
      (r) => r.mandate.agent.label === 'Research Agent' && r.status === 'ACTIVE' && !r.revocation && r.mandate.expiresAt > now,
    );
    return { available: this.demo.isConfigured(), running: this.demo.isRunning(), hasActiveMandate };
  }

  /**
   * Runs the requested scenes (or all six) and streams every line of narration as it's produced.
   * Events: `line` ({ stream, text }), `scene` ({ number, title }) when a "SCENE N ..." banner is
   * seen, and `done` ({ exitCode, ok }) once the process exits. A run already in progress is
   * rejected with a plain `error` event rather than started twice.
   */
  @Post('run')
  @RequirePermission('mandate:create')
  @ApiOperation({ summary: 'Run one or more demo scenes on the server and stream narration (text/event-stream)' })
  async run(@Req() req: any, @Res() reply: FastifyReply, @Body() body: unknown) {
    const input = runSchema.parse(body ?? {});

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'access-control-allow-origin': '*',
    });
    const send = (event: string, data: unknown) => raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const heartbeat = setInterval(() => raw.write(': keep-alive\n\n'), 15_000);
    const controller = new AbortController();
    req.raw.on('close', () => controller.abort());

    const sceneBanner = /^SCENE\s+(\d+)\s+(\S+)/;
    try {
      const exitCode = await this.demo.run(
        { scenes: input.scenes, autoApprove: input.autoApprove },
        (stream, text) => {
          send('line', { stream, text });
          const match = sceneBanner.exec(text);
          if (match) send('scene', { number: Number(match[1]), title: match[2] });
        },
        controller.signal,
      );
      send('done', { exitCode, ok: exitCode === 0 });
    } catch (error) {
      send('error', { message: error instanceof Error ? error.message : String(error) });
    } finally {
      clearInterval(heartbeat);
      raw.end();
    }
  }
}
