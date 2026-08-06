// apps/api/src/members/members.controller.ts
// [F-ID: SRC-MEMBERS-CONTROLLER-01]
// @version 1.1.0
// @changelog 1.1.0 — Invite by email (see AddMemberDto 1.1.0 / MembersService 1.2.0).
// @changelog 1.0.0 — POST /members: an owner invites a staff/viewer into
//   the active tenant (resolved via TenantGuard from x-tenant-id, same
//   as bookings/resources — never from the request body). Gated to
//   'owner' via @Roles(), mirroring the RLS-side invariant in migration
//   0003 (an owner can only invite non-owner roles).

import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { MembersService, Membership } from './members.service';
import { AddMemberDto } from './dto/add-member.dto';

@Controller('members')
@UseGuards(TenantGuard, RolesGuard)
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  @Post()
  @Roles('owner')
  async addMember(
    @Req() request: FastifyRequest,
    @Body() dto: AddMemberDto,
  ): Promise<Membership> {
    const { tenantId } = request.tenantContext!;
    return this.membersService.addMember(tenantId, dto.email, dto.role);
  }
}
