import { Body, Controller, Get, Headers, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { parse, StudioRequest } from '../common/http';
import { jsonSchema } from '../common/openapi';
import { TakeReviewService, takeReviewInput, takeSelectionInput } from './take-review.service';

const uuid = z.uuid();
const cursor = z.coerce.number().int().positive();
@ApiTags('候选审核与选片')
@ApiCookieAuth()
@Controller('api/v1')
export class TakeReviewController {
  constructor(private readonly reviews: TakeReviewService) {}
  @Get('takes/:id/reviews')
  list(@Req() req: StudioRequest, @Param('id') id: string, @Query('before') before?: string) {
    return this.reviews.list(
      req.user,
      parse(uuid, id),
      before === undefined ? undefined : parse(cursor, before),
    );
  }
  @Post('takes/:id/reviews')
  @ApiBody({ schema: jsonSchema(takeReviewInput) })
  decide(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string,
  ) {
    return this.reviews.decide(req.user, parse(uuid, id), parse(takeReviewInput, body), parse(uuid, key));
  }
  @Get('shots/:id/take-selection')
  selection(@Req() req: StudioRequest, @Param('id') id: string, @Query('before') before?: string) {
    return this.reviews.selection(
      req.user,
      parse(uuid, id),
      before === undefined ? undefined : parse(cursor, before),
    );
  }
  @Post('shots/:id/take-selection')
  @ApiBody({ schema: jsonSchema(takeSelectionInput) })
  select(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string,
  ) {
    return this.reviews.select(req.user, parse(uuid, id), parse(takeSelectionInput, body), parse(uuid, key));
  }
}
