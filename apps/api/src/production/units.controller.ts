import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { parse, StudioRequest } from '../common/http';
import { jsonSchema } from '../common/openapi';
import { unitTypes } from '../db/schema';
import { ProductionService } from './production.service';
import { UnitsService } from './units.service';
import { shotInput } from './shot-input';

const uuid = z.uuid();
const fields = z
  .object({
    title: z.string().trim().min(1).max(200),
    parentId: uuid.nullable().optional(),
    orderIndex: z.number().int().min(0).max(100000).optional(),
    outline: z.string().max(20000).optional(),
    targetDurationSeconds: z.number().int().positive().max(28800).nullable().optional(),
  })
  .strict();
const createInput = fields.extend({ kind: z.enum(unitTypes) });
const updateInput = fields.partial().extend({ expectedVersion: z.number().int().positive() });
const createShot = shotInput.extend({ unitId: uuid.nullable().optional() });
const pageInput = z.object({
  cursor: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
});
@ApiTags('制作结构与项目镜头')
@ApiCookieAuth()
@Controller('api/v1')
export class UnitsController {
  constructor(
    private readonly units: UnitsService,
    private readonly production: ProductionService,
  ) {}
  @Get('projects/:projectId/units')
  list(@Req() req: StudioRequest, @Param('projectId') id: string, @Query() query: unknown) {
    const page = parse(pageInput, query);
    return this.units.list(req.user, parse(uuid, id), page.limit, page.cursor);
  }
  @Post('projects/:projectId/units')
  @ApiBody({ schema: jsonSchema(createInput) })
  create(@Req() req: StudioRequest, @Param('projectId') id: string, @Body() body: unknown) {
    return this.units.create(req.user, parse(uuid, id), parse(createInput, body));
  }
  @Get('units/:unitId')
  read(@Req() req: StudioRequest, @Param('unitId') id: string) {
    return this.units.read(req.user, parse(uuid, id));
  }
  @Patch('units/:unitId')
  @ApiBody({ schema: jsonSchema(updateInput) })
  update(@Req() req: StudioRequest, @Param('unitId') id: string, @Body() body: unknown) {
    return this.units.update(req.user, parse(uuid, id), parse(updateInput, body));
  }
  @Get('projects/:projectId/shots')
  shots(@Req() req: StudioRequest, @Param('projectId') id: string, @Query() query: unknown) {
    const input = parse(pageInput.extend({ unitId: uuid.optional() }), query);
    return this.units.shots(req.user, parse(uuid, id), input.unitId, input.limit, input.cursor);
  }
  @Post('projects/:projectId/shots')
  @ApiBody({ schema: jsonSchema(createShot) })
  createShot(@Req() req: StudioRequest, @Param('projectId') id: string, @Body() body: unknown) {
    return this.production.createProjectShot(req.user, parse(uuid, id), parse(createShot, body));
  }
}
