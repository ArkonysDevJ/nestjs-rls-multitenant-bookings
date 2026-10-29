-- apps/api/supabase/tests/database/001-tenant-isolation.test.sql
-- [F-ID: SQL-TEST-TENANT-ISOLATION-01]
-- @version 1.0.0
-- @changelog 1.0.0 — Proves the invariants in 0001_init.sql directly
--   against Postgres, independent of the NestJS layer: cross-tenant
--   reads are denied, role gating on insert/update is enforced, the
--   no-overlap exclusion constraint holds, and created_by cannot be
--   spoofed. Run via `supabase test db` — requires 000-setup-tests-
--   hooks.sql to have installed pgTAP + basejump test helpers first.

begin;

select plan(11);

-- ─── Setup (as service_role, bypasses RLS) ──────────────────────────────

select tests.create_supabase_user('owner1');
select tests.create_supabase_user('staff1');
select tests.create_supabase_user('viewer1');
select tests.create_supabase_user('owner2');

select tests.authenticate_as_service_role();

with t as (
  insert into tenants (id, name) values
    ('11111111-1111-1111-1111-111111111111', 'Tenant One'),
    ('22222222-2222-2222-2222-222222222222', 'Tenant Two')
  returning id
),
r as (
  insert into resources (id, tenant_id, name, capacity, active) values
    ('a1111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Room 1A', 4, true),
    ('a1111111-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Room 1B', 4, true),
    ('a2222222-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Room 2A', 4, true)
  returning id
)
insert into members (tenant_id, user_id, role) values
  ('11111111-1111-1111-1111-111111111111', tests.get_supabase_uid('owner1'), 'owner'),
  ('11111111-1111-1111-1111-111111111111', tests.get_supabase_uid('staff1'), 'staff'),
  ('11111111-1111-1111-1111-111111111111', tests.get_supabase_uid('viewer1'), 'viewer'),
  ('22222222-2222-2222-2222-222222222222', tests.get_supabase_uid('owner2'), 'owner');

-- ─── Positive access + cross-tenant isolation ───────────────────────────

select tests.authenticate_as('owner1');

select results_eq(
  $$ select count(*) from tenants $$,
  ARRAY[1::bigint],
  'owner1 sees exactly their own tenant, not tenant2'
);

select results_eq(
  $$ select count(*) from resources $$,
  ARRAY[2::bigint],
  'owner1 sees only tenant1''s 2 resources, not tenant2''s'
);

select results_eq(
  $$ select count(*) from members $$,
  ARRAY[1::bigint],
  'owner1 sees only their own membership row, not staff1/viewer1''s'
);

-- ─── Role gating on booking creation ────────────────────────────────────

select tests.authenticate_as('viewer1');

select throws_ok(
  $$
    insert into bookings (tenant_id, resource_id, created_by, starts_at, ends_at)
    values (
      '11111111-1111-1111-1111-111111111111',
      'a1111111-0000-0000-0000-000000000001',
      tests.get_supabase_uid('viewer1'),
      '2026-09-01 10:00:00+00',
      '2026-09-01 11:00:00+00'
    )
  $$,
  '42501',
  null,
  'viewer cannot create a booking (RLS denies the insert)'
);

select tests.authenticate_as('staff1');

select lives_ok(
  $$
    insert into bookings (id, tenant_id, resource_id, created_by, starts_at, ends_at)
    values (
      'b0000000-0000-0000-0000-000000000001',
      '11111111-1111-1111-1111-111111111111',
      'a1111111-0000-0000-0000-000000000001',
      tests.get_supabase_uid('staff1'),
      '2026-09-01 10:00:00+00',
      '2026-09-01 11:00:00+00'
    )
  $$,
  'staff can create a booking for their own tenant'
);

select throws_ok(
  $$
    insert into bookings (tenant_id, resource_id, created_by, starts_at, ends_at)
    values (
      '11111111-1111-1111-1111-111111111111',
      'a1111111-0000-0000-0000-000000000001',
      tests.get_supabase_uid('owner1'),
      '2026-09-02 10:00:00+00',
      '2026-09-02 11:00:00+00'
    )
  $$,
  '42501',
  null,
  'staff cannot create a booking attributed to a different user (created_by spoof)'
);

-- ─── Cancel is owner-only ────────────────────────────────────────────────

select results_eq(
  $$
    update bookings set status = 'cancelled'
    where id = 'b0000000-0000-0000-0000-000000000001'
    returning 1
  $$,
  ARRAY[]::integer[],
  'staff cannot cancel a booking (0 rows affected, not an error)'
);

select tests.authenticate_as('owner1');

select results_eq(
  $$
    update bookings set status = 'cancelled'
    where id = 'b0000000-0000-0000-0000-000000000001'
    returning 1
  $$,
  ARRAY[1],
  'owner can cancel a booking in their tenant'
);

-- ─── No-overlap exclusion constraint ────────────────────────────────────

select lives_ok(
  $$
    insert into bookings (id, tenant_id, resource_id, created_by, starts_at, ends_at)
    values (
      'b0000000-0000-0000-0000-000000000002',
      '11111111-1111-1111-1111-111111111111',
      'a1111111-0000-0000-0000-000000000001',
      tests.get_supabase_uid('owner1'),
      '2026-09-03 10:00:00+00',
      '2026-09-03 11:00:00+00'
    )
  $$,
  'owner creates a fresh confirmed booking'
);

select throws_ok(
  $$
    insert into bookings (tenant_id, resource_id, created_by, starts_at, ends_at)
    values (
      '11111111-1111-1111-1111-111111111111',
      'a1111111-0000-0000-0000-000000000001',
      tests.get_supabase_uid('owner1'),
      '2026-09-03 10:30:00+00',
      '2026-09-03 11:30:00+00'
    )
  $$,
  '23P01',
  null,
  'overlapping confirmed booking for the same resource is rejected by the exclusion constraint'
);

-- ─── Tenant2 cannot see tenant1's data ───────────────────────────────────

select tests.authenticate_as('owner2');

select results_eq(
  $$ select count(*) from bookings $$,
  ARRAY[0::bigint],
  'owner2 (tenant2) sees zero bookings from tenant1'
);

select * from finish();

rollback;
