// apps/api/src/resources/resources.controller.ts
// [F-ID: SRC-RESOURCES-CONTROLLER-01]
// @version 1.1.0
// @changelog 1.1.0 — POST /resources, gated to 'owner' via @Roles() +
//   RolesGuard — the same pattern as BookingsController. Resources were
//   previously provisioned only via seed SQL; this makes tenant setup
//   possible entirely through the app, and makes the ownership
//   boundary visible in the UI itself (only owners see the form).
// @changelog 1.0.0 — GET /resources — active tenant's bookable resources.

import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { ResourcesService, Resource } from './resources.service';
import { CreateResourceDto } from './dto/create-resource.dto';

@Controller('resources')
@UseGuards(TenantGuard, RolesGuard)
export class ResourcesController {
  constructor(private readonly resourcesService: ResourcesService) {}

  @Get()
  async list(@Req() request: FastifyRequest): Promise<Resource[]> {
    const { tenantId } = request.tenantContext!;
    return this.resourcesService.listForTenant(tenantId);
  }

  @Post()
  @Roles('owner')
  async create(
    @Req() request: FastifyRequest,
    @Body() dto: CreateResourceDto,
  ): Promise<Resource> {
    const { tenantId } = request.tenantContext!;
    return this.resourcesService.create(tenantId, dto);
  }
}
