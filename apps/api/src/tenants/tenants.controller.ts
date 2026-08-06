// apps/api/src/tenants/tenants.controller.ts
// [F-ID: SRC-TENANTS-CONTROLLER-01]
// @version 1.1.0
// @changelog 1.1.0 — POST /tenants: self-service tenant creation. Same
//   pre-tenant-selection guarding as GET /tenants/me (AuthGuard only) —
//   creating a tenant is, by definition, something you do before you
//   have one to select.
// @changelog 1.0.0 — GET /tenants/me — tenant switcher data, JWT-only (no active tenant yet).

import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { AuthGuard } from '../common/guards/auth.guard';
import { TenantsService, TenantSummary } from './tenants.service';
import { CreateTenantDto } from './dto/create-tenant.dto';

/**
 * Pre-tenant-selection routes: the caller is authenticated but hasn't
 * picked an active tenant yet, so these only require AuthGuard, not
 * TenantGuard. Used by the frontend to render a tenant switcher and to
 * bootstrap a brand new tenant.
 */
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get('me')
  @UseGuards(AuthGuard)
  async listMyTenants(
    @Req() request: FastifyRequest,
  ): Promise<TenantSummary[]> {
    return this.tenantsService.listTenantsForUser(request.userId as string);
  }

  @Post()
  @UseGuards(AuthGuard)
  async createTenant(
    @Req() request: FastifyRequest,
    @Body() dto: CreateTenantDto,
  ): Promise<TenantSummary> {
    return this.tenantsService.createTenant(request.userId as string, dto.name);
  }
}
