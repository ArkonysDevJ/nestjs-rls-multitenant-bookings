-- apps/api/supabase/migrations/0004_member_lookup_by_email.sql
-- [F-ID: SQL-0004-MEMBER-LOOKUP-BY-EMAIL]
-- @version 1.0.0
-- @changelog 1.0.0 — Replaces the "invite by raw user id" flow with
--   "invite by email", which is what an owner actually has on hand.
--   supabase-js has no admin.getUserByEmail() (only listUsers with
--   page/perPage, no email filter, capped at 50 users per page — not
--   viable even for this small demo without extra pagination code), and
--   `auth` is not an exposed PostgREST schema, so it cannot be queried
--   directly via the anon/service REST interface either.
--
--   find_user_id_by_email() is a security definer function so its body
--   can read auth.users directly at the SQL level. Deliberately NOT
--   granted to `authenticated`, only to `service_role`: unlike the
--   tenant/member INSERT policies in 0003 (which intentionally also
--   cover the direct-JWT path as a second barrier), an email-lookup
--   function is an email-enumeration oracle if any authenticated user
--   can call it — "does this email exist in this system" is exactly the
--   kind of information that should only ever be resolved server-side,
--   as part of an authorization-checked invite flow, never as a
--   standalone callable. This is a deliberate asymmetry with 0003, not
--   an oversight.

begin;

create or replace function public.find_user_id_by_email(lookup_email text)
returns uuid
language sql
security definer
set search_path = public, pg_catalog
as $$
  select id from auth.users where email = lookup_email limit 1;
$$;

revoke all on function public.find_user_id_by_email(text) from public;
grant execute on function public.find_user_id_by_email(text) to service_role;

commit;
