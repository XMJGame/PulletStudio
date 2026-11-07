import { Body, Controller, Get, Headers, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { parse, StudioRequest } from '../common/http';
import {
  connectionInput,
  connectionUpdate,
  createJobInput,
  createProjectJobInput,
  reconcileInput,
  workflowInput,
} from './generation-contract';
import { GenerationService } from './generation.service';
import { randomUUID } from 'node:crypto';

const uuid = z.uuid();
@ApiTags('媒体生成')
@ApiCookieAuth()
@Controller('api/v1')
export class GenerationController {
  constructor(private readonly generation: GenerationService) {}
  @Get('workspaces/:id/modelscope-generation')
  modelScopeStatus(@Req() req: StudioRequest, @Param('id') id: string) {
    return this.generation.modelScopeStatus(req.user, parse(uuid, id));
  }
  @Post('workspaces/:id/modelscope-generation')
  configureModelScope(@Req() req: StudioRequest, @Param('id') id: string, @Body() body: unknown) {
    const { token } = parse(z.object({ token: z.string().regex(/^[\x21-\x7e]{1,8192}$/u) }).strict(), body);
    return this.generation.configureModelScope(req.user, parse(uuid, id), token);
  }
  @Post('projects/:id/modelscope-generation')
  projectModelScope(@Req() req: StudioRequest, @Param('id') id: string) {
    return this.generation.projectModelScope(req.user, parse(uuid, id));
  }
  @Get('projects/:id/generation-config')
  config(@Req() req: StudioRequest, @Param('id') id: string, @Query('workflowId') workflowId?: string) {
    return this.generation.config(
      req.user,
      parse(uuid, id),
      workflowId === undefined ? undefined : parse(uuid, workflowId),
    );
  }
  @Get('projects/:id/generation-jobs')
  projectJobs(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Query('boardId') boardId?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.generation.projectJobs(
      req.user,
      parse(uuid, id),
      boardId === undefined ? undefined : parse(uuid, boardId),
      cursor === undefined ? undefined : parse(uuid, cursor),
    );
  }
  @Post('projects/:id/generation-jobs')
  projectSubmit(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    return this.generation.createProjectJob(
      req.user,
      parse(uuid, id),
      parse(createProjectJobInput, body),
      parse(uuid, key),
    );
  }
  @Post('projects/:id/workflow-trials')
  projectTrial(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    return this.generation.createProjectJob(
      req.user,
      parse(uuid, id),
      parse(createProjectJobInput.omit({ routing: true, boardId: true }), body),
      parse(uuid, key),
      'workflow_test',
    );
  }
  @Post('generation-jobs/:id/save-to-library')
  saveCandidate(@Req() req: StudioRequest, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(z.object({ outputId: uuid.optional() }).strict(), body ?? {});
    return this.generation.saveCandidate(req.user, parse(uuid, id), input.outputId);
  }
  @Get(['projects/:id/generation-images', 'projects/:id/generation-reference-media'])
  images(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('type') type?: string,
  ) {
    return this.generation.images(
      req.user,
      parse(uuid, id),
      cursor === undefined ? undefined : parse(uuid, cursor),
      type === undefined ? undefined : parse(z.enum(['image', 'video', 'audio']), type),
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
  workflow(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.generation.createWorkflow(
      req.user,
      parse(uuid, id),
      parse(workflowInput, body),
      key ? parse(uuid, key) : randomUUID(),
    );
  }
  @Get('shots/:id/generation-jobs')
  jobs(@Req() req: StudioRequest, @Param('id') id: string) {
    return this.generation.jobs(req.user, parse(uuid, id));
  }
  @Get('generation-workflows/:id/routing-options')
  routingOptions(@Req() req: StudioRequest, @Param('id') id: string, @Query('context') context?: string) {
    return this.generation.routingOptions(req.user, parse(uuid, id), context === 'exploration');
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
