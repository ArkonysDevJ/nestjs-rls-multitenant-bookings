-- apps/api/supabase/migrations/0003_self_serve_membership.sql
-- [F-ID: SQL-0003-SELF-SERVE-MEMBERSHIP]
-- @version 1.1.0
-- @changelog 1.1.0 — Fixed a real RLS recursion bug found while writing
--   this migration, before it ever ran anywhere: the bootstrap check
--   originally did `not exists (select 1 from members existing where
--   existing.tenant_id = members.tenant_id)` directly inside the
--   `members` INSERT policy. That subquery is itself subject to the
--   `members_see_own_membership` SELECT policy (user_id = auth.uid()),
--   so under a direct-JWT connection the caller could never see any
--   *other* user's membership row — the `not exists` would incorrectly
--   evaluate true even for a tenant that already has an owner, letting
--   a second caller insert themselves as 'owner' too. Fixed by moving
--   the existence check into a `security definer` helper function
--   (tenant_has_members), the standard Supabase pattern for breaking
--   this exact RLS-recursion problem on membership tables: the function
--   runs as its owner (postgres) and its internal query bypasses RLS,
--   so it sees the true row count regardless of the caller's own
--   visibility.
-- @changelog 1.0.0 — Adds INSERT policies for self-service tenant
--   creation and member invitation. Before this migration, tenants and
--   members had SELECT-only policies/grants — the only way to bootstrap
--   a tenant was a manual INSERT run by a developer, which is not a
--   real demo flow. Two new write paths, both still going through the
--   backend's service role for the actual UI, but with their own RLS
--   policies (the same "second barrier" discipline already applied to
--   bookings) in case anything ever hits these tables with a direct
--   user JWT instead:
--     (a) tenants: any authenticated user may create a new tenant —
--         there is no existing state to check against for a brand new
--         tenant, so the check is simply `true`.
--     (b) members: two disjoint cases in one policy —
--         - bootstrap: a user may insert themselves as 'owner' of a
--           tenant that currently has zero members. This is what makes
--           tenant creation self-service: the creator becomes owner by
--           being the first (and only possible) member at that moment.
--         - invite: an existing owner of a tenant may insert 'staff' or
--           'viewer' members into that same tenant. Owners cannot invite
--           other owners through this policy — multi-owner support is
--           out of scope for this demo.

begin;

grant insert on tenants to authenticated;
grant insert on members to authenticated;

-- security definer: deliberately bypasses RLS on `members` to answer
-- "does this tenant have any members at all" regardless of what the
-- calling user is themselves allowed to see via members_see_own_membership.
-- Never exposed as a public API route -- only referenced from the RLS
-- policy below.
create or replace function public.tenant_has_members(check_tenant_id uuid)
returns boolean
language sql
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from members where tenant_id = check_tenant_id
  );
$$;

revoke all on function public.tenant_has_members(uuid) from public;
grant execute on function public.tenant_has_members(uuid) to authenticated;

drop policy if exists "authenticated_can_create_tenants" on tenants;
create policy "authenticated_can_create_tenants"
  on tenants for insert
  with check (true);

drop policy if exists "bootstrap_owner_or_owner_invites_member" on members;
create policy "bootstrap_owner_or_owner_invites_member"
  on members for insert
  with check (
    (
      -- Bootstrap: caller claims 'owner' on a tenant with no members yet.
      role = 'owner'
      and user_id = (select auth.uid())
      and not public.tenant_has_members(tenant_id)
    )
    or (
      -- Invite: an existing owner adds a non-owner member.
      role in ('staff', 'viewer')
      and tenant_id in (
        select tenant_id from members owner_row
        where owner_row.user_id = (select auth.uid())
          and owner_row.role = 'owner'
      )
    )
  );

commit;
