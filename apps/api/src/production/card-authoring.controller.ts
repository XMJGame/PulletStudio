import { Body, Controller, Get, Param, Patch, Req } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { parse, StudioRequest } from '../common/http';
import { jsonSchema } from '../common/openapi';
import { formalCardSchema } from './formal-card';
import { CardAuthoringService } from './card-authoring.service';
const save = z
  .object({
    expectedVersion: z.number().int().positive(),
    body: formalCardSchema,
    summary: z.string().trim().max(200).default(''),
  })
  .strict();
@ApiTags('完整制作卡编辑')
@ApiCookieAuth()
@Controller('api/v1/shots')
export class CardAuthoringController {
  constructor(private readonly cards: CardAuthoringService) {}
  @Get(':shotId/card/editor') editor(@Req() req: StudioRequest, @Param('shotId') id: string) {
    return this.cards.editor(req.user, parse(z.uuid(), id));
  }
  @Patch(':shotId/card')
  @ApiBody({ schema: jsonSchema(save) })
  save(@Req() req: StudioRequest, @Param('shotId') id: string, @Body() body: unknown) {
    const input = parse(save, body);
    return this.cards.save(req.user, parse(z.uuid(), id), input.expectedVersion, input.body, input.summary);
  }
}
