// apps/api/src/tenants/tenants.module.ts
// [F-ID: SRC-TENANTS-MODULE-01]
// @version 1.0.0
// @changelog 1.0.0 — Wires TenantsController + TenantsService.

import { Module } from '@nestjs/common';
import { MembersModule } from '../members/members.module';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Module({
  imports: [MembersModule],
  controllers: [TenantsController],
  providers: [TenantsService],
})
export class TenantsModule {}
