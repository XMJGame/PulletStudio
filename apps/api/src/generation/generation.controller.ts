import { Body, Controller, Get, Headers, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { parse, StudioRequest } from '../common/http';
import {
  connectionInput,
  connectionUpdate,
  createJobInput,
  reconcileInput,
  workflowInput,
} from './generation-contract';
import { GenerationService } from './generation.service';

const uuid = z.uuid();
@ApiTags('媒体生成')
@ApiCookieAuth()
@Controller('api/v1')
export class GenerationController {
  constructor(private readonly generation: GenerationService) {}
  @Get('projects/:id/generation-config')
  config(@Req() req: StudioRequest, @Param('id') id: string) {
    return this.generation.config(req.user, parse(uuid, id));
  }
  @Get('projects/:id/generation-images')
  images(@Req() req: StudioRequest, @Param('id') id: string, @Query('cursor') cursor?: string) {
    return this.generation.images(
      req.user,
      parse(uuid, id),
      cursor === undefined ? undefined : parse(uuid, cursor),
    );
  }
  @Post('projects/:id/generation-connections')
  connection(@Req() req: StudioRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.generation.createConnection(req.user, parse(uuid, id), parse(connectionInput, body));
  }
  @Patch('generation-connections/:id')
  toggle(@Req() req: StudioRequest, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(connectionUpdate, body);
    return this.generation.updateConnection(req.user, parse(uuid, id), input.enabled, input.expectedVersion);
  }
  @Post('generation-connections/:id/test')
  test(@Req() req: StudioRequest, @Param('id') id: string) {
    return this.generation.testConnection(req.user, parse(uuid, id));
  }
  @Post('projects/:id/generation-workflows')
  workflow(@Req() req: StudioRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.generation.createWorkflow(req.user, parse(uuid, id), parse(workflowInput, body));
  }
  @Get('shots/:id/generation-jobs')
  jobs(@Req() req: StudioRequest, @Param('id') id: string) {
    return this.generation.jobs(req.user, parse(uuid, id));
  }
  @Post('shots/:id/generation-jobs')
  submit(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    return this.generation.createJob(
      req.user,
      parse(uuid, id),
      parse(createJobInput, body),
      parse(uuid, key),
    );
  }
  @Get('generation-jobs/:id')
  get(@Req() req: StudioRequest, @Param('id') id: string) {
    return this.generation.get(req.user, parse(uuid, id));
  }
  @Post('generation-jobs/:id/cancel')
  cancel(@Req() req: StudioRequest, @Param('id') id: string) {
    return this.generation.control(req.user, parse(uuid, id), 'cancel');
  }
  @Post('generation-jobs/:id/reconcile')
  reconcile(@Req() req: StudioRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.generation.control(
      req.user,
      parse(uuid, id),
      'reconcile',
      parse(reconcileInput, body).remoteId,
    );
  }
  @Post('generation-jobs/:id/stop')
  stop(@Req() req: StudioRequest, @Param('id') id: string) {
    return this.generation.control(req.user, parse(uuid, id), 'stop');
  }
}
