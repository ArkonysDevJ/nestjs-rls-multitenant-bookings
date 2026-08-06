-- apps/api/supabase/migrations/0001_init.sql
-- [F-ID: SQL-0001-INIT]
-- @version 1.5.0
-- @changelog 1.5.0 — Fixed exclusion constraint: tsrange() → tstzrange().
--   tsrange is for `timestamp without time zone`; starts_at/ends_at are
--   `timestamptz`. Never caught until the first real apply against a
--   live Postgres instance — no local Postgres to test against earlier
--   in this project. tsc/build checks can't catch invalid SQL function
--   calls; only actually running the migration does.
-- @changelog 1.4.0 — tenant_isolation_resources narrowed from `for all`
--   to `for select`, matching the actual grant (authenticated only has
--   SELECT on resources). The broader policy was unreachable dead code,
--   not a hole, but claimed more than the grants ever allowed.
-- @changelog 1.3.0 — staff_can_create_bookings now also requires
--   created_by = (select auth.uid()). Found while writing the pgTAP
--   suite: the policy checked tenant membership + role but never
--   checked who the caller claims to be, so a staff/owner JWT could
--   insert a booking with created_by set to any uid. The backend was
--   never exposed to this (DTO has no created_by field), but the
--   direct-JWT path was.
-- @changelog 1.2.0 — Explicit GRANTs to authenticated/service_role on
--   all 4 tables. RLS restricts *which rows* a role can see; GRANT
--   restricts *which operations* a role can attempt at all. Without
--   the INSERT/UPDATE grants below, `authenticated` would get a plain
--   permission-denied error before RLS is ever evaluated — silently
--   invalidating the pgTAP suite's insert/update tests (they'd fail
--   for the wrong reason) and leaving the "second barrier" path with
--   no operations to actually protect.
-- @changelog 1.1.0 — RLS hardening pass:
--   (a) FORCE ROW LEVEL SECURITY on all 4 tables. Without FORCE, a
--       table owner connection bypasses every policy below even with
--       RLS enabled — the single most common footgun in Postgres RLS
--       write-ups. Our backend uses the service role (bypasses RLS
--       regardless), so this matters specifically for the "second
--       barrier" claim: any other client connecting as the table
--       owner would otherwise silently skip these policies too.
--   (b) auth.uid() wrapped as (select auth.uid()) in every policy.
--       Unwrapped, Postgres calls it once per row; wrapped, the
--       planner caches it once per statement via initPlan. Documented
--       100x+ difference on large tables.
--   (c) Added members_see_own_membership SELECT policy. Every policy
--       below on tenants/resources/bookings depends on a subquery
--       against `members`. That subquery runs under the *caller's*
--       RLS, not the policy owner's — with members RLS enabled and
--       zero SELECT policy on it (the state before this version), the
--       subquery always returned 0 rows, so every dependent policy
--       silently denied everyone. Not a leak (fails closed), but it
--       meant the "second barrier" was actually inert for the
--       user-JWT path, and would have hidden real access as a false
--       negative in the pgTAP suite.
-- @changelog 1.0.0 — Core schema: tenants, memberships, resources,
--            bookings, RLS policies, no-overlap exclusion constraint.
--
-- Core schema for the multi-tenant bookings demo: tenants, memberships,
-- bookable resources, and bookings, with tenant isolation and a
-- no-double-booking guarantee enforced at the database level.

begin;

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('owner', 'staff', 'viewer')),
  unique (tenant_id, user_id)
);

create table if not exists resources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  capacity int,
  active boolean not null default true
);

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  resource_id uuid not null references resources(id),
  created_by uuid not null references auth.users(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'confirmed'
    check (status in ('confirmed', 'cancelled')),
  created_at timestamptz not null default now(),
  constraint valid_range check (ends_at > starts_at)
);

