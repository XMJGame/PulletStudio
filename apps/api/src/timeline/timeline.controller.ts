import { Body, Controller, Get, Headers, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { parse, StudioRequest } from '../common/http';
import { jsonSchema } from '../common/openapi';
import { packageOptions } from '../exports/media-package-contract';
import { saveTimelineInput, timelineInput } from './timeline-contract';
import { TimelineService } from './timeline.service';
const uuid = z.uuid(),
  cursor = z.coerce.number().int().positive();
@ApiCookieAuth()
@ApiTags('时间线与预演')
@Controller('api/v1')
export class TimelineController {
  constructor(private readonly timelines: TimelineService) {}
  @Post('projects/:id/timeline-editor')
  @ApiBody({ schema: jsonSchema(packageOptions) })
  editor(@Req() req: StudioRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.timelines.editor(req.user, parse(uuid, id), parse(packageOptions, body));
  }
  @Post('projects/:id/timelines/preview')
  @ApiBody({ schema: jsonSchema(timelineInput) })
  preview(@Req() req: StudioRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.timelines.preview(req.user, parse(uuid, id), parse(timelineInput, body));
  }
  @Post('projects/:id/timelines')
  @ApiBody({ schema: jsonSchema(saveTimelineInput) })
  save(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string,
  ) {
    const { expectedVersion, expectedPreviewHash, ...input } = parse(saveTimelineInput, body);
    return this.timelines.save(
      req.user,
      parse(uuid, id),
      input,
      expectedVersion,
      expectedPreviewHash,
      parse(uuid, key),
    );
  }
  @Get('projects/:id/timelines')
  list(@Req() req: StudioRequest, @Param('id') id: string, @Query('before') before?: string) {
    return this.timelines.list(
      req.user,
      parse(uuid, id),
      before === undefined ? undefined : parse(cursor, before),
    );
  }
  @Get('timelines/:id')
  read(@Req() req: StudioRequest, @Param('id') id: string) {
    return this.timelines.read(req.user, parse(uuid, id));
  }
  @Post('timelines/:id/animatics')
  queue(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string,
  ) {
    parse(z.object({}).strict(), body);
    return this.timelines.queue(req.user, parse(uuid, id), parse(uuid, key));
  }
  @Get('timelines/:id/animatics')
  jobs(@Req() req: StudioRequest, @Param('id') id: string) {
    return this.timelines.jobs(req.user, parse(uuid, id));
  }
  @Post('animatic-jobs/:id/cancel')
  cancel(@Req() req: StudioRequest, @Param('id') id: string, @Body() body: unknown) {
    parse(z.object({}).strict(), body);
    return this.timelines.cancel(req.user, parse(uuid, id));
  }
}
