// apps/api/src/health/health.controller.ts
// [F-ID: SRC-HEALTH-CONTROLLER-01]
// @version 1.0.0
// @changelog 1.0.0 — GET /v1/health. Deliberately unauthenticated and
//   outside AuthGuard/TenantGuard/RolesGuard entirely: it exists to
//   be pinged by an unattended scheduler
//   (.github/workflows/keep-alive.yml) every few days, purely to
//   generate real database activity and keep the free-tier Supabase
//   project from auto-pausing after ~7 days of inactivity. See
//   HealthService for why it calls a dedicated ping() function
//   instead of a real table. Returns 503 (not the generic 500
//   AllExceptionsFilter would produce for an unmapped error) on a
//   real DB failure, so an external `curl -f` correctly reports the
//   check as failed.

import {
  Controller,
  Get,
  HttpCode,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HealthService, HealthStatus } from './health.service';

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly healthService: HealthService) {}

  @Get()
  @HttpCode(200)
  async check(): Promise<HealthStatus> {
    try {
      return await this.healthService.check();
    } catch (error) {
      this.logger.error('Database unreachable', error as Error);
      throw new ServiceUnavailableException('Database unreachable');
    }
  }
}