-- Guarantees no two confirmed bookings for the same resource can overlap
-- in time, enforced by Postgres itself at insert/update time — not by
-- application logic, which cannot be made race-free against concurrent
-- requests without this.
alter table bookings
  drop constraint if exists no_overlapping_bookings;

alter table bookings add constraint no_overlapping_bookings
  exclude using gist (
    resource_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status = 'confirmed');

create index if not exists bookings_tenant_id_idx on bookings (tenant_id);
create index if not exists bookings_resource_id_idx on bookings (resource_id);
create index if not exists resources_tenant_id_idx on resources (tenant_id);
create index if not exists members_user_id_idx on members (user_id);

-- Row Level Security ---------------------------------------------------
-- The backend connects with the service role key, which bypasses RLS
-- entirely — these policies exist as a second, independent barrier for
-- any client (this API, Supabase client SDKs, direct SQL) that connects
-- with a user's own JWT instead. Tenant isolation must not depend on
-- exactly one of these two barriers holding.

alter table tenants enable row level security;
alter table members enable row level security;
alter table resources enable row level security;
alter table bookings enable row level security;

-- FORCE closes the table-owner loophole: without it, a connection made
-- as the table owner bypasses every policy below even though RLS is
-- enabled. Service-role/admin connections still bypass RLS entirely
-- regardless (that is a Postgres role privilege, not something FORCE
-- affects) — this only matters for non-admin connections.
alter table tenants force row level security;
alter table members force row level security;
alter table resources force row level security;
alter table bookings force row level security;

drop policy if exists "members_see_own_membership" on members;
create policy "members_see_own_membership"
  on members for select
  using (
    user_id = (select auth.uid())
  );

drop policy if exists "members_see_own_tenants" on tenants;
create policy "members_see_own_tenants"
  on tenants for select
  using (
    id in (
      select tenant_id from members
      where user_id = (select auth.uid())
    )
  );

-- `for select` only: `authenticated` is only granted SELECT on this
-- table (see grants below) — resources are managed via the service
-- role, not mutated directly by tenant members. A broader `for all`
-- policy here would be dead code the grants never let anyone reach.
drop policy if exists "tenant_isolation_resources" on resources;
create policy "tenant_isolation_resources"
  on resources for select
  using (
    tenant_id in (
      select tenant_id from members
      where user_id = (select auth.uid())
    )
  );

drop policy if exists "tenant_isolation_bookings_select" on bookings;
create policy "tenant_isolation_bookings_select"
  on bookings for select
  using (
    tenant_id in (
      select tenant_id from members
      where user_id = (select auth.uid())
    )
  );

-- created_by must equal the caller — without this, a staff/owner
-- connection could set created_by to an arbitrary uid and attribute
-- the booking to someone else. The backend already enforces this by
-- never accepting created_by from the client DTO; this closes the
-- same gap for the direct-JWT path.
drop policy if exists "staff_can_create_bookings" on bookings;
create policy "staff_can_create_bookings"
  on bookings for insert
  with check (
    created_by = (select auth.uid())
    and tenant_id in (
      select tenant_id from members
      where user_id = (select auth.uid())
        and role in ('owner', 'staff')
    )
  );

drop policy if exists "owner_can_cancel_bookings" on bookings;
create policy "owner_can_cancel_bookings"
  on bookings for update
  using (
    tenant_id in (
      select tenant_id from members
      where user_id = (select auth.uid())
        and role = 'owner'
    )
  );

-- Table-level privileges ------------------------------------------------
-- No anon grants: this app has no public/unauthenticated read surface —
-- every table requires a resolved auth.uid(). RLS above still decides
-- which rows are visible; this only decides which operations are on the
-- table at all for each role.

grant usage on schema public to authenticated, service_role;

grant select on tenants to authenticated;
grant select on members to authenticated;
grant select on resources to authenticated;
grant select, insert, update on bookings to authenticated;

grant all on tenants, members, resources, bookings to service_role;

commit;
