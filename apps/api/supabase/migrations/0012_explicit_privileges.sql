-- apps/api/supabase/migrations/0012_explicit_privileges.sql
--
-- Fix every privilege in the migrations instead of relying on the default of
-- each environment, and move the creation of tenants and members out of the
-- database and into the API.
--
-- Why. The tables were reachable with different privileges depending on where
-- the database ran: the local stack and CI gave anon and authenticated full DML
-- on every new table through default privileges, while the hosted project gives
-- authenticated select and insert and anon almost nothing. A green local run did
-- not prove what the hosted project allowed. After this migration the catalog
-- for anon and authenticated is the same everywhere, for the objects below.
--
-- What changes.
--
--   Tables       anon and authenticated lose every privilege on tenants,
--                members, resources and bookings (including TRUNCATE,
--                REFERENCES, TRIGGER and MAINTAIN, which row-level security
--                does not govern). authenticated then gets back exactly what
--                it uses:
--                  select on all four tables
--                  insert on resources and bookings
--                  update on bookings (status) only
--                anon gets nothing. service_role keeps the grant of 0001.
--
--   Defaults     Objects that postgres creates later in public no longer get
--                grants for anon, authenticated or service_role (tables,
--                sequences, functions), so a new object without an explicit
--                grant fails the same way everywhere. EXECUTE on functions is
--                also no longer granted to PUBLIC by default, for functions
--                that postgres creates in any schema. The global form is
--                deliberate: PostgreSQL does not apply `in schema` to a global
--                default.
--
--   Sign-up      The policies authenticated_can_create_tenants and
--                bootstrap_owner_or_owner_invites_member are dropped, and
--                authenticated can no longer insert into tenants or members.
--                Tenants and members are created only by the API, which uses
--                the service role. The authorization of the sign-up (who may
--                invite, the cap on owned tenants) lives in the API code and is
--                tested there.
--
--   Functions    tenant_has_members(uuid) and owned_tenant_count() were only
--                used by the dropped policies. EXECUTE is revoked from PUBLIC,
--                anon and authenticated; postgres and service_role keep it.
--
--   Policies     The seven remaining policies declare `to authenticated`. None
--                is left on a command authenticated does not hold.
--
-- Two facts about earlier migrations, recorded here because those files are not
-- edited:
--
--   * The changelog of 0003 (1.1.0) describes the visibility problem of the
--     first draft of the bootstrap check, which a security definer helper
--     fixed. It does not describe a recursion. The invite branch of
--     bootstrap_owner_or_owner_invites_member selects from members inside a
--     policy on members, and PostgreSQL rejects that when it rewrites any
--     INSERT on the table (SQLSTATE 42P17, "infinite recursion detected in
--     policy for relation members"). It was already there when 0003 was
--     written, and every INSERT on members by anon or authenticated has failed
--     since. 0006 and 0007 changed the bootstrap branch only.
--
--   * 0011 says Supabase grants EXECUTE on every new function to anon,
--     authenticated and service_role. That holds for the local stack only.
--
-- Not covered: objects in public that belong to an extension. btree_gist is
-- installed in public by 0001; its functions, types and operators are owned by
-- supabase_admin and are left as they are.
--
-- Safe to run more than once.

begin;

-- Fail loudly, before changing anything, if an object this migration alters is
-- not what it expects.
do $$
declare
  missing text[] := '{}';
  t text;
  p record;
begin
  foreach t in array array['tenants', 'members', 'resources', 'bookings'] loop
    if to_regclass('public.' || t) is null then
      missing := missing || ('table public.' || t);
    end if;
  end loop;

  foreach t in array array[
    'public.tenant_has_members(uuid)',
    'public.owned_tenant_count()',
    'public.find_user_id_by_email(text)',
    'public.ping()'
  ] loop
    if to_regprocedure(t) is null then
      missing := missing || ('function ' || t);
    end if;
  end loop;

  for p in
    select * from (values
      ('members',   'members_see_own_membership'),
      ('tenants',   'members_see_own_tenants'),
      ('resources', 'tenant_isolation_resources'),
      ('resources', 'owner_can_create_resources'),
      ('bookings',  'tenant_isolation_bookings_select'),
      ('bookings',  'staff_can_create_bookings'),
      ('bookings',  'owner_can_cancel_bookings')
    ) as v(tbl, pol)
  loop
    if not exists (
      select 1 from pg_policy pp
      where pp.polrelid = to_regclass('public.' || p.tbl) and pp.polname = p.pol
    ) then
      missing := missing || ('policy ' || p.pol || ' on public.' || p.tbl);
    end if;
  end loop;

  if cardinality(missing) > 0 then
    raise exception 'unexpected schema, missing: %', array_to_string(missing, ', ');
  end if;
end
$$;

-- ─── Sign-up goes through the API only ──────────────────────────────────

drop policy if exists "authenticated_can_create_tenants" on public.tenants;
drop policy if exists "bootstrap_owner_or_owner_invites_member" on public.members;

revoke execute on function public.tenant_has_members(uuid) from public, anon, authenticated;
revoke execute on function public.owned_tenant_count() from public, anon, authenticated;
grant execute on function public.tenant_has_members(uuid) to service_role;
grant execute on function public.owned_tenant_count() to service_role;

-- ─── Tables ─────────────────────────────────────────────────────────────

revoke all on table public.tenants, public.members, public.resources, public.bookings
  from anon, authenticated;

grant select on public.tenants, public.members, public.resources, public.bookings
  to authenticated;
grant insert on public.resources, public.bookings to authenticated;
grant update (status) on public.bookings to authenticated;

-- ─── Defaults for objects postgres creates later ────────────────────────

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated, service_role;

alter default privileges for role postgres
  revoke execute on functions from public;

-- ─── Policies apply to authenticated only ───────────────────────────────

alter policy "members_see_own_membership" on public.members to authenticated;
alter policy "members_see_own_tenants" on public.tenants to authenticated;
alter policy "tenant_isolation_resources" on public.resources to authenticated;
alter policy "owner_can_create_resources" on public.resources to authenticated;
alter policy "tenant_isolation_bookings_select" on public.bookings to authenticated;
alter policy "staff_can_create_bookings" on public.bookings to authenticated;
alter policy "owner_can_cancel_bookings" on public.bookings to authenticated;

commit;
