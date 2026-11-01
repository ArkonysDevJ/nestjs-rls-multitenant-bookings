-- apps/api/supabase/tests/database/005-explicit-privileges.test.sql
--
-- Table, column and function privileges are fixed by the migrations, not left
-- to the default of each environment, and tenants and members are created only
-- through the API (service_role). The expected values below come from the design
-- of the change, not from whatever the catalog holds today.
--
--   authenticated   select on the four tables, insert on resources and bookings,
--                   update on bookings.status only
--   anon            nothing
--   functions       the four public functions: postgres and service_role only
--   defaults        objects that postgres creates later in public get no grant
--                   for anon, authenticated, service_role or PUBLIC
--
-- A privilege failure and an RLS rejection are both SQLSTATE 42501, so a
-- rejection is asserted with its message as well. "permission denied for table"
-- is the privilege check; "violates row-level security policy" would be RLS.
-- 42P17 (infinite recursion in a policy) is never an acceptable rejection.

begin;

select plan(21);

-- ─── Catalog: tables ────────────────────────────────────────────────────

select table_privs_are('public', 'tenants', 'authenticated', array['SELECT'],
  'tenants: authenticated has SELECT only');
select table_privs_are('public', 'members', 'authenticated', array['SELECT'],
  'members: authenticated has SELECT only');
select table_privs_are('public', 'resources', 'authenticated', array['SELECT', 'INSERT'],
  'resources: authenticated has SELECT and INSERT');
select table_privs_are('public', 'bookings', 'authenticated', array['SELECT', 'INSERT'],
  'bookings: authenticated has SELECT and INSERT at table level');

select table_privs_are('public', 'tenants', 'anon', array[]::text[], 'tenants: anon has nothing');
select table_privs_are('public', 'members', 'anon', array[]::text[], 'members: anon has nothing');
select table_privs_are('public', 'resources', 'anon', array[]::text[], 'resources: anon has nothing');
select table_privs_are('public', 'bookings', 'anon', array[]::text[], 'bookings: anon has nothing');

-- ─── Catalog: columns ───────────────────────────────────────────────────

select is(
  (select string_agg(a.attname::text collate "C", ',' order by a.attname::text collate "C")
   from pg_attribute a
   where a.attrelid = 'public.bookings'::regclass and a.attnum > 0 and not a.attisdropped
     and has_column_privilege('authenticated', a.attrelid, a.attnum, 'update')) collate "C",
  'status' collate "C",
  'bookings: authenticated can update the status column and no other'
);

select is(
  (select count(*) from pg_attribute a
   where a.attrelid in ('public.tenants'::regclass, 'public.members'::regclass,
                        'public.resources'::regclass, 'public.bookings'::regclass)
     and a.attnum > 0 and not a.attisdropped
     and (has_column_privilege('anon', a.attrelid, a.attnum, 'select')
          or has_column_privilege('anon', a.attrelid, a.attnum, 'insert')
          or has_column_privilege('anon', a.attrelid, a.attnum, 'update')
          or has_column_privilege('anon', a.attrelid, a.attnum, 'references'))),
  0::bigint,
  'anon holds no column privilege on any of the four tables'
);

-- ─── Catalog: functions ─────────────────────────────────────────────────

-- Every function in public that no extension owns, with each role that holds
-- EXECUTE (PUBLIC is grantee 0), as one sorted string. A function with a null
-- ACL has the default, which includes PUBLIC.
select is(
  (select string_agg(p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ') '
                     || case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee)::text end,
                     '; ' order by p.proname::text collate "C",
                     pg_get_function_identity_arguments(p.oid) collate "C",
                     case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee)::text end collate "C") collate "C"
   from pg_proc p
   cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where p.pronamespace = 'public'::regnamespace
     and not exists (select 1 from pg_depend d
                     where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
     and a.privilege_type = 'EXECUTE'),
  'find_user_id_by_email(lookup_email text) postgres; find_user_id_by_email(lookup_email text) service_role; '
  || 'owned_tenant_count() postgres; owned_tenant_count() service_role; '
  || 'ping() postgres; ping() service_role; '
  || 'tenant_has_members(check_tenant_id uuid) postgres; tenant_has_members(check_tenant_id uuid) service_role',
  'public functions: EXECUTE for postgres and service_role only, none for PUBLIC, anon or authenticated'
);

-- ─── Defaults for objects created later (run as the migration role) ─────

create table public.zz_future_table (id int);
create function public.zz_future_fn() returns int language sql as $$ select 1 $$;

select is(
  (select count(*) from aclexplode(
     coalesce(c.relacl, acldefault('r', c.relowner))) a
   where a.grantee <> c.relowner),
  0::bigint,
  'a table created later by postgres in public has no grant for anon, authenticated, service_role or PUBLIC'
) from pg_class c where c.oid = 'public.zz_future_table'::regclass;

select is(
  (select count(*) from aclexplode(
     coalesce(p.proacl, acldefault('f', p.proowner))) a
   where a.grantee <> p.proowner),
  0::bigint,
  'a function created later by postgres in public has no EXECUTE for anon, authenticated, service_role or PUBLIC'
) from pg_proc p where p.oid = 'public.zz_future_fn()'::regprocedure;

