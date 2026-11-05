import { Body, Controller, Get, Headers, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { parse, StudioRequest } from '../common/http';
import { jsonSchema } from '../common/openapi';
import { workflowInput } from './generation-contract';
import { WorkflowCatalogService } from './workflow-catalog.service';
const uuid = z.uuid(),
  positive = z.coerce.number().int().positive();
const base = { expectedVersion: z.number().int().positive(), summary: z.string().trim().min(1).max(1000) };
const revise = z.object({ ...base, definition: workflowInput }).strict(),
  restore = z.object({ ...base, workflowId: uuid }).strict();
const archive = z.object({ expectedVersion: z.number().int().positive(), archived: z.boolean() }).strict();
@ApiTags('工作流中心修订与依赖')
@ApiCookieAuth()
@Controller('api/v1')
export class WorkflowCatalogController {
  constructor(private readonly catalog: WorkflowCatalogService) {}
  @Get('workflow-catalogs/:id/definition') current(@Req() req: StudioRequest, @Param('id') id: string) {
    return this.catalog.current(req.user, parse(uuid, id));
  }
  @Get('generation-workflows/:id/definition') read(@Req() req: StudioRequest, @Param('id') id: string) {
    return this.catalog.read(req.user, parse(uuid, id));
  }
  @Get('workflow-catalogs/:id/revisions') history(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Query('before') before?: string,
  ) {
    return this.catalog.history(req.user, parse(uuid, id), before ? parse(positive, before) : undefined);
  }
  @Post('workflow-catalogs/:id/revisions')
  @ApiBody({ schema: jsonSchema(revise) })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  save(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string,
  ) {
    return this.catalog.save(req.user, parse(uuid, id), parse(revise, body), parse(uuid, key));
  }
  @Post('workflow-catalogs/:id/restore')
  @ApiBody({ schema: jsonSchema(restore) })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  restore(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string,
  ) {
    return this.catalog.restore(req.user, parse(uuid, id), parse(restore, body), parse(uuid, key));
  }
  @Patch('workflow-catalogs/:id')
  @ApiBody({ schema: jsonSchema(archive) })
  archive(@Req() req: StudioRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.catalog.archive(req.user, parse(uuid, id), parse(archive, body));
  }
  @Post('generation-workflows/:id/inspection') inspect(@Req() req: StudioRequest, @Param('id') id: string) {
    return this.catalog.inspect(req.user, parse(uuid, id));
  }
}
