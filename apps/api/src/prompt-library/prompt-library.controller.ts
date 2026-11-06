import { Body, Controller, Get, Headers, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { parse, StudioRequest } from '../common/http';
import { jsonSchema } from '../common/openapi';
import { promptLibraryBody, promptLibraryQuery, revisePromptLibrary } from './prompt-library.contract';
import { PromptLibraryService } from './prompt-library.service';
const uuid = z.uuid(),
  number = z.coerce.number().int().positive();
@ApiTags('项目提示词库')
@ApiCookieAuth()
@Controller('api/v1')
export class PromptLibraryController {
  constructor(private readonly library: PromptLibraryService) {}
  @Get('projects/:id/prompt-library') list(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    return this.library.list(req.user, parse(uuid, id), parse(promptLibraryQuery, query));
  }
  @Post('projects/:id/prompt-library')
  @ApiBody({ schema: jsonSchema(promptLibraryBody) })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  create(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string,
  ) {
    return this.library.save(
      req.user,
      parse(uuid, id),
      null,
      parse(promptLibraryBody, body),
      parse(uuid, key),
    );
  }
  @Get('prompt-library/:id') read(@Req() req: StudioRequest, @Param('id') id: string) {
    return this.library.read(req.user, parse(uuid, id));
  }
  @Get('prompt-library/:id/revisions') history(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Query('before') before?: string,
  ) {
    return this.library.history(
      req.user,
      parse(uuid, id),
      before === undefined ? undefined : parse(number, before),
    );
  }
  @Get('prompt-library/:id/revisions/:version') version(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Param('version') version: string,
  ) {
    return this.library.read(req.user, parse(uuid, id), parse(number, version));
  }
  @Get('prompt-library-revisions/:id') revision(@Req() req: StudioRequest, @Param('id') id: string) {
    return this.library.readRevision(req.user, parse(uuid, id));
  }
  @Post('prompt-library/:id/revisions')
  @ApiBody({ schema: jsonSchema(revisePromptLibrary) })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  revise(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string,
  ) {
    const { expectedVersion, ...input } = parse(revisePromptLibrary, body);
    return this.library.save(req.user, null, parse(uuid, id), input, parse(uuid, key), expectedVersion);
  }
}
