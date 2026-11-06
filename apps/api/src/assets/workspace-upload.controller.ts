import { Body, Controller, Get, Headers, Param, Post, Put, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { fail, parse, StudioRequest } from '../common/http';
import { workspaceUploadInput } from './workspace-upload.contract';
import { WorkspaceUploadService } from './workspace-upload.service';
import { publicMediaAction } from './workspace-library.controller';
const uuid = z.uuid();
@Controller('api/v1/workspaces/:workspaceId/public-library')
export class WorkspaceUploadController {
  constructor(private readonly uploads: WorkspaceUploadService) {}
  @Get('media-status') status(@Req() req: StudioRequest, @Param('workspaceId') wid: string) {
    return this.uploads.status(req.user, parse(uuid, wid));
  }
  @Get('media-uploads') list(
    @Req() req: StudioRequest,
    @Param('workspaceId') wid: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.uploads.list(
      req.user,
      parse(uuid, wid),
      cursor === undefined ? undefined : parse(uuid, cursor),
    );
  }
  @Post('media-uploads') initiate(
    @Req() req: StudioRequest,
    @Param('workspaceId') wid: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string,
  ) {
    return publicMediaAction(() =>
      this.uploads.initiate(req.user, parse(uuid, wid), parse(workspaceUploadInput, body), parse(uuid, key)),
    );
  }
  @Get('media-uploads/:id') upload(
    @Req() req: StudioRequest,
    @Param('workspaceId') wid: string,
    @Param('id') id: string,
  ) {
    return publicMediaAction(() => this.uploads.upload(req.user, parse(uuid, wid), parse(uuid, id)));
  }
  @Put('media-uploads/:id/content') receive(
    @Req() req: StudioRequest,
    @Param('workspaceId') wid: string,
    @Param('id') id: string,
  ) {
    if (req.headers['content-type'] !== 'application/octet-stream')
      fail(415, 'UPLOAD_CONTENT_TYPE', '文件传输须使用application/octet-stream');
    return publicMediaAction(() =>
      this.uploads.receive(req.user, parse(uuid, wid), parse(uuid, id), req, req.headers['content-length']),
    );
  }
  @Post('media-uploads/:id/reconcile') reconcile(
    @Req() req: StudioRequest,
    @Param('workspaceId') wid: string,
    @Param('id') id: string,
  ) {
    return publicMediaAction(() => this.uploads.reconcile(req.user, parse(uuid, wid), parse(uuid, id)));
  }
}
