// apps/api/src/bookings/bookings.controller.ts
// [F-ID: SRC-BOOKINGS-CONTROLLER-01]
// @version 1.0.0
// @changelog 1.0.0 — POST/GET/PATCH /bookings — role-gated per action via @Roles().

import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { BookingsService, Booking } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { ListBookingsQueryDto } from './dto/list-bookings-query.dto';

@Controller('bookings')
@UseGuards(TenantGuard, RolesGuard)
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post()
  @Roles('owner', 'staff')
  async create(
    @Req() request: FastifyRequest,
    @Body() dto: CreateBookingDto,
  ): Promise<Booking> {
    const { tenantId, userId } = request.tenantContext!;
    return this.bookingsService.create(tenantId, userId, dto);
  }

  @Get()
  async list(
    @Req() request: FastifyRequest,
    @Query() query: ListBookingsQueryDto,
  ): Promise<Booking[]> {
    const { tenantId } = request.tenantContext!;
    return this.bookingsService.listForTenant(tenantId, query.resource_id);
  }

  @Patch(':id/cancel')
  @Roles('owner')
  async cancel(
    @Req() request: FastifyRequest,
    @Param('id') id: string,
  ): Promise<Booking> {
    const { tenantId } = request.tenantContext!;
    return this.bookingsService.cancel(tenantId, id);
  }
}
