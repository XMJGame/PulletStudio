import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { parse, StudioRequest } from '../common/http';
import { jsonSchema } from '../common/openapi';
import { GenerationInstancesService } from './generation-instances.service';

const uuid = z.uuid();
const poolSettings = z
  .object({
    expectedPoolVersion: z.number().int().positive(),
    poolEnabled: z.boolean(),
    maxRunning: z.number().int().min(1).max(16),
    maxPending: z.number().int().min(1).max(64),
  })
  .strict();

@ApiTags('ComfyUI 实例池')
@ApiCookieAuth()
@Controller('api/v1')
export class GenerationInstancesController {
  constructor(private readonly instances: GenerationInstancesService) {}

  @Patch('generation-connections/:id/pool')
  @ApiBody({ schema: jsonSchema(poolSettings) })
  configure(@Req() req: StudioRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.instances.configure(req.user, parse(uuid, id), parse(poolSettings, body));
  }

  @Get('generation-workflows/:id/instance-checks')
  list(@Req() req: StudioRequest, @Param('id') id: string) {
    return this.instances.list(req.user, parse(uuid, id));
  }

  @Post('generation-workflows/:id/instance-checks/:connectionId')
  check(@Req() req: StudioRequest, @Param('id') id: string, @Param('connectionId') connectionId: string) {
    return this.instances.check(req.user, parse(uuid, id), parse(uuid, connectionId));
  }
}
