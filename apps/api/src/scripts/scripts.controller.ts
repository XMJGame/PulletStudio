import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Response } from 'express';
import { ApiBody, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { parse, StudioRequest } from '../common/http';
import { jsonSchema } from '../common/openapi';
import { ScriptsService } from './scripts.service';

const uuid = z.uuid();
const version = z.coerce.number().int().positive();
const scriptInput = z
  .object({
    expectedVersion: z.number().int().min(0),
    title: z.string().trim().min(1).max(200),
    content: z.string().max(60000),
    summary: z.string().trim().max(200).default(''),
  })
  .strict();
const restoreInput = z.object({ expectedVersion: z.number().int().positive() }).strict();
const importInput = z
  .object({
    expectedVersion: z.number().int().min(0),
    title: z.string().trim().min(1).max(200),
    kind: z.enum(['novel', 'script', 'narration', 'brief']),
    source: z.discriminatedUnion('type', [
      z
        .object({
          type: z.literal('file'),
          fileName: z.string().min(1).max(180),
          base64: z.string().max(240004),
        })
        .strict(),
      z.object({ type: z.literal('paste'), text: z.string().max(60000) }).strict(),
    ]),
  })
  .strict();
const lockInput = z
  .object({ expectedVersion: z.number().int().positive(), expectedLockVersion: z.number().int().min(0) })
  .strict();
@ApiTags('剧本与历史版本')
@ApiCookieAuth()
@Controller('api/v1/projects/:projectId/script')
export class ScriptsController {
  constructor(private readonly scripts: ScriptsService) {}
  @Get() current(@Req() req: StudioRequest, @Param('projectId') id: string) {
    return this.scripts.current(req.user, parse(uuid, id));
  }
  @Post()
  @ApiBody({ schema: jsonSchema(scriptInput) })
  save(@Req() req: StudioRequest, @Param('projectId') id: string, @Body() input: unknown) {
    return this.scripts.save(req.user, parse(uuid, id), parse(scriptInput, input));
  }
  @Post('import')
  @ApiBody({ schema: jsonSchema(importInput) })
  importSource(@Req() req: StudioRequest, @Param('projectId') id: string, @Body() input: unknown) {
    return this.scripts.importSource(req.user, parse(uuid, id), parse(importInput, input));
  }
  @Post('lock')
  @ApiBody({ schema: jsonSchema(lockInput) })
  lock(@Req() req: StudioRequest, @Param('projectId') id: string, @Body() body: unknown) {
    const input = parse(lockInput, body);
    return this.scripts.setLock(
      req.user,
      parse(uuid, id),
      input.expectedVersion,
      input.expectedLockVersion,
      true,
    );
  }
  @Post('unlock')
  @ApiBody({ schema: jsonSchema(lockInput) })
  unlock(@Req() req: StudioRequest, @Param('projectId') id: string, @Body() body: unknown) {
    const input = parse(lockInput, body);
    return this.scripts.setLock(
      req.user,
      parse(uuid, id),
      input.expectedVersion,
      input.expectedLockVersion,
      false,
    );
  }
  @Get('versions/:version/source')
  source(
    @Req() req: StudioRequest,
    @Param('projectId') id: string,
    @Param('version') value: string,
    @Res() response: Response,
  ) {
    const source = this.scripts.original(req.user, parse(uuid, id), parse(version, value));
    const encoded = encodeURIComponent(source.fileName).replace(
      /[!'()*]/g,
      (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encoded}`);
    response.type('application/octet-stream').send(source.originalBytes);
  }
  @Get('versions/:version/spans')
  spans(
    @Req() req: StudioRequest,
    @Param('projectId') id: string,
    @Param('version') value: string,
    @Query('after') after?: string,
    @Query('limit') limit?: string,
  ) {
    return this.scripts.spans(
      req.user,
      parse(uuid, id),
      parse(version, value),
      after === undefined ? 0 : parse(z.coerce.number().int().min(0), after),
      limit === undefined ? 100 : parse(z.coerce.number().int().min(1).max(100), limit),
    );
  }
  @Get('versions') history(
    @Req() req: StudioRequest,
    @Param('projectId') id: string,
    @Query('before') before?: string,
  ) {
    return this.scripts.history(
      req.user,
      parse(uuid, id),
      before === undefined ? undefined : parse(version, before),
    );
  }
  @Get('versions/:version') readVersion(
    @Req() req: StudioRequest,
    @Param('projectId') id: string,
    @Param('version') value: string,
  ) {
    return this.scripts.readVersion(req.user, parse(uuid, id), parse(version, value));
  }
  @Post('versions/:version/restore')
  @ApiBody({ schema: jsonSchema(restoreInput) })
  restore(
    @Req() req: StudioRequest,
    @Param('projectId') id: string,
    @Param('version') value: string,
    @Body() input: unknown,
  ) {
    return this.scripts.restore(
      req.user,
      parse(uuid, id),
      parse(version, value),
      parse(restoreInput, input).expectedVersion,
    );
  }
}
