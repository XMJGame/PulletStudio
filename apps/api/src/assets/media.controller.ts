import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { z } from 'zod';
import { fail, parse, StudioRequest } from '../common/http';
import { jsonSchema } from '../common/openapi';
import { StorageFailure } from '../storage/local-storage';
import { MediaService, safeMediaError } from './media.service';
import { takeInput, uploadInput } from './media-contract';
const uuid = z.uuid();
const number = z.coerce.number().int().positive();
@ApiTags('本地媒体与手工候选')
@ApiCookieAuth()
@Controller('api/v1')
export class MediaController {
  constructor(private readonly media: MediaService) {}
  private async run<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (
        error instanceof StorageFailure ||
        ['ENOENT', 'EACCES', 'EPERM', 'ENOSPC', 'ELOOP', 'EXDEV'].includes(
          (error as NodeJS.ErrnoException)?.code ?? '',
        )
      ) {
        const safe = safeMediaError(error);
        fail(safe.code === 'MEDIA_INTEGRITY_FAILED' ? 409 : 503, safe.code, safe.message);
      }
      throw error;
    }
  }
  @Get('projects/:id/media-status') status(@Req() req: StudioRequest, @Param('id') id: string) {
    return this.media.status(req.user, parse(uuid, id));
  }
  @Get('projects/:id/media-assets') assets(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.media.assets(
      req.user,
      parse(uuid, id),
      cursor === undefined ? undefined : parse(uuid, cursor),
    );
  }
  @Get('projects/:id/media-uploads') uploads(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.media.uploads(
      req.user,
      parse(uuid, id),
      cursor === undefined ? undefined : parse(uuid, cursor),
    );
  }
  @Post('projects/:id/media-uploads')
  @ApiBody({ schema: jsonSchema(uploadInput) })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  initiate(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    const input = parse(uploadInput, body);
    return this.run(() => this.media.initiate(req.user, parse(uuid, id), input, parse(uuid, key)));
  }
  @Get('media-uploads/:id') upload(@Req() req: StudioRequest, @Param('id') id: string) {
    return this.run(() => this.media.upload(req.user, parse(uuid, id)));
  }
  @Put('media-uploads/:id/content')
  receive(@Req() req: StudioRequest, @Param('id') id: string) {
    if (req.headers['content-type'] !== 'application/octet-stream')
      fail(415, 'UPLOAD_CONTENT_TYPE', '文件传输须使用application/octet-stream');
    return this.run(() => this.media.receive(req.user, parse(uuid, id), req, req.headers['content-length']));
  }
  @Post('media-uploads/:id/reconcile') reconcile(@Req() req: StudioRequest, @Param('id') id: string) {
    return this.run(() => this.media.reconcile(req.user, parse(uuid, id)));
  }
  @Get('media-assets/:id/versions') versions(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Query('before') before?: string,
  ) {
    return this.media.versions(
      req.user,
      parse(uuid, id),
      before === undefined ? undefined : parse(number, before),
    );
  }
  @Get('media-versions/:id') version(@Req() req: StudioRequest, @Param('id') id: string) {
    return this.media.version(req.user, parse(uuid, id));
  }
  @Get('shots/:id/takes') takes(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Query('before') before?: string,
  ) {
    return this.media.takeList(
      req.user,
      parse(uuid, id),
      before === undefined ? undefined : parse(number, before),
    );
  }
  @Post('shots/:id/takes')
  @ApiBody({ schema: jsonSchema(takeInput) })
  take(@Req() req: StudioRequest, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(takeInput, body);
    return this.media.addTake(req.user, parse(uuid, id), input.mediaVersionId, input.expectedShotVersion);
  }
  @Get('media-versions/:id/content') content(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Query('download') download?: string,
    @Res({ passthrough: true }) response?: Response,
  ) {
    return this.deliver(req, parse(uuid, id), false, download === '1', response!);
  }
  @Get('media-versions/:id/poster') poster(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.deliver(req, parse(uuid, id), true, false, response);
  }
  private async deliver(
    req: StudioRequest,
    id: string,
    poster: boolean,
    download: boolean,
    response: Response,
  ) {
    response.setHeader('Accept-Ranges', 'bytes');
    const metadata = this.media.version(req.user, id);
    try {
      const file = await this.run(() => this.media.content(req.user, id, poster, req.headers.range));
      response.setHeader('X-Content-SHA256', file.sha256);
      response.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
      if (file.range) {
        response.status(206);
        response.setHeader('Content-Range', `bytes ${file.range.start}-${file.range.end}/${file.total}`);
      }
      const name = encodeURIComponent(file.fileName).replace(
        /['()*]/g,
        (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
      );
      return new StreamableFile(file.stream, {
        type: file.mime,
        length: file.length,
        disposition: `${download ? 'attachment' : 'inline'}; filename="media-${file.id}${poster ? '.jpg' : ''}"; filename*=UTF-8''${name}`,
      });
    } catch (error) {
      if ((error as { getStatus?: () => number }).getStatus?.() === 416)
        response.setHeader(
          'Content-Range',
          `bytes */${(error as { getResponse: () => { details?: { bytes: number } } }).getResponse().details?.bytes ?? metadata.byteLength}`,
        );
      throw error;
    }
  }
}
