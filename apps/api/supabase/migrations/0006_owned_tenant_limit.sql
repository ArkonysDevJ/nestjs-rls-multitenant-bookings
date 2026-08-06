-- apps/api/supabase/migrations/0006_owned_tenant_limit.sql
-- [F-ID: SQL-0006-OWNED-TENANT-LIMIT]
-- @version 1.0.0
-- @changelog 1.0.0 — Caps self-service tenant creation at 5 owned
--   tenants per user (anti-abuse for a public demo where sign-up and
--   tenant creation are both wide open). Same "second barrier"
--   discipline as everywhere else in this schema: enforced in the
--   backend (TenantsService.createTenant, see @nestjs/common
--   ForbiddenException) AND independently here in RLS, via the same
--   security-definer pattern as tenant_has_members (0003) — the count
--   must be read without being subject to members_see_own_membership,
--   which would otherwise only let a caller see their OWN membership
--   rows anyway (harmless here since we're counting the caller's own
--   owned tenants, but kept consistent with the established pattern
--   rather than relying on that coincidence).
--
--   Only the bootstrap (owner) branch of bootstrap_owner_or_owner_invites_member
--   gets the cap — inviting/being invited as staff or viewer never
--   counts against it, since that's not tenant creation.

begin;

create or replace function public.owned_tenant_count(check_user_id uuid)
returns bigint
language sql
security definer
set search_path = public, pg_catalog
as $$
  select count(*) from members
  where user_id = check_user_id and role = 'owner';
$$;

revoke all on function public.owned_tenant_count(uuid) from public;
grant execute on function public.owned_tenant_count(uuid) to authenticated;

drop policy if exists "bootstrap_owner_or_owner_invites_member" on members;
create policy "bootstrap_owner_or_owner_invites_member"
  on members for insert
  with check (
    (
      -- Bootstrap: caller claims 'owner' on a tenant with no members
      -- yet, and doesn't already own 5 or more tenants.
      role = 'owner'
      and user_id = (select auth.uid())
      and not public.tenant_has_members(tenant_id)
      and public.owned_tenant_count((select auth.uid())) < 5
    )
    or (
      -- Invite: an existing owner adds a non-owner member. Not capped —
      -- the limit is on tenants you OWN, not on total memberships.
      role in ('staff', 'viewer')
      and tenant_id in (
        select tenant_id from members owner_row
        where owner_row.user_id = (select auth.uid())
          and owner_row.role = 'owner'
      )
    )
  );

commit;
