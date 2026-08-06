// apps/api/src/tenants/tenants.service.ts
// [F-ID: SRC-TENANTS-SERVICE-01]
// @version 1.2.0
// @changelog 1.2.0 — createTenant now rejects with 403 once the caller
//   already owns MAX_OWNED_TENANTS tenants. Anti-abuse for a public demo
//   with open sign-up + open tenant creation, not a tenant-isolation
//   security boundary — but enforced the same way as everything else in
//   this file: app-layer check here, independently re-enforced in RLS
//   (migration 0006's owned_tenant_count() + updated bootstrap policy)
//   for the direct-JWT path.
// @changelog 1.1.0 — Added createTenant: inserts the tenant row, then the
//   caller's own 'owner' membership row, via two sequential service-role
//   calls (no multi-table transaction available through supabase-js).
//   If the membership insert fails, the tenant row is deleted so we
//   never leave an ownerless tenant behind. The RLS side of this same
//   invariant lives in migration 0003 (bootstrap_owner_or_owner_invites_member)
//   for the direct-JWT path; this service call always uses the service
//   role, so it isn't itself subject to those policies, but the
//   invariant it enforces is the same one.
// @changelog 1.0.0 — Lists tenants a given user belongs to, with their role in each.

import { ForbiddenException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { getSupabaseAdminClient } from '../common/supabase/supabase.client';
import { MembersService } from '../members/members.service';

export interface TenantSummary {
  id: string;
  name: string;
  role: string;
}

const MAX_OWNED_TENANTS = 5;

@Injectable()
export class TenantsService {
  constructor(private readonly membersService: MembersService) {}

  async createTenant(userId: string, name: string): Promise<TenantSummary> {
    const supabase = getSupabaseAdminClient();

    const memberships = await this.membersService.findMembershipsForUser(userId);
    const ownedCount = memberships.filter((m) => m.role === 'owner').length;

    if (ownedCount >= MAX_OWNED_TENANTS) {
      throw new ForbiddenException(
        `You can own at most ${MAX_OWNED_TENANTS} tenants.`,
      );
    }

    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .insert({ name })
      .select('id, name')
      .single();

    if (tenantError || !tenant) {
      throw tenantError ?? new InternalServerErrorException('Failed to create tenant.');
    }

    const { error: memberError } = await supabase
      .from('members')
      .insert({ tenant_id: tenant.id, user_id: userId, role: 'owner' });

    if (memberError) {
      // Compensating delete: never leave an ownerless tenant behind.
      await supabase.from('tenants').delete().eq('id', tenant.id);
      throw memberError;
    }

    return { id: tenant.id, name: tenant.name, role: 'owner' };
  }

  async listTenantsForUser(userId: string): Promise<TenantSummary[]> {
    const memberships = await this.membersService.findMembershipsForUser(
      userId,
    );

    if (memberships.length === 0) {
      return [];
    }

    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase
      .from('tenants')
      .select('id, name')
      .in(
        'id',
        memberships.map((m) => m.tenantId),
      );

    if (error || !data) {
      return [];
    }

    const roleByTenant = new Map(
      memberships.map((m) => [m.tenantId, m.role]),
    );

    return data.map((tenant) => ({
      id: tenant.id,
      name: tenant.name,
      role: roleByTenant.get(tenant.id) ?? 'viewer',
    }));
  }
}
