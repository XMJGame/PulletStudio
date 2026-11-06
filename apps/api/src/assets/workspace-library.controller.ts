import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { fail, parse, StudioRequest } from '../common/http';
import { StorageFailure } from '../storage/local-storage';
import { safeMediaError } from './media.service';
import { WorkspaceLibraryService } from './workspace-library.service';
const uuid = z.uuid(),
  name = z.string().trim().min(1).max(80),
  expectedVersion = z.number().int().positive();
@Controller('api/v1/projects/:projectId/public-library')
export class WorkspaceLibraryController {
  constructor(private readonly library: WorkspaceLibraryService) {}
  @Get('library-folders') folders(@Req() req: StudioRequest, @Param('projectId') projectId: string) {
    return this.library.listFolders(req.user, parse(uuid, projectId));
  }
  @Post('library-folders') createFolder(
    @Req() req: StudioRequest,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string,
  ) {
    return this.library.changeFolder(
      req.user,
      parse(uuid, projectId),
      parse(z.object({ name }).strict(), body),
      parse(uuid, key),
    );
  }
  @Patch('library-folders/:id') renameFolder(
    @Req() req: StudioRequest,
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.library.changeFolder(req.user, parse(uuid, projectId), {
      ...parse(z.object({ name, expectedVersion }).strict(), body),
      id: parse(uuid, id),
    });
  }
  @Delete('library-folders/:id') deleteFolder(
    @Req() req: StudioRequest,
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.library.changeFolder(req.user, parse(uuid, projectId), {
      ...parse(z.object({ expectedVersion }).strict(), body),
      id: parse(uuid, id),
      remove: true,
    });
  }
  @Get('resources') list(
    @Req() req: StudioRequest,
    @Param('projectId') projectId: string,
    @Query() query: unknown,
  ) {
    return this.library.list(
      req.user,
      parse(uuid, projectId),
      parse(
        z
          .object({
            folderId: z.union([uuid, z.literal('root')]).optional(),
            q: z.string().max(80).optional(),
            mediaType: z.enum(['image', 'video', 'audio']).optional(),
            cursor: uuid.optional(),
          })
          .strict(),
        query,
      ),
    );
  }
  @Post('resources') collect(
    @Req() req: StudioRequest,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string,
  ) {
    const input = parse(
      z.object({ mediaVersionId: uuid, folderId: uuid.nullable().default(null) }).strict(),
      body,
    );
    return this.library.collect(
      req.user,
      parse(uuid, projectId),
      input.mediaVersionId,
      input.folderId,
      parse(uuid, key),
    );
  }
  @Patch('resources/:id') move(
    @Req() req: StudioRequest,
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = parse(z.object({ expectedVersion, folderId: uuid.nullable() }).strict(), body);
    return this.library.change(
      req.user,
      parse(uuid, projectId),
      parse(uuid, id),
      input.expectedVersion,
      input.folderId,
    );
  }
  @Delete('resources/:id') remove(
    @Req() req: StudioRequest,
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.library.change(
      req.user,
      parse(uuid, projectId),
      parse(uuid, id),
      parse(z.object({ expectedVersion }).strict(), body).expectedVersion,
    );
  }
  private async run<T>(action: () => Promise<T>) {
    try {
      return await action();
    } catch (error) {
      if (
        error instanceof StorageFailure ||
        ['ENOENT', 'EACCES', 'EPERM', 'ENOSPC', 'ELOOP'].includes(
          (error as NodeJS.ErrnoException)?.code ?? '',
        )
      ) {
        const safe = safeMediaError(error);
        fail(503, safe.code, safe.message);
      }
      throw error;
    }
  }
  @Post('resources/:id/import') import(
    @Req() req: StudioRequest,
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
  ) {
    return this.run(() =>
      this.library.import(req.user, parse(uuid, projectId), parse(uuid, id), parse(uuid, key)),
    );
  }
  @Get('resources/:id/content') content(
    @Req() req: StudioRequest,
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
    @Query('download') download?: string,
  ) {
    return this.deliver(req, projectId, id, response, false, download === '1');
  }
  @Get('resources/:id/poster') poster(
    @Req() req: StudioRequest,
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.deliver(req, projectId, id, response, true, false);
  }
  private async deliver(
    req: StudioRequest,
    projectId: string,
    id: string,
    response: Response,
    poster: boolean,
    download: boolean,
  ) {
    response.setHeader('Accept-Ranges', 'bytes');
    const file = await this.run(() =>
      this.library.content(req.user, parse(uuid, projectId), parse(uuid, id), poster, req.headers.range),
    );
    response.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    if (file.range) {
      response.status(206);
      response.setHeader('Content-Range', `bytes ${file.range.start}-${file.range.end}/${file.total}`);
    }
    const encoded = encodeURIComponent(file.fileName).replace(
      /['()*]/g,
      (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    return new StreamableFile(file.stream, {
      type: file.mime,
      length: file.length,
      disposition: `${download ? 'attachment' : 'inline'}; filename="media-${file.id}"; filename*=UTF-8''${encoded}`,
    });
  }
}
