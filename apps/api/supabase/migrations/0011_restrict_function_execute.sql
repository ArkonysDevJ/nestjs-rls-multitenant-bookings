-- apps/api/supabase/migrations/0011_restrict_function_execute.sql
--
-- Restrict who may call each public function.
--
-- Supabase grants EXECUTE on every new function in the public schema to anon,
-- authenticated and service_role explicitly (default privileges), and
-- `revoke all ... from public` does not remove grants made to those roles. The
-- earlier migrations revoked from public and granted to one role, but the
-- default grants stayed, so these functions were callable through PostgREST by
-- roles they were not meant for, with nothing more than the project's public
-- key.
--
--   find_user_id_by_email(text)  service_role only. The API resolves invitees
--                                with it; exposed to anyone it would answer
--                                "does an account exist for this email".
--   ping()                       service_role only. Backs GET /v1/health.
--   tenant_has_members(uuid)     authenticated and service_role. An RLS policy
--                                calls it, and policies run as the caller, so
--                                authenticated must keep it. Not anon.
--   owned_tenant_count()         authenticated and service_role, for the same
--                                reason. Not anon.
--
-- Safe to run more than once.

begin;

revoke execute on function public.find_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.find_user_id_by_email(text) to service_role;

revoke execute on function public.ping() from public, anon, authenticated;
grant execute on function public.ping() to service_role;

revoke execute on function public.tenant_has_members(uuid) from public, anon;
grant execute on function public.tenant_has_members(uuid) to authenticated, service_role;

revoke execute on function public.owned_tenant_count() from public, anon;
grant execute on function public.owned_tenant_count() to authenticated, service_role;

commit;
