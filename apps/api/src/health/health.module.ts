// apps/api/src/health/health.module.ts
// [F-ID: SRC-HEALTH-MODULE-01]
// @version 1.0.0
// @changelog 1.0.0 — Standalone module for GET /v1/health (the
//   Supabase keep-alive endpoint). No exports -- nothing else in the
//   app needs HealthService.

import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
