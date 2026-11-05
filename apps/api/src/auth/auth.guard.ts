import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppConfig } from '../config';
import { fail, StudioRequest } from '../common/http';
import { AuthService, publicUser } from './auth.service';
import { digest, equalSecret } from './password';

export const Public = () => SetMetadata('public', true);
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
    private readonly config: AppConfig,
  ) {}
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<StudioRequest>();
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (unsafe) {
      if (req.headers.origin && !this.config.origins.includes(req.headers.origin))
        fail(403, 'ORIGIN_DENIED', '请求来源未获允许');
      if (req.headers['x-studio-request'] !== '1') fail(403, 'CSRF_REQUIRED', '缺少请求保护头');
    }
    const session =
      typeof req.cookies?.studio_session === 'string' && this.auth.session(req.cookies.studio_session);
    if (session) {
      req.user = publicUser(session.user);
      req.sessionHash = session.session.tokenHash;
      if (unsafe && !equalSecret(digest(String(req.headers['x-csrf-token'] || '')), session.session.csrfHash))
        fail(403, 'CSRF_INVALID', '请求保护令牌无效，请重新登录');
    }
    if (
      !session &&
      !this.reflector.getAllAndOverride<boolean>('public', [context.getHandler(), context.getClass()])
    )
      fail(401, 'AUTH_REQUIRED', '请先登录');
    return true;
  }
}
