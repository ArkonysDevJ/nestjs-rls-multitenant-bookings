// apps/api/src/members/members.module.ts
// [F-ID: SRC-MEMBERS-MODULE-01]
// @version 1.1.0
// @changelog 1.1.0 — Wires MembersController (POST /members) + TenantGuard,
//   following the same self-import pattern as ResourcesModule/BookingsModule
//   (MembersModule imports itself is not needed here since MembersService
//   is a local provider, not re-imported from elsewhere).
// @changelog 1.0.0 — Exports MembersService for TenantGuard and TenantsService.

import { Module } from '@nestjs/common';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { TenantGuard } from '../common/guards/tenant.guard';

@Module({
  controllers: [MembersController],
  providers: [MembersService, TenantGuard],
  exports: [MembersService],
})
export class MembersModule {}
