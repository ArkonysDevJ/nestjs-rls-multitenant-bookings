-- apps/api/supabase/migrations/0008_health_ping.sql
-- ════════════════════════════════════════════════════════════════
-- [F-ID: SQL-0008-HEALTH-PING]
-- @project     nestjs-rls-multitenant-bookings (portfolio)
-- @description Dedicated health-check primitive for GET /v1/health
--              (Supabase keep-alive automation, see
--              .github/workflows/keep-alive.yml). The backend
--              authenticates to Supabase as service_role
--              (see supabase.client.ts), which bypasses RLS entirely
--              and already has full default privileges on every
--              table in this schema -- exactly why the health check
--              must NOT query tenants/members/resources/bookings
--              directly. This function returns nothing but `true`
--              and touches no business table, so an unauthenticated
--              liveness endpoint can never become a way to read real
--              tenant data, today or after any future schema change.
--              Same pattern as nestjs-ai-provider-finance's
--              public.ping() -- there it fixed a real bug (the anon
--              key had no grant on categories); here it's applied
--              from the start as a precaution, since service_role's
--              blast radius if misused is much larger than anon's.
--              GRANT EXECUTE to service_role is technically redundant
--              (that role already has it by default, same as every
--              other table here that was never explicitly granted to
--              it either) but stated for clarity, not correctness.
-- @version     1.0.0
-- @changelog   1.0.0 — Initial creation.
-- ════════════════════════════════════════════════════════════════

begin;

create or replace function public.ping()
returns boolean
language sql
security definer
set search_path = public
as $$
  select true;
$$;

grant execute on function public.ping() to service_role;

commit;
