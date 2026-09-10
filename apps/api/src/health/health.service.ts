// apps/api/src/health/health.service.ts
// [F-ID: SRC-HEALTH-SERVICE-01]
// @version 1.0.0
// @changelog 1.0.0 — Backs GET /v1/health (Supabase keep-alive
//   automation, see .github/workflows/keep-alive.yml). Reuses the
//   same getSupabaseAdminClient() singleton every other module in
//   this backend already uses -- no new client, no new secret, no
//   WebSocket-transport workaround to duplicate (that's already
//   handled once in supabase.client.ts).
//
//   Calls public.ping() (supabase/migrations/0008_health_ping.sql)
//   instead of touching tenants/members/resources/bookings directly:
//   this client authenticates as service_role, which bypasses RLS
//   entirely (see supabase.client.ts's own doc comment -- "no defense
//   in depth" is this project's accepted risk model for that key), so
//   an unauthenticated liveness endpoint should never be the thing
//   that queries a real business table with it. A dedicated no-op
//   function can't leak tenant data today, and can't start leaking it
//   after some future schema change either.
//
//   Lesson carried over from nestjs-ai-provider-finance's first
//   version of this same endpoint, which queried a table directly and
//   turned out to depend on grants nobody had actually checked --
//   applied here from the start instead of after a production 503.

import { Injectable } from '@nestjs/common';
import { getSupabaseAdminClient } from '../common/supabase/supabase.client';

export interface HealthStatus {
  status: 'ok';
  database: 'reachable';
  timestamp: string;
}

@Injectable()
export class HealthService {
  async check(): Promise<HealthStatus> {
    const supabase = getSupabaseAdminClient();
    const { error } = await supabase.rpc('ping');

    if (error) {
      throw error;
    }

    return {
      status: 'ok',
      database: 'reachable',
      timestamp: new Date().toISOString(),
    };
  }
}
