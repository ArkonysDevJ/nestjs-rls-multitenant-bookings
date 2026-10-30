// apps/api/src/common/guards/tenant.guard.ts
// [F-ID: SRC-COMMON-GUARD-TENANT-01]
// @version 1.0.0
// @changelog 1.0.0 — Resolves caller identity + active tenant from JWT and x-tenant-id header.

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { getSupabaseAdminClient } from '../supabase/supabase.client';
import { TenantContext } from '../types/tenant-context';
import { MembersService } from '../../members/members.service';

/**
 * Resolves the caller's identity for every protected route.
 *
 * Two inputs, both mandatory:
 *   1. `Authorization: Bearer <jwt>` — verified against Supabase Auth to
 *      get the caller's user id. Never trusted from any other source.
 *   2. `x-tenant-id` header — the tenant the caller wants to act as. A
 *      user may belong to more than one tenant, so the active tenant is
 *      not implicit; it must be requested and then checked against the
 *      caller's actual memberships before anything else runs.
 *
 * The membership lookup (tenant_id + role) is the only thing this guard
 * trusts to build TenantContext. Nothing from the request body, query
 * string, or headers other than these two ever populates tenantId or
 * role. Downstream code reads request.tenantContext exclusively.
 */
declare module 'fastify' {
  interface FastifyRequest {
    tenantContext?: TenantContext;
  }
}

// Any UUID shape Postgres accepts, whatever its version (the seeded tenant ids
// are not version 4). A value that does not look like this can never match a
// membership, and sending it to the database would only fail there.
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly membersService: MembersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    const userId = await this.resolveUserId(request);
    const tenantId = this.resolveRequestedTenantId(request);

    const membership = await this.membersService.findMembership(
      tenantId,
      userId,
    );

    if (!membership) {
      throw new UnauthorizedException(
        'Caller is not a member of the requested tenant.',
      );
    }

    request.tenantContext = {
      userId,
      tenantId,
      role: membership.role,
    };

    return true;
  }

  private async resolveUserId(request: FastifyRequest): Promise<string> {
    const header = request.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token.');
    }

    const token = header.slice('Bearer '.length).trim();
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      throw new UnauthorizedException('Invalid or expired token.');
    }

    return data.user.id;
  }

  private resolveRequestedTenantId(request: FastifyRequest): string {
    const header = request.headers['x-tenant-id'];
    const tenantId = Array.isArray(header) ? header[0] : header;

    if (!tenantId) {
      throw new UnauthorizedException('Missing x-tenant-id header.');
    }

    if (!UUID_SHAPE.test(tenantId)) {
      throw new UnauthorizedException('Invalid x-tenant-id header.');
    }

    return tenantId;
  }
}
