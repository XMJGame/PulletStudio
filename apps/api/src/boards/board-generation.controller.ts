import { Body, Controller, Get, Headers, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { parse, StudioRequest } from '../common/http';
import { jsonSchema } from '../common/openapi';
import { BoardGenerationService, boardJobInput } from './board-generation.service';
const uuid = z.uuid();
@ApiTags('画布生成')
@ApiCookieAuth()
@Controller('api/v1/boards/:id/nodes/:nodeId/generation-jobs')
export class BoardGenerationController {
  constructor(private readonly generation: BoardGenerationService) {}
  @Get() jobs(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Param('nodeId') nodeId: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.generation.jobs(
      req.user,
      parse(uuid, id),
      parse(uuid, nodeId),
      cursor ? parse(uuid, cursor) : undefined,
    );
  }
  @Post()
  @ApiBody({ schema: jsonSchema(boardJobInput) })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  create(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Param('nodeId') nodeId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string,
  ) {
    return this.generation.create(
      req.user,
      parse(uuid, id),
      parse(uuid, nodeId),
      parse(boardJobInput, body),
      parse(uuid, key),
    );
  }
}
