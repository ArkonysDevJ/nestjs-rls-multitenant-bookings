-- apps/api/supabase/tests/database/003-booking-owner-update-limits.test.sql
--
-- Through a direct write with a user JWT, an owner may make exactly one change
-- to a booking of their tenant: confirmed -> cancelled. Cancelled is terminal.
-- Any other change is rejected: created_by, resource_id, tenant_id, the time
-- range, or the status in any other direction.
--
-- A rejection counts either as an error or as an attempt that changes no row
-- (0 rows affected). Each test name says which one is expected, and the state
-- is read back afterwards to prove nothing changed.

begin;

select plan(17);

select tests.create_supabase_user('owner1');
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
    ('a1111111-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Room 1A', 4, true),
    ('a1111111-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Room 1B', 4, true),
    ('a2222222-0000-0000-0000-00000000000a', '22222222-2222-2222-2222-222222222222', 'Room 2A', 4, true)
  returning id
)
insert into members (tenant_id, user_id, role) values
  ('11111111-1111-1111-1111-111111111111', tests.get_supabase_uid('owner1'), 'owner'),
  ('11111111-1111-1111-1111-111111111111', tests.get_supabase_uid('staff1'), 'staff'),
  ('22222222-2222-2222-2222-222222222222', tests.get_supabase_uid('owner2'), 'owner');

