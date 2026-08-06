// apps/api/src/resources/resources.module.ts
// [F-ID: SRC-RESOURCES-MODULE-01]
// @version 1.1.0
// @changelog 1.1.0 — Added RolesGuard for the new owner-gated POST /resources.
// @changelog 1.0.0 — Wires ResourcesController + ResourcesService + TenantGuard.

import { Module } from '@nestjs/common';
import { MembersModule } from '../members/members.module';
import { ResourcesController } from './resources.controller';
import { ResourcesService } from './resources.service';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';

@Module({
  imports: [MembersModule],
  controllers: [ResourcesController],
  providers: [ResourcesService, TenantGuard, RolesGuard],
})
export class ResourcesModule {}
