import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { parse, StudioRequest } from '../common/http';
import { jsonSchema } from '../common/openapi';
import { manualShotSchema } from './analysis-contract';
import { ProposalReviewService } from './proposal-review.service';
import { ProductionService } from '../production/production.service';
const uuid = z.uuid();
const version = z.coerce.number().int().min(0);
const edit = z
  .object({
    expectedVersion: z.number().int().min(0),
    shot: manualShotSchema,
    summary: z.string().trim().max(200).default(''),
  })
  .strict();
const decision = z
  .object({ expectedVersion: z.number().int().min(0), reason: z.string().trim().min(1).max(1000) })
  .strict();
const acceptance = z
  .object({
    expectedVersion: z.number().int().min(0),
    expectedProjectVersion: z.number().int().positive(),
    unitId: uuid.nullable().default(null),
    acknowledgeCreation: z.literal(true),
    acknowledgeInputChanges: z.boolean().default(false),
  })
  .strict();
@ApiTags('分镜草案审核与制作卡')
@ApiCookieAuth()
@Controller('api/v1')
export class ProposalReviewController {
  constructor(
    private readonly reviews: ProposalReviewService,
    private readonly production: ProductionService,
  ) {}
  @Get('proposals/:proposalId') view(@Req() req: StudioRequest, @Param('proposalId') id: string) {
    return this.reviews.view(req.user, parse(uuid, id));
  }
  @Get('proposals/:proposalId/versions') history(
    @Req() req: StudioRequest,
    @Param('proposalId') id: string,
    @Query('before') before?: string,
  ) {
    return this.reviews.history(
      req.user,
      parse(uuid, id),
      before === undefined ? undefined : parse(version, before),
    );
  }
  @Get('proposals/:proposalId/versions/:version') version(
    @Req() req: StudioRequest,
    @Param('proposalId') id: string,
    @Param('version') value: string,
  ) {
    return this.reviews.version(req.user, parse(uuid, id), parse(version, value));
  }
  @Patch('proposals/:proposalId/shots/:index')
  @ApiBody({ schema: jsonSchema(edit) })
  edit(
    @Req() req: StudioRequest,
    @Param('proposalId') id: string,
    @Param('index') index: string,
    @Body() body: unknown,
  ) {
    const input = parse(edit, body);
    return this.reviews.edit(
      req.user,
      parse(uuid, id),
      parse(z.coerce.number().int().min(0).max(23), index),
      input.expectedVersion,
      input.shot,
      input.summary,
    );
  }
  @Post('proposals/:proposalId/reject')
  @ApiBody({ schema: jsonSchema(decision) })
  reject(@Req() req: StudioRequest, @Param('proposalId') id: string, @Body() body: unknown) {
    const input = parse(decision, body);
    return this.reviews.decide(req.user, parse(uuid, id), input.expectedVersion, false, input.reason);
  }
  @Post('proposals/:proposalId/reopen')
  @ApiBody({ schema: jsonSchema(decision) })
  reopen(@Req() req: StudioRequest, @Param('proposalId') id: string, @Body() body: unknown) {
    const input = parse(decision, body);
    return this.reviews.decide(req.user, parse(uuid, id), input.expectedVersion, true, input.reason);
  }
  @Post('proposals/:proposalId/accept')
  @ApiBody({ schema: jsonSchema(acceptance) })
  accept(@Req() req: StudioRequest, @Param('proposalId') id: string, @Body() body: unknown) {
    return this.reviews.accept(req.user, parse(uuid, id), parse(acceptance, body));
  }
  @Get('shots/:shotId/card') card(@Req() req: StudioRequest, @Param('shotId') id: string) {
    return this.production.card(req.user, parse(uuid, id));
  }
  @Get('shots/:shotId/card/versions') cards(
    @Req() req: StudioRequest,
    @Param('shotId') id: string,
    @Query('before') before?: string,
  ) {
    return this.production.cardHistory(
      req.user,
      parse(uuid, id),
      before === undefined ? undefined : parse(z.coerce.number().int().positive(), before),
    );
  }
  @Get('shots/:shotId/card/versions/:version') cardVersion(
    @Req() req: StudioRequest,
    @Param('shotId') id: string,
    @Param('version') value: string,
  ) {
    return this.production.card(req.user, parse(uuid, id), parse(z.coerce.number().int().positive(), value));
  }
}
