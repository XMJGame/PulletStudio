import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { parse, StudioRequest } from '../common/http';
import { WorkspaceLibraryService } from './workspace-library.service';
import { deliverPublicMedia, publicLibraryQuery } from './workspace-library.controller';
const uuid = z.uuid(),
  name = z.string().trim().min(1).max(80),
  expectedVersion = z.number().int().positive();
@Controller('api/v1/workspaces/:workspaceId/public-library')
export class WorkspaceLibraryBrowserController {
  constructor(private readonly library: WorkspaceLibraryService) {}
  @Get('library-folders') folders(@Req() req: StudioRequest, @Param('workspaceId') workspaceId: string) {
    return this.library.listFolders(req.user, { workspaceId: parse(uuid, workspaceId) });
  }
  @Post('library-folders') createFolder(
    @Req() req: StudioRequest,
    @Param('workspaceId') workspaceId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string,
  ) {
    return this.library.changeFolder(
      req.user,
      { workspaceId: parse(uuid, workspaceId) },
      parse(z.object({ name }).strict(), body),
      parse(uuid, key),
    );
  }
  @Patch('library-folders/:id') renameFolder(
    @Req() req: StudioRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.library.changeFolder(
      req.user,
      { workspaceId: parse(uuid, workspaceId) },
      { ...parse(z.object({ name, expectedVersion }).strict(), body), id: parse(uuid, id) },
    );
  }
  @Delete('library-folders/:id') deleteFolder(
    @Req() req: StudioRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.library.changeFolder(
      req.user,
      { workspaceId: parse(uuid, workspaceId) },
      { ...parse(z.object({ expectedVersion }).strict(), body), id: parse(uuid, id), remove: true },
    );
  }
  @Get('resources') list(
    @Req() req: StudioRequest,
    @Param('workspaceId') workspaceId: string,
    @Query() query: unknown,
  ) {
    return this.library.list(
      req.user,
      { workspaceId: parse(uuid, workspaceId) },
      parse(publicLibraryQuery, query),
    );
  }
  @Patch('resources/:id') move(
    @Req() req: StudioRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = parse(z.object({ expectedVersion, folderId: uuid.nullable() }).strict(), body);
    return this.library.change(
      req.user,
      { workspaceId: parse(uuid, workspaceId) },
      parse(uuid, id),
      input.expectedVersion,
      input.folderId,
    );
  }
  @Delete('resources/:id') remove(
    @Req() req: StudioRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.library.change(
      req.user,
      { workspaceId: parse(uuid, workspaceId) },
      parse(uuid, id),
      parse(z.object({ expectedVersion }).strict(), body).expectedVersion,
    );
  }
  @Get('resources/:id/content') content(
    @Req() req: StudioRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
    @Query('download') download?: string,
  ) {
    return deliverPublicMedia(
      response,
      () =>
        this.library.content(
          req.user,
          { workspaceId: parse(uuid, workspaceId) },
          parse(uuid, id),
          false,
          req.headers.range,
        ),
      download === '1',
    );
  }
  @Get('resources/:id/poster') poster(
    @Req() req: StudioRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return deliverPublicMedia(
      response,
      () =>
        this.library.content(
          req.user,
          { workspaceId: parse(uuid, workspaceId) },
          parse(uuid, id),
          true,
          req.headers.range,
        ),
      false,
    );
  }
}
