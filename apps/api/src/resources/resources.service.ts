// apps/api/src/resources/resources.service.ts
// [F-ID: SRC-RESOURCES-SERVICE-01]
// @version 1.1.0
// @changelog 1.1.0 — Added create: owner-only (enforced by @Roles() on
//   the controller, and independently by the owner_can_create_resources
//   RLS policy in migration 0005). tenant_id always comes from
//   TenantContext, never from the DTO.
// @changelog 1.0.0 — Tenant-scoped resource reads. Every query carries the tenant_id filter.

import { Injectable } from '@nestjs/common';
import { getSupabaseAdminClient } from '../common/supabase/supabase.client';
import { CreateResourceDto } from './dto/create-resource.dto';

export interface Resource {
  id: string;
  name: string;
  capacity: number | null;
  active: boolean;
}

@Injectable()
export class ResourcesService {
  async create(tenantId: string, dto: CreateResourceDto): Promise<Resource> {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase
      .from('resources')
      .insert({
        tenant_id: tenantId,
        name: dto.name,
        capacity: dto.capacity ?? null,
      })
      .select('id, name, capacity, active')
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  /**
   * The service role key bypasses RLS entirely, so the tenant_id filter
   * below is not a convenience — it is the only thing standing between
   * this query and a cross-tenant data leak. Every query against an
   * operational table in this codebase must carry it.
   */
  async listForTenant(tenantId: string): Promise<Resource[]> {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase
      .from('resources')
      .select('id, name, capacity, active')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .order('name', { ascending: true });

    if (error) {
      throw error;
    }

    return data ?? [];
  }
}
