import { Body, Controller, Get, Headers, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { parse, StudioRequest, fail } from '../common/http';
import { jsonSchema } from '../common/openapi';
import { EntitiesService } from './entities.service';
import { createEntity, reviseEntity, entityKinds, assetReferencesSchema } from './entity-contract';
import { CardAuthoringService } from '../production/card-authoring.service';
const uuid = z.uuid(),
  number = z.coerce.number().int().positive();
const bindings = z
  .object({ expectedShotCardVersion: z.number().int().positive(), bindings: assetReferencesSchema })
  .strict();
@ApiTags('语义资产与固定引用')
@ApiCookieAuth()
@Controller('api/v1')
export class EntitiesController {
  constructor(
    private readonly entities: EntitiesService,
    private readonly cards: CardAuthoringService,
  ) {}
  @Get('projects/:id/entities') list(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Query('kind') kind?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.entities.list(
      req.user,
      parse(uuid, id),
      kind ? parse(z.enum(entityKinds), kind) : undefined,
      cursor ? parse(uuid, cursor) : undefined,
    );
  }
  @Post('projects/:id/entities')
  @ApiBody({ schema: jsonSchema(createEntity) })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  create(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    const input = parse(createEntity, body);
    return this.entities.save(req.user, parse(uuid, id), null, input.kind, input.body, parse(uuid, key));
  }
  @Get('entities/:id') read(@Req() req: StudioRequest, @Param('id') id: string) {
    return this.entities.read(req.user, parse(uuid, id));
  }
  @Get('entities/:id/revisions') history(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Query('before') before?: string,
  ) {
    return this.entities.revisions(req.user, parse(uuid, id), before ? parse(number, before) : undefined);
  }
  @Get('entities/:id/revisions/:version') revision(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Param('version') version: string,
  ) {
    return this.entities.read(req.user, parse(uuid, id), parse(number, version));
  }
  @Post('entities/:id/revisions')
  @ApiBody({ schema: jsonSchema(reviseEntity) })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  revise(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    const input = parse(reviseEntity, body);
    return this.entities.save(
      req.user,
      null,
      parse(uuid, id),
      null,
      input.body,
      parse(uuid, key),
      input.expectedVersion,
    );
  }
  @Get('entities/:id/impacted-shots') impacts(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.entities.impacts(req.user, parse(uuid, id), cursor ? parse(uuid, cursor) : undefined);
  }
  @Get('shots/:id/asset-bindings') current(@Req() req: StudioRequest, @Param('id') id: string) {
    return this.cards.editor(req.user, parse(uuid, id));
  }
  @Post('shots/:id/asset-bindings')
  @ApiBody({ schema: jsonSchema(bindings) })
  bind(@Req() req: StudioRequest, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(bindings, body),
      shotId = parse(uuid, id),
      current = this.cards.editor(req.user, shotId);
    if (!current.card.available) fail(409, 'CARD_REQUIRED', '请先保存完整制作卡，再添加资产引用');
    return this.cards.save(
      req.user,
      shotId,
      input.expectedShotCardVersion,
      { ...current.body, assetBindings: input.bindings },
      '更新固定资产引用',
    );
  }
}
