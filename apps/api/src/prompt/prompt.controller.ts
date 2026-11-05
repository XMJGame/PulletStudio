import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { parse, StudioRequest } from '../common/http';
import { jsonSchema } from '../common/openapi';
import { compileInput, profileInput } from './prompt-contract';
import { PromptService } from './prompt.service';
const reviseInput = profileInput.extend({ expectedVersion: z.number().int().positive() });
const uuid = z.uuid();
@ApiCookieAuth()
@ApiTags('离线提示词')
@Controller('api/v1')
export class PromptController {
  constructor(private readonly prompts: PromptService) {}
  @Get('projects/:id/prompt-profiles') profiles(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.prompts.profiles(
      req.user,
      parse(uuid, id),
      cursor === undefined ? undefined : parse(uuid, cursor),
    );
  }
  @Post('projects/:id/prompt-profiles')
  @ApiBody({ schema: jsonSchema(profileInput) })
  create(@Req() req: StudioRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.prompts.saveProfile(req.user, parse(uuid, id), null, parse(profileInput, body));
  }
  @Post('prompt-profiles/:id/revisions')
  @ApiBody({ schema: jsonSchema(reviseInput) })
  revise(@Req() req: StudioRequest, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(reviseInput, body);
    return this.prompts.saveProfile(req.user, null, parse(uuid, id), input, input.expectedVersion);
  }
  @Post('shots/:id/prompts/compile')
  @ApiBody({ schema: jsonSchema(compileInput) })
  compile(@Req() req: StudioRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.prompts.compile(req.user, parse(uuid, id), parse(compileInput, body));
  }
  @Get('shots/:id/prompts') list(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.prompts.artifacts(
      req.user,
      parse(uuid, id),
      cursor === undefined ? undefined : parse(uuid, cursor),
    );
  }
  @Get('shots/:id/prompts/:artifactId') artifact(
    @Req() req: StudioRequest,
    @Param('id') id: string,
    @Param('artifactId') artifactId: string,
  ) {
    return this.prompts.artifact(req.user, parse(uuid, id), parse(uuid, artifactId));
  }
}
