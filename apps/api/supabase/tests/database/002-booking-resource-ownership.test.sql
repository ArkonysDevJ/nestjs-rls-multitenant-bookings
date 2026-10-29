-- apps/api/supabase/tests/database/002-booking-resource-ownership.test.sql
--
-- A booking must reference a resource that belongs to the same tenant as the
-- booking. The insert policy only checks tenant membership and role, and the
-- API writes with the service key (which skips RLS), so the guarantee has to
-- come from a single declarative barrier in the database: the composite
-- foreign key bookings_resource_same_tenant_fk (resource_id, tenant_id) ->
-- resources (id, tenant_id).
--
-- The rejection must not reveal anything about the other tenant:
--   * a foreign resource and a nonexistent resource are rejected identically;
--   * a foreign resource at a busy time slot and at a free one are rejected
--     identically (23503, never 23P01). This needs tenant_id to lead the
--     overlap exclusion constraint, otherwise Postgres evaluates the
--     exclusion before the foreign key and the error code leaks occupancy.

begin;

select plan(13);

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

-- Tenant Two already holds the 2026-09-02 10:00-11:00 slot on its own resource.
insert into bookings (tenant_id, resource_id, created_by, starts_at, ends_at)
values (
  '22222222-2222-2222-2222-222222222222',
  'a2222222-0000-0000-0000-000000000001',
  tests.get_supabase_uid('owner2'),
  '2026-09-02 10:00:00+00',
  '2026-09-02 11:00:00+00'
);

-- ─── Catalog: the barrier exists with the expected shape ────────────────

select fk_ok(
  'public', 'bookings', ARRAY['resource_id', 'tenant_id'],
  'public', 'resources', ARRAY['id', 'tenant_id'],
  'bookings (resource_id, tenant_id) references resources (id, tenant_id)'
);

select results_eq(
  $$
    select conname::text collate "default" from pg_constraint
    where conrelid = 'public.bookings'::regclass and contype = 'f'
      and (
        select array_agg(a.attname::text order by a.attname::text)
        from pg_attribute a
        where a.attrelid = conrelid and a.attnum = any (conkey)
      ) = ARRAY['resource_id', 'tenant_id']
    order by conname
  $$,
  ARRAY['bookings_resource_same_tenant_fk'],
  'the only foreign key over (resource_id, tenant_id) is bookings_resource_same_tenant_fk'
);

select is(
  (select count(*) from pg_constraint
   where conrelid = 'public.bookings'::regclass
     and contype = 'f'
     and conname = 'bookings_resource_id_fkey'),
  0::bigint,
  'the simple foreign key on bookings.resource_id is gone'
);

select matches(
  (select pg_get_constraintdef(oid) from pg_constraint
   where conrelid = 'public.bookings'::regclass
     and conname = 'no_overlapping_bookings'),
  '^EXCLUDE USING gist \(tenant_id WITH =, resource_id WITH =',
  'the overlap exclusion constraint is led by tenant_id'
);

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

select throws_ok(
  $$
    insert into bookings (tenant_id, resource_id, created_by, starts_at, ends_at)
    values (
      '11111111-1111-1111-1111-111111111111',
      'a1111111-0000-0000-0000-000000000001',
      tests.get_supabase_uid('staff1'),
      '2026-09-01 10:30:00+00',
      '2026-09-01 11:30:00+00'
    )
  $$,
  '23P01',
  null,
  'overlap on the own tenant''s resource is still rejected by the exclusion constraint'
);

-- ─── Direct write with the user JWT: foreign resource, free slot ────────

select throws_ok(
  $$
    insert into bookings (tenant_id, resource_id, created_by, starts_at, ends_at)
    values (
      '11111111-1111-1111-1111-111111111111',
      'a2222222-0000-0000-0000-000000000001',
      tests.get_supabase_uid('staff1'),
      '2026-09-03 10:00:00+00',
      '2026-09-03 11:00:00+00'
    )
  $$,
  '23503',
  'insert or update on table "bookings" violates foreign key constraint "bookings_resource_same_tenant_fk"',
  'JWT: a foreign resource at a free slot is rejected by the composite foreign key'
);

-- ─── Same foreign resource at a slot Tenant Two already holds ───────────

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
  '23503',
  'insert or update on table "bookings" violates foreign key constraint "bookings_resource_same_tenant_fk"',
  'JWT: a foreign resource at a busy slot gives the same 23503, never 23P01 (no occupancy oracle)'
);

-- ─── A resource that does not exist at all is rejected the same way ─────

select throws_ok(
  $$
    insert into bookings (tenant_id, resource_id, created_by, starts_at, ends_at)
    values (
      '11111111-1111-1111-1111-111111111111',
      'a9999999-0000-0000-0000-000000000009',
      tests.get_supabase_uid('staff1'),
      '2026-09-03 10:00:00+00',
      '2026-09-03 11:00:00+00'
    )
  $$,
  '23503',
  'insert or update on table "bookings" violates foreign key constraint "bookings_resource_same_tenant_fk"',
  'JWT: a nonexistent resource is rejected identically to a foreign one'
);

-- ─── The same attempts as service_role: the barrier is not RLS ──────────
-- service_role skips RLS (this is the path the API uses), so these only
-- pass if the rejection comes from the foreign key itself.

select tests.authenticate_as_service_role();

select throws_ok(
  $$
    insert into bookings (tenant_id, resource_id, created_by, starts_at, ends_at)
    values (
      '11111111-1111-1111-1111-111111111111',
      'a2222222-0000-0000-0000-000000000001',
      tests.get_supabase_uid('staff1'),
      '2026-09-03 10:00:00+00',
      '2026-09-03 11:00:00+00'
    )
  $$,
  '23503',
  'insert or update on table "bookings" violates foreign key constraint "bookings_resource_same_tenant_fk"',
  'service_role: a foreign resource at a free slot is rejected by the composite foreign key'
);

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
  '23503',
  'insert or update on table "bookings" violates foreign key constraint "bookings_resource_same_tenant_fk"',
  'service_role: a foreign resource at a busy slot gives the same 23503, never 23P01'
);

-- ─── UPDATE: moving an own booking onto a foreign resource ──────────────
-- Run as service_role to show the composite foreign key covers UPDATE
-- without depending on the route. The owner JWT variant belongs to R11.

select throws_ok(
  $$
    update bookings
    set resource_id = 'a2222222-0000-0000-0000-000000000001'
    where tenant_id = '11111111-1111-1111-1111-111111111111'
      and resource_id = 'a1111111-0000-0000-0000-000000000001'
  $$,
  '23503',
  'insert or update on table "bookings" violates foreign key constraint "bookings_resource_same_tenant_fk"',
  'service_role: UPDATE of resource_id to a foreign resource is rejected by the composite foreign key'
);

-- ─── Rejected attempts left nothing behind ──────────────────────────────

select results_eq(
  $$ select count(*) from bookings where resource_id = 'a2222222-0000-0000-0000-000000000001' and tenant_id <> '22222222-2222-2222-2222-222222222222' $$,
  ARRAY[0::bigint],
  'no booking of another tenant exists on Tenant Two''s resource'
);

select * from finish();

rollback;
