import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { HttpException } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { json, NextFunction, Response } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module';
import { AppConfig } from './config';
import { ApiExceptionFilter, StudioRequest } from './common/http';

export async function createApplication() {
  const app = await NestFactory.create(AppModule, { bodyParser: false, logger: ['warn', 'error'] });
  const config = app.get(AppConfig);
  app.use((req: StudioRequest, res: import('express').Response, next: () => void) => {
    req.requestId = randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(helmet());
  app.use(cookieParser());
  app.use(json({ limit: '256kb' }));
  // Translate parser failures before the Express adapter strips their machine-readable type.
  app.use((error: { type?: string }, _req: StudioRequest, _res: Response, next: NextFunction) => {
    if (error.type === 'entity.parse.failed')
      return next(new HttpException({ code: 'INVALID_JSON', message: '请求必须是有效 JSON' }, 400));
    if (error.type === 'entity.too.large')
      return next(new HttpException({ code: 'PAYLOAD_TOO_LARGE', message: '请求内容过大' }, 413));
    next(error);
  });
  app.enableCors({
    origin: config.origins,
    credentials: true,
    allowedHeaders: ['Content-Type', 'X-Studio-Request', 'X-CSRF-Token', 'Idempotency-Key'],
  });
  app.useGlobalFilters(new ApiExceptionFilter());
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Pullet Studio API')
      .setVersion('0.1.0')
      .setDescription(
        'M1 foundation. Mutations require X-Studio-Request: 1, and authenticated mutations also require X-CSRF-Token from login/me.',
      )
      .addCookieAuth('studio_session')
      .build(),
  );
  SwaggerModule.setup('api/docs', app, document, { jsonDocumentUrl: '/openapi.json' });
  app.enableShutdownHooks();
  return app;
}
