import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { parse, StudioRequest } from '../common/http';
import { jsonSchema } from '../common/openapi';
import { AnalysisService } from './analysis.service';
const uuid = z.uuid();
const version = z.coerce.number().int().positive();
const submission = z
  .object({
    modelProfileId: uuid,
    revisionVersion: z.number().int().positive(),
    chunkIndex: z.number().int().min(0),
    contextSummary: z.string().trim().max(2000).default(''),
    expectedProjectVersion: z.number().int().positive(),
    acknowledgeExternalProcessing: z.literal(true),
  })
  .strict();
const transition = z
  .object({
    expectedVersion: z.number().int().positive(),
    acknowledgePossibleCharge: z.boolean().default(false),
  })
  .strict();
@ApiTags('AI 分镜分析')
@ApiCookieAuth()
@Controller('api/v1')
export class AnalysisController {
  constructor(private readonly analysis: AnalysisService) {}
  @Get('projects/:projectId/analysis-chunks') chunks(
    @Req() req: StudioRequest,
    @Param('projectId') id: string,
    @Query('revisionVersion') value: string,
  ) {
    return this.analysis.chunks(req.user, parse(uuid, id), parse(version, value));
  }
  @Get('workspaces/:workspaceId/analysis-status') status(
    @Req() req: StudioRequest,
    @Param('workspaceId') id: string,
  ) {
    return this.analysis.status(req.user, parse(uuid, id));
  }
  @Get('projects/:projectId/analysis-runs') list(
    @Req() req: StudioRequest,
    @Param('projectId') id: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.analysis.list(
      req.user,
      parse(uuid, id),
      cursor === undefined ? undefined : parse(uuid, cursor),
    );
  }
  @Post('projects/:projectId/analysis-runs')
  @ApiBody({ schema: jsonSchema(submission) })
  submit(@Req() req: StudioRequest, @Param('projectId') id: string, @Body() body: unknown) {
    return this.analysis.submit(
      req.user,
      parse(uuid, id),
      parse(z.uuid(), req.headers['idempotency-key']),
      parse(submission, body),
    );
  }
  @Get('analysis-runs/:runId') read(@Req() req: StudioRequest, @Param('runId') id: string) {
    return this.analysis.read(req.user, parse(uuid, id));
  }
  @Post('analysis-runs/:runId/cancel')
  @ApiBody({ schema: jsonSchema(transition) })
  cancel(@Req() req: StudioRequest, @Param('runId') id: string, @Body() body: unknown) {
    const input = parse(transition, body);
    return this.analysis.transition(req.user, parse(uuid, id), input.expectedVersion, false);
  }
  @Post('analysis-runs/:runId/retry')
  @ApiBody({ schema: jsonSchema(transition) })
  retry(@Req() req: StudioRequest, @Param('runId') id: string, @Body() body: unknown) {
    const input = parse(transition, body);
    return this.analysis.transition(
      req.user,
      parse(uuid, id),
      input.expectedVersion,
      true,
      input.acknowledgePossibleCharge,
    );
  }
}
