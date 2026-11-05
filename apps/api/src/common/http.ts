import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Request, Response } from 'express';
import { ZodError, ZodType } from 'zod';

export function fail(status: number, code: string, message: string, details?: unknown): never {
  throw new HttpException({ code, message, details }, status);
}
export function parse<T>(schema: ZodType<T>, input: unknown): T {
  return schema.parse(input);
}
export type CurrentUser = { id: string; email: string; name: string; instanceAdmin: boolean };
export interface StudioRequest extends Request {
  requestId: string;
  user: CurrentUser;
  sessionHash: string;
}
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<StudioRequest>();
    let status = 500;
    let body: Record<string, unknown> = { code: 'INTERNAL_ERROR', message: '服务器暂时无法处理请求' };
    if (error instanceof ZodError) {
      status = 400;
      body = {
        code: 'VALIDATION_ERROR',
        message: '输入内容不符合要求',
        details: error.issues.map((x) => ({ path: x.path.join('.'), message: x.message })),
      };
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      const response = error.getResponse();
      body =
        typeof response === 'object'
          ? { code: `HTTP_${status}`, ...response }
          : { code: `HTTP_${status}`, message: response };
    } else {
      // Drizzle wraps SQLite errors in a cause; never return SQL or bound values.
      const cause =
        (error as { cause?: { code?: string }; code?: string })?.cause || (error as { code?: string });
      const parserError = error as { type?: string };
      if (parserError?.type === 'entity.parse.failed') {
        status = 400;
        body = { code: 'INVALID_JSON', message: '请求必须是有效 JSON' };
      } else if (parserError?.type === 'entity.too.large') {
        status = 413;
        body = { code: 'PAYLOAD_TOO_LARGE', message: '请求内容过大' };
      } else if (cause?.code?.startsWith('SQLITE_CONSTRAINT')) {
        status = 409;
        body = { code: 'DATA_CONFLICT', message: '编号、邮箱或关联数据发生冲突' };
      } else console.error(JSON.stringify({ event: 'request_failed', requestId: req.requestId }));
    }
    ctx
      .getResponse<Response>()
      .status(status)
      .json({ ...body, requestId: req.requestId });
  }
}
