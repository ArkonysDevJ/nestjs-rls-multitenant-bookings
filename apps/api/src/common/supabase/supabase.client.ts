// apps/api/src/common/supabase/supabase.client.ts
// [F-ID: SRC-COMMON-SUPABASE-CLIENT-01]
// @version 1.0.0
// @changelog 1.0.0 — Process-wide admin client singleton. Realtime transport disabled (see inline note).

import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Single shared Supabase client for the whole process.
 *
 * The backend never holds a per-request user session — it authenticates
 * every request via the incoming JWT and talks to Postgres with the
 * service role key. Row Level Security is bypassed by this key, so tenant
 * isolation must be enforced explicitly in every query (see the guards
 * in `common/guards` and the `tenant_id` filter in each service). On this
 * route there is no RLS defense in depth: a missing `tenant_id` filter is
 * a direct cross-tenant data leak. RLS only protects clients that query
 * Postgres directly with a user JWT.
 *
 * Realtime/websocket transport is disabled: this service never subscribes
 * to realtime channels, and leaving the transport enabled has been known
 * to keep an idle socket open that crashes long-running server processes
 * under some Node/undici combinations.
 */
let client: SupabaseClient | null = null;

export function getSupabaseAdminClient(): SupabaseClient {
  if (client) {
    return client;
  }

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to create the Supabase admin client.',
    );
  }

  client = createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    realtime: {
      // Disabled on purpose: no realtime usage on the backend, and an
      // active websocket transport here has caused process crashes in
      // long-running server deployments.
      transport: undefined,
    },
  });

  return client;
}
