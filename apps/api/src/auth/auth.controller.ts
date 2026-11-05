import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { z } from 'zod';
import { AppConfig } from '../config';
import { parse, StudioRequest } from '../common/http';
import { AuthService } from './auth.service';
import { Public } from './auth.guard';
import { jsonSchema } from '../common/openapi';

const email = z
  .email()
  .max(254)
  .transform((s) => s.toLowerCase());
const password = z.string().min(8, '密码需为 8–16 位').max(16, '密码需为 8–16 位');
const name = z.string().trim().min(1).max(80);
const loginSchema = z.object({ email, password: z.string().min(1).max(128) }).strict();
const setupSchema = z
  .object({ setupToken: z.string().min(32).max(256), email, password, name, workspaceName: name })
  .strict();
const invitationSchema = z
  .object({ token: z.string().length(64), name: name.optional(), password: password.optional() })
  .strict();

@ApiTags('身份与初始化')
@Controller('api/v1')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfig,
  ) {}
  private cookies(res: Response, session: { token: string; csrfToken: string }) {
    const options = {
      secure: this.config.secureCookie,
      sameSite: 'strict' as const,
      path: '/',
      maxAge: this.config.sessionHours * 3600000,
    };
    res.cookie('studio_session', session.token, { ...options, httpOnly: true });
    res.cookie('studio_csrf', session.csrfToken, { ...options, httpOnly: false });
  }
  @Public()
  @Get('setup/status')
  status() {
    return this.auth.status();
  }
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('setup/initialize')
  @ApiBody({ schema: jsonSchema(setupSchema) })
  async initialize(
    @Body() body: unknown,
    @Req() req: StudioRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.initialize(parse(setupSchema, body));
    const session = this.auth.createSession(result.user.id, req.cookies?.studio_session);
    this.cookies(res, session);
    return { ...result, csrfToken: session.csrfToken };
  }
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('auth/login')
  @HttpCode(200)
  @ApiBody({ schema: jsonSchema(loginSchema) })
  async login(@Body() body: unknown, @Req() req: StudioRequest, @Res({ passthrough: true }) res: Response) {
    const input = parse(loginSchema, body);
    const user = await this.auth.login(input.email, input.password);
    const session = this.auth.createSession(user.id, req.cookies?.studio_session);
    this.cookies(res, session);
    return { user, csrfToken: session.csrfToken };
  }
  @ApiCookieAuth()
  @Get('auth/me')
  me(@Req() req: StudioRequest) {
    return { user: req.user, csrfToken: req.cookies?.studio_csrf || '' };
  }
  @ApiCookieAuth()
  @Post('auth/logout')
  @HttpCode(200)
  logout(@Req() req: StudioRequest, @Res({ passthrough: true }) res: Response) {
    this.auth.logout(req.sessionHash);
    const options = { path: '/', secure: this.config.secureCookie, sameSite: 'strict' as const };
    res.clearCookie('studio_session', options);
    res.clearCookie('studio_csrf', options);
    return { ok: true };
  }
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('invitations/accept')
  @ApiBody({ schema: jsonSchema(invitationSchema) })
  async accept(@Body() body: unknown, @Req() req: StudioRequest, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.accept(parse(invitationSchema, body), req.user);
    const session = this.auth.createSession(user.id, req.cookies?.studio_session);
    this.cookies(res, session);
    return { user, csrfToken: session.csrfToken };
  }
}
