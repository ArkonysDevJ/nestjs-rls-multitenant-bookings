// apps/api/src/members/members.service.ts
// [F-ID: SRC-MEMBERS-SERVICE-01]
// @version 1.3.0
// @changelog 1.3.0 — Fixed a real bug found via the concurrent-overlap
//   race test: findMembership/findMembershipsForUser treated ANY query
//   error the same as "no matching row" (`if (error || !data) return
//   null`), silently downgrading a transient Supabase/network failure
//   into "Caller is not a member of the requested tenant." — a 401 that
//   looks exactly like a real authorization denial. This surfaced during
//   the two-simultaneous-request race test: one request got a clean 409
//   from the exclusion constraint (proving it passed TenantGuard fine),
//   the other got rejected as a non-member with the SAME token and
//   TENANT_ID — impossible if the membership lookup were deterministic.
//   Every other service in this codebase (bookings, resources, tenants)
//   already does `if (error) throw error`, surfacing infra failures as
//   500s instead of swallowing them; this file was the one inconsistent
//   holdout. Now: error -> thrown (500 via AllExceptionsFilter), no
//   error + no row -> null (the actual "not a member" case).
// @changelog 1.2.0 — addMember now takes an email instead of a raw user
//   id: it resolves the id server-side via the find_user_id_by_email()
//   RPC (migration 0004) before inserting. Unknown email -> NotFoundException,
//   never a generic 500 — the owner needs to know "that person hasn't
//   signed up yet" is a different problem than a server error.
// @changelog 1.1.0 — Added addMember: invites a staff/viewer into the
//   caller's active tenant. Uniqueness (tenant_id, user_id) is enforced
//   by the table's own unique constraint, not checked here — a duplicate
//   invite surfaces as a 23505 Postgres error via AllExceptionsFilter.
// @changelog 1.0.0 — Membership lookups: single tenant/user pair and all tenants for a user.

import { Injectable, NotFoundException } from '@nestjs/common';
import { getSupabaseAdminClient } from '../common/supabase/supabase.client';
import { MemberRole } from '../common/decorators/roles.decorator';

export interface Membership {
  tenantId: string;
  role: MemberRole;
}

@Injectable()
export class MembersService {
  async addMember(
    tenantId: string,
    email: string,
    role: 'staff' | 'viewer',
  ): Promise<Membership> {
    const supabase = getSupabaseAdminClient();

    const { data: userId, error: lookupError } = await supabase.rpc(
      'find_user_id_by_email',
      { lookup_email: email },
    );

    if (lookupError) {
      throw lookupError;
    }

    if (!userId) {
      throw new NotFoundException(
        'No account found for that email. The invitee must sign up first.',
      );
    }

    const { data, error } = await supabase
      .from('members')
      .insert({ tenant_id: tenantId, user_id: userId, role })
      .select('tenant_id, role')
      .single();

    if (error) {
      throw error;
    }

    return { tenantId: data.tenant_id, role: data.role as MemberRole };
  }

  async findMembership(
    tenantId: string,
    userId: string,
  ): Promise<Membership | null> {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase
      .from('members')
      .select('tenant_id, role')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return null;
    }

    return { tenantId: data.tenant_id, role: data.role as MemberRole };
  }

  async findMembershipsForUser(userId: string): Promise<Membership[]> {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase
      .from('members')
      .select('tenant_id, role')
      .eq('user_id', userId);

    if (error) {
      throw error;
    }

    if (!data) {
      return [];
    }

    return data.map((row) => ({
      tenantId: row.tenant_id,
      role: row.role as MemberRole,
    }));
  }
}
