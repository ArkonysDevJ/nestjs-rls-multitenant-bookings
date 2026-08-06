// apps/api/src/bookings/bookings.module.ts
// [F-ID: SRC-BOOKINGS-MODULE-01]
// @version 1.0.0
// @changelog 1.0.0 — Wires BookingsController + BookingsService + TenantGuard + RolesGuard.

import { Module } from '@nestjs/common';
import { MembersModule } from '../members/members.module';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';

@Module({
  imports: [MembersModule],
  controllers: [BookingsController],
  providers: [BookingsService, TenantGuard, RolesGuard],
})
export class BookingsModule {}
