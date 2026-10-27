-- apps/api/supabase/tests/database/002-booking-resource-ownership.test.sql
--
-- A booking must reference a resource that belongs to the same tenant as the
-- booking. The insert policy only checks tenant membership and role, so the
-- guarantee has to come from a database-level barrier, because a user JWT can
-- write to the table directly without going through the API.
--
-- The assertions do not pin an error code: the barrier mechanism (composite
-- foreign key, trigger or policy) is a design decision, so any rejection of
-- the insert satisfies them.

begin;

select plan(3);

select tests.create_supabase_user('staff1');
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
    ('a2222222-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Room 2A', 4, true)
  returning id
)
insert into members (tenant_id, user_id, role) values
  ('11111111-1111-1111-1111-111111111111', tests.get_supabase_uid('staff1'), 'staff'),
  ('22222222-2222-2222-2222-222222222222', tests.get_supabase_uid('owner2'), 'owner');

-- ─── Positive control: same-tenant resource is still bookable ───────────

select tests.authenticate_as('staff1');

select lives_ok(
  $$
    insert into bookings (tenant_id, resource_id, created_by, starts_at, ends_at)
    values (
      '11111111-1111-1111-1111-111111111111',
      'a1111111-0000-0000-0000-000000000001',
      tests.get_supabase_uid('staff1'),
      '2026-09-01 10:00:00+00',
      '2026-09-01 11:00:00+00'
    )
  $$,
  'staff can book a resource of their own tenant'
);

-- ─── Cross-tenant resource must be rejected on a direct write ───────────

select throws_ok(
  $$
    insert into bookings (tenant_id, resource_id, created_by, starts_at, ends_at)
    values (
      '11111111-1111-1111-1111-111111111111',
      'a2222222-0000-0000-0000-000000000001',
      tests.get_supabase_uid('staff1'),
      '2026-09-02 10:00:00+00',
      '2026-09-02 11:00:00+00'
    )
  $$,
  null,
  null,
  'staff cannot book a resource that belongs to another tenant (direct write with the user JWT)'
);

-- ─── The rejected attempt must not leave a booking on the foreign resource

select tests.authenticate_as_service_role();

select results_eq(
  $$ select count(*) from bookings where resource_id = 'a2222222-0000-0000-0000-000000000001' $$,
  ARRAY[0::bigint],
  'no booking exists on the other tenant''s resource'
);

select * from finish();

rollback;
