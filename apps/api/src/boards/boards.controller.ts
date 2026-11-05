import { Body, Controller, Get, Headers, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { parse, StudioRequest } from '../common/http';
import { jsonSchema } from '../common/openapi';
import { BoardsService } from './boards.service';
import { BoardReferencesService } from './board-references.service';
import { boardReference, createBoardInput, saveBoardInput } from './board-contract';
const uuid = z.uuid(),
  number = z.coerce.number().int().positive();
@ApiCookieAuth()
@ApiTags('正式创作画布')
@Controller('api/v1')
export class BoardsController {
  constructor(
    private readonly boards: BoardsService,
    private readonly references: BoardReferencesService,
  ) {}
  @Get('projects/:id/boards') list(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Query('unitId') unitId?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.boards.list(
      req.user,
      parse(uuid, id),
      unitId === undefined ? undefined : parse(uuid, unitId),
      cursor === undefined ? undefined : parse(uuid, cursor),
    );
  }
  @Post('projects/:id/boards')
  @ApiBody({ schema: jsonSchema(createBoardInput) })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  create(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string,
  ) {
    const input = parse(createBoardInput, body);
    return this.boards.create(req.user, parse(uuid, id), input.title, input.unitId, parse(uuid, key));
  }
  @Get('boards/:id') read(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Query('revision') revision?: string,
  ) {
    return this.boards.read(
      req.user,
      parse(uuid, id),
      revision === undefined ? undefined : parse(number, revision),
    );
  }
  @Post('boards/:id/revisions')
  @ApiBody({ schema: jsonSchema(saveBoardInput) })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  save(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string,
  ) {
    return this.boards.save(req.user, parse(uuid, id), parse(saveBoardInput, body), parse(uuid, key));
  }
  @Get('boards/:id/revisions') history(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Query('before') before?: string,
  ) {
    return this.boards.history(
      req.user,
      parse(uuid, id),
      before === undefined ? undefined : parse(number, before),
    );
  }
  @Get('projects/:id/board-sources') sources(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    const input = parse(
      z
        .object({
          kind: z.enum(['shots', 'entities', 'media']),
          cursor: uuid.optional(),
          q: z.string().max(80).optional(),
        })
        .strict(),
      query,
    );
    return this.references.sources(req.user, parse(uuid, id), input.kind, input.cursor, input.q);
  }
  @Post('projects/:id/board-references/resolve') resolve(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const projectId = parse(uuid, id);
    const input = parse(
      z
        .object({ references: z.array(z.object({ nodeId: uuid, ref: boardReference }).strict()).max(100) })
        .strict(),
      body,
    );
    // Authorize even an empty request via the project source list boundary.
    return this.references.resolveMany(req.user, projectId, input.references);
  }
}
