-- apps/api/supabase/migrations/0010_owner_can_only_cancel_bookings.sql
--
-- Through a direct write with a user JWT, an owner could rewrite any column of
-- a booking of their tenant: the policy owner_can_cancel_bookings was
-- FOR UPDATE with only a USING clause and the role had UPDATE on the whole
-- table. That reopened, for UPDATE, the attribution gap that 0001 closed for
-- INSERT (created_by), and allowed moving a booking to another resource or
-- time range.
--
-- Two changes, each doing the part it is good at:
--
--   1. Column privilege: authenticated can update only bookings.status. Any
--      attempt on another column fails with 42501 before RLS is evaluated, so
--      the set of fields an owner can touch does not depend on a policy that
--      lists them.
--   2. Policy: the owner of the booking's tenant can move a booking from
--      confirmed to cancelled, and nothing else. USING lets the owner see only
--      confirmed rows, so cancelled is terminal (an update of a cancelled row
--      affects 0 rows). WITH CHECK requires the new status to be cancelled, so
--      writing 'confirmed' again is rejected.
--
-- Cancelling through the API is unaffected: it uses service_role, which has
-- its own table privileges and skips RLS.

begin;

revoke update on public.bookings from authenticated;
grant update (status) on public.bookings to authenticated;

drop policy if exists "owner_can_cancel_bookings" on public.bookings;
create policy "owner_can_cancel_bookings"
  on public.bookings for update
  using (
    status = 'confirmed'
    and tenant_id in (
      select tenant_id from public.members
      where user_id = (select auth.uid())
        and role = 'owner'
    )
  )
  with check (
    status = 'cancelled'
    and tenant_id in (
      select tenant_id from public.members
      where user_id = (select auth.uid())
        and role = 'owner'
    )
  );

commit;
