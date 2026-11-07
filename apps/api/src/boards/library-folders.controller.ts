import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { parse, StudioRequest } from '../common/http';
import { boardReference } from './board-contract';
import { LibraryFoldersService } from './library-folders.service';
const uuid = z.uuid();
const name = z.string().trim().min(1).max(80);
const expectedVersion = z.number().int().positive();
@Controller('api/v1/projects/:projectId')
export class LibraryFoldersController {
  constructor(private readonly folders: LibraryFoldersService) {}
  @Get('library-folders')
  list(@Req() req: StudioRequest, @Param('projectId') projectId: string) {
    return this.folders.list(req.user, parse(uuid, projectId));
  }
  @Post('library-folders')
  create(
    @Req() req: StudioRequest,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string,
  ) {
    const input = parse(z.object({ name }).strict(), body);
    return this.folders.create(req.user, parse(uuid, projectId), input.name, parse(uuid, key));
  }
  @Patch('library-folders/:id')
  rename(
    @Req() req: StudioRequest,
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = parse(z.object({ name, expectedVersion }).strict(), body);
    return this.folders.rename(
      req.user,
      parse(uuid, projectId),
      parse(uuid, id),
      input.name,
      input.expectedVersion,
    );
  }
  @Delete('library-folders/:id')
  remove(
    @Req() req: StudioRequest,
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = parse(z.object({ expectedVersion }).strict(), body);
    return this.folders.remove(req.user, parse(uuid, projectId), parse(uuid, id), input.expectedVersion);
  }
  @Post('library-placement')
  move(@Req() req: StudioRequest, @Param('projectId') projectId: string, @Body() body: unknown) {
    const input = parse(
      z
        .object({
          ref: boardReference,
          folderId: uuid.nullable(),
          expectedVersion: z.number().int().nonnegative(),
        })
        .strict(),
      body,
    );
    return this.folders.move(
      req.user,
      parse(uuid, projectId),
      input.ref,
      input.folderId,
      input.expectedVersion,
    );
  }
}
