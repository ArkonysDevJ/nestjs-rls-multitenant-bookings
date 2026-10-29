-- apps/api/supabase/migrations/0009_booking_resource_same_tenant.sql
--
-- A booking must reference a resource of its own tenant. Until now
-- bookings.resource_id had a plain foreign key to resources(id), so a booking
-- of tenant A could point at a resource of tenant B: through the API (which
-- uses the service key and skips RLS) and through a direct write with a user
-- JWT (the insert policy checks tenant and role, never the resource owner).
--
-- One declarative barrier in the database covers every write path, INSERT and
-- UPDATE alike:
--
--   1. resources gets UNIQUE (id, tenant_id), the target of the new key.
--   2. The plain foreign key on bookings.resource_id is replaced by the
--      composite foreign key bookings_resource_same_tenant_fk
--      (resource_id, tenant_id) -> resources (id, tenant_id).
--   3. The overlap exclusion constraint now starts with tenant_id.
--
-- Step 3 matters for what the rejection reveals. Postgres evaluates the
-- exclusion constraint before the foreign key. With the old constraint, an
-- attempt on a foreign resource at a busy time slot failed with 23P01 and one
-- at a free slot with 23503, so the error code told the caller when another
-- tenant's resource was occupied. With tenant_id first, a booking of tenant A
-- never conflicts with a booking of tenant B, the exclusion is not reached for
-- a foreign resource, and both cases fail with 23503.
--
-- The migration aborts before changing anything if the data already violates
-- the new rule, and it looks up the real constraint names in the catalog
-- instead of assuming them. It can be re-run safely.

begin;

do $$
declare
  cross_tenant_count bigint;
  bookings_tbl constant regclass := 'public.bookings'::regclass;
begin
  select count(*) into cross_tenant_count
  from public.bookings b
  join public.resources r on r.id = b.resource_id
  where r.tenant_id <> b.tenant_id;

  if cross_tenant_count > 0 then
    raise exception
      '0009 aborted: % booking(s) reference a resource of another tenant. Review them before applying this migration.',
      cross_tenant_count;
  end if;

  -- The exclusion constraint is replaced below by name: make sure that name
  -- is the real one in this database.
  if not exists (
    select 1 from pg_constraint
    where conrelid = bookings_tbl
      and conname = 'no_overlapping_bookings'
      and contype = 'x'
  ) then
    raise exception
      '0009 aborted: exclusion constraint no_overlapping_bookings not found on public.bookings. The schema does not match the earlier migrations.';
  end if;
end
$$;

-- Drop the plain foreign key on resource_id, whatever its name is in this
-- database, plus the composite one if a previous run already created it.
do $$
declare
  old_fk_name name;
begin
  select c.conname into old_fk_name
  from pg_constraint c
  where c.conrelid = 'public.bookings'::regclass
    and c.contype = 'f'
    and c.confrelid = 'public.resources'::regclass
    and c.conkey = array[(
      select a.attnum from pg_attribute a
      where a.attrelid = 'public.bookings'::regclass and a.attname = 'resource_id'
    )]::int2[];

  if old_fk_name is not null then
    execute format('alter table public.bookings drop constraint %I', old_fk_name);
  end if;
end
$$;

alter table public.bookings
  drop constraint if exists bookings_resource_same_tenant_fk;

alter table public.resources
  drop constraint if exists resources_id_tenant_id_key;

alter table public.resources
  add constraint resources_id_tenant_id_key unique (id, tenant_id);

alter table public.bookings
  add constraint bookings_resource_same_tenant_fk
  foreign key (resource_id, tenant_id)
  references public.resources (id, tenant_id);

alter table public.bookings
  drop constraint if exists no_overlapping_bookings;

alter table public.bookings
  add constraint no_overlapping_bookings
  exclude using gist (
    tenant_id with =,
    resource_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status = 'confirmed');

commit;
