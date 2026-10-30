# Tasks: bookings

Status: `[x]` done, `[ ]` open.

## Done

- [x] Create, list and cancel routes with role gating — `apps/api/src/bookings/bookings.controller.ts`
- [x] Tenant filter on every query; tenant and author taken from the context — `apps/api/src/bookings/bookings.service.ts`
- [x] No-overlap exclusion constraint — `apps/api/supabase/migrations/0001_init.sql`
- [x] A booking only references a resource of its own tenant; exclusion constraint led by `tenant_id` — `apps/api/supabase/migrations/0009_booking_resource_same_tenant.sql`
- [x] 404 for a resource of another tenant, identical to a nonexistent one — `apps/api/src/common/filters/all-exceptions.filter.ts`
- [x] An owner with a user JWT can only cancel — `apps/api/supabase/migrations/0010_owner_can_only_cancel_bookings.sql`
- [x] Cancel only confirmed bookings; 404 for missing or foreign, 409 for not confirmed; 400 for a malformed id — `apps/api/src/bookings/bookings.service.ts`, `bookings.controller.ts`
- [x] Unit specs, pgTAP tests, Bruno requests and the race script listed in `plan.md`
- [x] 400 when `endsAt` is equal to or before `startsAt` (the `valid_range` check, `23514`) — `apps/api/src/common/filters/all-exceptions.filter.ts`; Bruno `08-booking-end-before-start-rejected.bru`, `08b-booking-end-equal-to-start-rejected.bru`
- [x] The web app shows a clear message on a 404 when booking — `apps/web/src/App.tsx`, `apps/web/src/lib/api.ts`

## Open

- [ ] Return a clearer message for the 409 overlap case in the web app (`apps/web/src/App.tsx`).
- [ ] Decide whether bookings should be reschedulable. Today the only change is cancelling; a reschedule would need a new route, a policy and a grant, and pgTAP tests for each.
