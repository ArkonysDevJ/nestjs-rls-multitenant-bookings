// apps/api/src/main.ts
// [F-ID: SRC-MAIN-01]
// @version 1.1.0
// @changelog 1.1.0 — Fixed a real CORS gap: @fastify/cors (what
//   enableCors() configures under the Fastify adapter) only allows the
//   CORS-safelisted methods by default — GET, HEAD, POST. PATCH was
//   never actually enabled, so every PATCH /bookings/:id/cancel request
//   failed its preflight and the browser reported it as a generic
//   NetworkError, indistinguishable from the backend being down. Only
//   surfaced once cancel was exercised for the first time — POST-only
//   testing never would have caught it.
// @changelog 1.0.0 — Bootstrap Fastify app: global validation, exception filter, /v1 prefix.

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  app.enableCors({
    methods: ['GET', 'POST', 'PATCH'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.setGlobalPrefix('v1');

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port, '0.0.0.0');
}

bootstrap();