-- ─── Fixtures (as service_role) ─────────────────────────────────────────

select tests.create_supabase_user('owner1');
select tests.create_supabase_user('staff1');
select tests.create_supabase_user('alice');

select tests.authenticate_as_service_role();

insert into tenants (id, name) values
  ('51111111-1111-4111-8111-111111111111', 'Tenant Five'),
  ('52222222-2222-4222-8222-222222222222', 'Tenant Empty');

insert into resources (id, tenant_id, name, capacity, active) values
  ('a5111111-0000-4000-8000-000000000001', '51111111-1111-4111-8111-111111111111', 'Room 5A', 4, true);

insert into members (tenant_id, user_id, role) values
  ('51111111-1111-4111-8111-111111111111', tests.get_supabase_uid('owner1'), 'owner'),
  ('51111111-1111-4111-8111-111111111111', tests.get_supabase_uid('staff1'), 'staff');

-- ─── Tenants and members are created only through the API ───────────────

select tests.authenticate_as('alice');

select throws_ok(
  format($$ insert into members (tenant_id, user_id, role)
            values ('52222222-2222-4222-8222-222222222222', %L, 'owner') $$,
         tests.get_supabase_uid('alice')),
  '42501',
  'permission denied for table members',
  'a user cannot insert their own owner row in a new tenant (privilege denied, not 42P17)'
);

select throws_ok(
  $$ insert into tenants (name) values ('Tenant Spoof') $$,
  '42501',
  'permission denied for table tenants',
  'a user cannot insert a tenant (privilege denied)'
);

select tests.authenticate_as('owner1');

select throws_ok(
  format($$ insert into members (tenant_id, user_id, role)
            values ('51111111-1111-4111-8111-111111111111', %L, 'staff') $$,
         tests.get_supabase_uid('alice')),
  '42501',
  'permission denied for table members',
  'an owner cannot insert a staff row by direct write (privilege denied, not 42P17)'
);

-- ─── Rewrite sweep: no policy fails to expand ───────────────────────────

-- One plain EXPLAIN per table with row-level security and per command granted to
-- authenticated. Run as authenticated: as service_role the policies are not
-- expanded and the sweep would find nothing.
select results_eq(
  $$ select count(*) from pg_class c
     cross join (values ('select'), ('insert'), ('update'), ('delete')) v(cmd)
     where c.relkind = 'r' and c.relnamespace = 'public'::regnamespace and c.relrowsecurity
       and case when v.cmd = 'delete'
                then has_table_privilege('authenticated', c.oid, 'delete')
                else has_any_column_privilege('authenticated', c.oid, v.cmd) end $$,
  array[7::bigint],
  'authenticated holds 7 table-command grants in total (tenants 1, members 1, resources 2, bookings 3)'
);

select lives_ok($sweep$
  do $do$
  declare
    r record;
    col text;
  begin
    for r in
      select c.oid, c.relname, v.cmd
      from pg_class c
      cross join (values ('select'), ('insert'), ('update'), ('delete')) v(cmd)
      where c.relkind = 'r' and c.relnamespace = 'public'::regnamespace and c.relrowsecurity
        and case when v.cmd = 'delete'
                 then has_table_privilege('authenticated', c.oid, 'delete')
                 else has_any_column_privilege('authenticated', c.oid, v.cmd) end
    loop
      if r.cmd = 'select' then
        execute format('explain select * from public.%I', r.relname);
      elsif r.cmd = 'insert' then
        execute format('explain insert into public.%I default values', r.relname);
      elsif r.cmd = 'delete' then
        execute format('explain delete from public.%I', r.relname);
      else
        select a.attname into col from pg_attribute a
        where a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
          and has_column_privilege('authenticated', a.attrelid, a.attnum, 'update')
        limit 1;
        execute format('explain update public.%I set %I = %I', r.relname, col, col);
      end if;
    end loop;
  end
  $do$
$sweep$, 'every policy of every granted command expands without error');

-- ─── What stays allowed ─────────────────────────────────────────────────

select lives_ok(
  $$ insert into resources (tenant_id, name, capacity, active)
     values ('51111111-1111-4111-8111-111111111111', 'Room 5B', 2, true) $$,
  'an owner creates a resource in their tenant'
);

select tests.authenticate_as('staff1');

select lives_ok(
  format($$ insert into bookings (id, tenant_id, resource_id, created_by, starts_at, ends_at)
            values ('b5000000-0000-4000-8000-000000000001',
                    '51111111-1111-4111-8111-111111111111',
                    'a5111111-0000-4000-8000-000000000001', %L,
                    '2026-12-01 10:00:00+00', '2026-12-01 11:00:00+00') $$,
         tests.get_supabase_uid('staff1')),
  'a staff member creates a booking in their tenant'
);

select tests.authenticate_as('owner1');

select results_eq(
  $$ update bookings set status = 'cancelled'
     where id = 'b5000000-0000-4000-8000-000000000001' and status = 'confirmed'
     returning 1 $$,
  array[1],
  'an owner cancels a confirmed booking of their tenant'
);

select * from finish();

rollback;
