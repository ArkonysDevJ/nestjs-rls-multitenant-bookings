// apps/api/src/app.module.ts
// [F-ID: SRC-APP-MODULE-01]
// @version 1.2.0
// @changelog 1.2.0 — Register HealthModule (GET /v1/health). Backs
//   the Supabase keep-alive automation
//   (.github/workflows/keep-alive.yml): an unattended scheduler pings
//   it every few days so the free-tier project never accumulates the
//   ~7 days of inactivity that triggers an auto-pause. Deliberately
//   outside AuthGuard/TenantGuard/RolesGuard -- see
//   HealthController/HealthService for why.
// @changelog 1.1.0 — Added ConfigModule.forRoot({ isGlobal: true }).
//   Missing since 1.0.0: nothing in this project ever loaded .env into
//   process.env — `nest start` does not do this on its own. The server
//   booted fine either way (bootstrap() never touches Supabase), so the
//   gap only surfaced as a 500 on the first authenticated request, which
//   made it look like a runtime env problem rather than a missing loader.
// @changelog 1.0.0 — Root module wiring tenants, members, resources and bookings.

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TenantsModule } from './tenants/tenants.module';
import { MembersModule } from './members/members.module';
import { ResourcesModule } from './resources/resources.module';
import { BookingsModule } from './bookings/bookings.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TenantsModule,
    MembersModule,
    ResourcesModule,
    BookingsModule,
    HealthModule,
  ],
})
export class AppModule {}
