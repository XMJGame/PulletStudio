import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { parse, StudioRequest } from '../common/http';
import { jsonSchema } from '../common/openapi';
import { TextConnectionsService } from './text-connections.service';
const uuid = z.uuid();
const apiKey = z
  .string()
  .max(8192)
  .refine((value) => !/[\r\n\u0000]/.test(value));
const profile = z
  .object({
    name: z.string().trim().min(1).max(100),
    model: z.string().trim().min(1).max(200),
    outputMode: z.enum(['json_schema', 'json_object', 'prompt_json']),
    tokenParameter: z.enum(['max_tokens', 'max_completion_tokens']).default('max_tokens'),
    maxOutputTokens: z.number().int().min(256).max(16384).default(4096),
    timeoutSeconds: z.number().int().min(10).max(300).default(120),
  })
  .strict();
const connection = z
  .object({
    name: z.string().trim().min(1).max(100),
    baseUrl: z.string().max(1000),
    trustedPrivate: z.boolean().default(false),
    apiKey: apiKey.optional(),
    profile,
  })
  .strict();
const update = z
  .object({
    expectedVersion: z.number().int().positive(),
    enabled: z.boolean().optional(),
    apiKey: apiKey.optional(),
    name: z.string().trim().min(1).max(100).optional(),
  })
  .strict();
@ApiTags('文本模型连接')
@ApiCookieAuth()
@Controller('api/v1')
export class TextController {
  constructor(private readonly connections: TextConnectionsService) {}
  @Get('workspaces/:workspaceId/text-connections') list(
    @Req() req: StudioRequest,
    @Param('workspaceId') id: string,
  ) {
    return this.connections.list(req.user, parse(uuid, id));
  }
  @Post('workspaces/:workspaceId/text-connections')
  @ApiBody({ schema: jsonSchema(connection) })
  create(@Req() req: StudioRequest, @Param('workspaceId') id: string, @Body() body: unknown) {
    return this.connections.create(req.user, parse(uuid, id), parse(connection, body));
  }
  @Patch('text-connections/:connectionId')
  @ApiBody({ schema: jsonSchema(update) })
  update(@Req() req: StudioRequest, @Param('connectionId') id: string, @Body() body: unknown) {
    return this.connections.update(req.user, parse(uuid, id), parse(update, body));
  }
  @Post('text-connections/:connectionId/models')
  @ApiBody({ schema: jsonSchema(profile) })
  addModel(@Req() req: StudioRequest, @Param('connectionId') id: string, @Body() body: unknown) {
    return this.connections.addModel(req.user, parse(uuid, id), parse(profile, body));
  }
}
