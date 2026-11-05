import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  Param,
  Post,
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
import { safeMediaError } from '../assets/media.service';
import { MediaPackageService } from './media-package.service';
import { createPackageInput, packageOptions } from './media-package-contract';
const uuid = z.uuid();
@ApiCookieAuth()
@ApiTags('已选素材包导出')
@Controller('api/v1')
export class MediaPackageController {
  constructor(private readonly packages: MediaPackageService) {}
  private async run<T>(action: () => Promise<T>) {
    try {
      return await action();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const failure = safeMediaError(error);
      fail(409, failure.code, failure.message);
    }
  }
  @Post('projects/:id/media-packages/preview')
  @ApiBody({ schema: jsonSchema(packageOptions) })
  preview(@Req() req: StudioRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.packages.preview(req.user, parse(uuid, id), parse(packageOptions, body));
  }
  @Post('projects/:id/media-packages')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ schema: jsonSchema(createPackageInput) })
  create(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string,
  ) {
    const { expectedSnapshotHash, ...options } = parse(createPackageInput, body);
    return this.run(() =>
      this.packages.create(req.user, parse(uuid, id), options, expectedSnapshotHash, parse(uuid, key)),
    );
  }
  @Get('projects/:id/media-packages')
  list(@Req() req: StudioRequest, @Param('id') id: string, @Query('cursor') cursor?: string) {
    return this.packages.list(
      req.user,
      parse(uuid, id),
      cursor === undefined ? undefined : parse(uuid, cursor),
    );
  }
  @Get('media-packages/:id')
  read(@Req() req: StudioRequest, @Param('id') id: string) {
    return this.packages.read(req.user, parse(uuid, id));
  }
  @Get('media-packages/:id/file')
  async file(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const abort = new AbortController();
    const stop = () => abort.abort();
    response.once('close', stop);
    response.once('finish', () => response.off('close', stop));
    const file = await this.run(() => this.packages.file(req.user, parse(uuid, id), abort.signal));
    response.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(file.stream, {
      type: 'application/zip',
      disposition: `attachment; filename="${file.fileName}"`,
      length: file.length,
    });
  }
}
