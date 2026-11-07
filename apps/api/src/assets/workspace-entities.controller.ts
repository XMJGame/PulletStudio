import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { parse, StudioRequest } from '../common/http';
import { WorkspaceEntitiesService } from './workspace-entities.service';
import { deliverPublicMedia, publicMediaAction } from './workspace-library.controller';
import type { LibraryScope } from './workspace-library.service';
const uuid = z.uuid(),
  version = z.number().int().positive();
const scope = (req: StudioRequest): LibraryScope =>
  req.params.projectId
    ? parse(uuid, req.params.projectId)
    : { workspaceId: parse(uuid, req.params.workspaceId) };
@Controller(['api/v1/projects/:projectId/public-library', 'api/v1/workspaces/:workspaceId/public-library'])
export class WorkspaceEntitiesController {
  constructor(private readonly entities: WorkspaceEntitiesService) {}
  @Get('entities') list(@Req() req: StudioRequest, @Query() query: unknown) {
    return this.entities.list(
      req.user,
      scope(req),
      parse(
        z
          .object({
            folderId: z.union([uuid, z.literal('root')]).optional(),
            kind: z.enum(['character', 'environment', 'prop']).optional(),
            q: z.string().max(80).optional(),
            cursor: uuid.optional(),
          })
          .strict(),
        query,
      ),
    );
  }
  @Get('entities/:id') read(@Req() req: StudioRequest, @Param('id') id: string) {
    return this.entities.read(req.user, scope(req), parse(uuid, id));
  }
  @Patch('entities/:id') move(@Req() req: StudioRequest, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(z.object({ expectedVersion: version, folderId: uuid.nullable() }).strict(), body);
    return this.entities.change(req.user, scope(req), parse(uuid, id), input.expectedVersion, input.folderId);
  }
  @Delete('entities/:id') remove(@Req() req: StudioRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.entities.change(
      req.user,
      scope(req),
      parse(uuid, id),
      parse(z.object({ expectedVersion: version }).strict(), body).expectedVersion,
    );
  }
  @Get('entities/:id/media/:mediaId/content') content(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Param('mediaId') mediaId: string,
    @Query('download') download: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    return deliverPublicMedia(
      response,
      () =>
        this.entities.content(
          req.user,
          scope(req),
          parse(uuid, id),
          parse(uuid, mediaId),
          false,
          req.headers.range,
        ),
      download === '1',
    );
  }
  @Get('entities/:id/media/:mediaId/poster') poster(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Param('mediaId') mediaId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return deliverPublicMedia(
      response,
      () =>
        this.entities.content(
          req.user,
          scope(req),
          parse(uuid, id),
          parse(uuid, mediaId),
          true,
          req.headers.range,
        ),
      false,
    );
  }
}
@Controller('api/v1/projects/:projectId/public-library')
export class ProjectEntitiesLibraryController {
  constructor(private readonly entities: WorkspaceEntitiesService) {}
  @Post('entities') collect(
    @Req() req: StudioRequest,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string,
  ) {
    const input = parse(
      z.object({ revisionId: uuid, folderId: uuid.nullable().default(null) }).strict(),
      body,
    );
    return this.entities.collect(
      req.user,
      parse(uuid, projectId),
      input.revisionId,
      input.folderId,
      parse(uuid, key),
    );
  }
  @Post('entities/:id/import') import(
    @Req() req: StudioRequest,
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
  ) {
    return publicMediaAction(() =>
      this.entities.import(req.user, parse(uuid, projectId), parse(uuid, id), parse(uuid, key)),
    );
  }
}
