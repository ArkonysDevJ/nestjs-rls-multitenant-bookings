-- apps/api/supabase/migrations/0005_owner_creates_resources.sql
-- [F-ID: SQL-0005-OWNER-CREATES-RESOURCES]
-- @version 1.0.0
-- @changelog 1.0.0 — Resources were select-only until now (grants and
--   RLS both), provisioned exclusively out-of-band via seed SQL. Adds
--   the same "second barrier" INSERT policy discipline already applied
--   to bookings (0001) and tenants/members (0003): an owner of a tenant
--   may create resources for that tenant, matching the new POST
--   /resources endpoint, which is gated to 'owner' via @Roles(). The
--   backend always uses the service role for the actual insert; this
--   policy is what protects the same table against a direct-JWT client.

begin;

grant insert on resources to authenticated;

drop policy if exists "owner_can_create_resources" on resources;
create policy "owner_can_create_resources"
  on resources for insert
  with check (
    tenant_id in (
      select tenant_id from members
      where user_id = (select auth.uid())
        and role = 'owner'
    )
  );

commit;
