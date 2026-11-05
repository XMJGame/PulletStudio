import { Body, Controller, Get, Headers, Param, Post, Query, Req, Res, StreamableFile } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { z } from 'zod';
import { parse, StudioRequest } from '../common/http';
import { jsonSchema } from '../common/openapi';
import { createExportInput, exportOptions } from './export-contract';
import { StoryboardExportsService } from './storyboard-exports.service';
@ApiCookieAuth()
@ApiTags('分镜文本导出')
@Controller('api/v1')
export class StoryboardExportsController {
  constructor(private readonly exports: StoryboardExportsService) {}
  @Post('projects/:id/storyboard-exports/preview')
  @ApiBody({ schema: jsonSchema(exportOptions) })
  preview(@Req() req: StudioRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.exports.preview(req.user, parse(z.uuid(), id), parse(exportOptions, body));
  }
  @Post('projects/:id/storyboard-exports')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ schema: jsonSchema(createExportInput) })
  create(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    const { expectedSnapshotHash, ...options } = parse(createExportInput, body);
    return this.exports.create(
      req.user,
      parse(z.uuid(), id),
      options,
      expectedSnapshotHash,
      parse(z.uuid(), key),
    );
  }
  @Get('projects/:id/storyboard-exports') list(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.exports.list(
      req.user,
      parse(z.uuid(), id),
      cursor === undefined ? undefined : parse(z.uuid(), cursor),
    );
  }
  @Get('storyboard-exports/:id') read(@Req() req: StudioRequest, @Param('id') id: string) {
    return this.exports.read(req.user, parse(z.uuid(), id));
  }
  @Get('storyboard-exports/:id/file') file(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = this.exports.file(req.user, parse(z.uuid(), id));
    response.setHeader('X-Content-SHA256', file.sha256);
    return new StreamableFile(file.content, {
      type: file.mediaType,
      disposition: `attachment; filename="${file.fileName}"`,
      length: file.byteLength,
    });
  }
}