-- b1: confirmed, used for the rejected changes (must stay untouched)
-- b2: confirmed, used for the allowed cancellation
-- b3: already cancelled, used for the terminal-state checks
insert into bookings (id, tenant_id, resource_id, created_by, starts_at, ends_at, status) values
  ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1111111-0000-0000-0000-00000000000a', tests.get_supabase_uid('staff1'), '2026-09-01 10:00:00+00', '2026-09-01 11:00:00+00', 'confirmed'),
  ('b0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a1111111-0000-0000-0000-00000000000a', tests.get_supabase_uid('staff1'), '2026-09-02 10:00:00+00', '2026-09-02 11:00:00+00', 'confirmed'),
  ('b0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'a1111111-0000-0000-0000-00000000000a', tests.get_supabase_uid('staff1'), '2026-09-03 10:00:00+00', '2026-09-03 11:00:00+00', 'cancelled');

-- ─── Privileges: only status is updatable by authenticated ──────────────

select ok(
  has_column_privilege('authenticated', 'public.bookings', 'status', 'UPDATE'),
  'authenticated can update bookings.status'
);

select ok(
  not (
    has_column_privilege('authenticated', 'public.bookings', 'created_by', 'UPDATE')
    or has_column_privilege('authenticated', 'public.bookings', 'resource_id', 'UPDATE')
    or has_column_privilege('authenticated', 'public.bookings', 'tenant_id', 'UPDATE')
    or has_column_privilege('authenticated', 'public.bookings', 'starts_at', 'UPDATE')
    or has_column_privilege('authenticated', 'public.bookings', 'ends_at', 'UPDATE')
  ),
  'authenticated cannot update created_by, resource_id, tenant_id, starts_at or ends_at'
);

-- ─── Owner JWT: changes other than the cancellation are rejected ────────

select tests.authenticate_as('owner1');

select throws_ok(
  $$ update bookings set created_by = tests.get_supabase_uid('owner1')
     where id = 'b0000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'owner JWT: changing created_by is rejected (error)'
);

select throws_ok(
  $$ update bookings set resource_id = 'a2222222-0000-0000-0000-00000000000a'
     where id = 'b0000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'owner JWT: moving a booking to a resource of another tenant is rejected (error)'
);

select throws_ok(
  $$ update bookings set resource_id = 'a1111111-0000-0000-0000-00000000000b'
     where id = 'b0000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'owner JWT: moving a booking to another resource of the same tenant is rejected (error)'
);

select throws_ok(
  $$ update bookings set tenant_id = '22222222-2222-2222-2222-222222222222'
     where id = 'b0000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'owner JWT: changing tenant_id is rejected (error)'
);

select throws_ok(
  $$ update bookings set starts_at = '2026-09-01 09:00:00+00'
     where id = 'b0000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'owner JWT: changing starts_at is rejected (error)'
);

select throws_ok(
  $$ update bookings set ends_at = '2026-09-01 12:00:00+00'
     where id = 'b0000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'owner JWT: changing ends_at is rejected (error)'
);

-- Status in the wrong direction. Re-confirming a cancelled booking changes no
-- row: the policy does not let the owner see a cancelled booking for update.
select results_eq(
  $$
    with u as (
      update bookings set status = 'confirmed'
      where id = 'b0000000-0000-0000-0000-000000000003'
      returning id
    )
    select count(*) from u
  $$,
  ARRAY[0::bigint],
  'owner JWT: re-confirming a cancelled booking changes no row (0 rows)'
);

-- Writing the same status on a confirmed booking is not a cancellation.
select throws_ok(
  $$ update bookings set status = 'confirmed'
     where id = 'b0000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'owner JWT: confirmed -> confirmed is rejected (error)'
);

-- ─── Staff cannot cancel, even though the column is updatable ───────────

select tests.authenticate_as('staff1');

select results_eq(
  $$
    with u as (
      update bookings set status = 'cancelled'
      where id = 'b0000000-0000-0000-0000-000000000001'
      returning id
    )
    select count(*) from u
  $$,
  ARRAY[0::bigint],
  'staff JWT: cancelling changes no row (0 rows)'
);

-- ─── The owner of another tenant cannot cancel it either ────────────────

select tests.authenticate_as('owner2');

select results_eq(
  $$
    with u as (
      update bookings set status = 'cancelled'
      where id = 'b0000000-0000-0000-0000-000000000001'
      returning id
    )
    select count(*) from u
  $$,
  ARRAY[0::bigint],
  'owner of another tenant: cancelling changes no row (0 rows)'
);

-- ─── Nothing changed after all the rejected attempts ────────────────────

select tests.authenticate_as_service_role();

select results_eq(
  $$
    select created_by = tests.get_supabase_uid('staff1'),
           resource_id = 'a1111111-0000-0000-0000-00000000000a',
           tenant_id = '11111111-1111-1111-1111-111111111111',
           starts_at = '2026-09-01 10:00:00+00',
           ends_at = '2026-09-01 11:00:00+00',
           status = 'confirmed'
    from bookings where id = 'b0000000-0000-0000-0000-000000000001'
  $$,
  $$ values (true, true, true, true, true, true) $$,
  'the booking attacked by the rejected changes is exactly as it was'
);

select is(
  (select status from bookings where id = 'b0000000-0000-0000-0000-000000000003'),
  'cancelled',
  'the cancelled booking is still cancelled'
);

-- ─── Allowed: the owner cancels a confirmed booking of their tenant ─────

select tests.authenticate_as('owner1');

select lives_ok(
  $$ update bookings set status = 'cancelled'
     where id = 'b0000000-0000-0000-0000-000000000002' $$,
  'owner JWT: cancelling a confirmed booking of their tenant works'
);

select tests.authenticate_as_service_role();

select is(
  (select status from bookings where id = 'b0000000-0000-0000-0000-000000000002'),
  'cancelled',
  'the booking is cancelled after the owner cancelled it'
);

-- ─── Terminal: cancelling again changes no row ──────────────────────────

select tests.authenticate_as('owner1');

select results_eq(
  $$
    with u as (
      update bookings set status = 'cancelled'
      where id = 'b0000000-0000-0000-0000-000000000002'
      returning id
    )
    select count(*) from u
  $$,
  ARRAY[0::bigint],
  'owner JWT: cancelling an already cancelled booking changes no row (0 rows)'
);

select * from finish();

rollback;
