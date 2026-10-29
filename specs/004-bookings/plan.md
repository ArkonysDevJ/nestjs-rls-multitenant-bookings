# Plan: bookings

## Where it lives

| Concern | File |
|---|---|
| Routes, guards and roles | `apps/api/src/bookings/bookings.controller.ts` |
| Logic | `apps/api/src/bookings/bookings.service.ts` |
| Input validation | `apps/api/src/bookings/dto/create-booking.dto.ts`, `dto/list-bookings-query.dto.ts` |
| Error mapping | `apps/api/src/common/filters/all-exceptions.filter.ts` |
| Tenant and role checks | `apps/api/src/common/guards/tenant.guard.ts`, `roles.guard.ts` |
| Schema | `apps/api/supabase/migrations/0001_init.sql`, `0009_booking_resource_same_tenant.sql`, `0010_owner_can_only_cancel_bookings.sql` |
| Web client | `apps/web/src/lib/api.ts`, `apps/web/src/App.tsx` |

## How each rule is protected

| Rule | API route | Direct user-JWT route |
|---|---|---|
| Only the tenant's own data | `TenantGuard` + `.eq('tenant_id', tenantId)` in every query | RLS select/insert/update policies |
| Roles | `@Roles('owner', 'staff')` on create, `@Roles('owner')` on cancel | Insert policy (`owner`/`staff`, `created_by = auth.uid()`); update policy (`owner`) |
| Resource of the same tenant | Foreign key `bookings_resource_same_tenant_fk (resource_id, tenant_id)`; the filter maps it to a 404 | The same key (`23503`) |
| No overlap | Exclusion constraint `no_overlapping_bookings` over `(tenant_id, resource_id, tstzrange)` where `confirmed`; filter maps `23P01` to 409 | The same constraint |
| Cancel only | `cancel` runs one `UPDATE` filtered by id, tenant and `status = 'confirmed'`; on no row it looks the booking up **by tenant** to choose 404 or 409 | `UPDATE` granted on `status` only; policy `USING status = 'confirmed'`, `WITH CHECK status = 'cancelled'` |

`tenant_id` leads the exclusion constraint on purpose: Postgres checks it before
the foreign key, and otherwise a foreign resource at a busy slot would fail with
a different error than at a free slot.

## Decisions worth keeping

- `cancel` translates the "no row" answer in the service, not in the global
  filter, because other services use `.single()` too.
- The filter maps `23503` to 404 **by constraint name**, because other inserts
  also raise `23503` and keep their 409.
- `:id` is validated with `ParseUUIDPipe` so a malformed id is a 400, not a
  database error.

## Tests

| Level | File |
|---|---|
| Jest, intent of create and list (tenant filter, tenant and author from context, smuggled fields ignored) | `apps/api/src/bookings/bookings.service.spec.ts` |
| Jest, cancel (scoping, 404, 409, other errors stay 500) | `apps/api/src/bookings/bookings.cancel.spec.ts` |
| Jest, filter mapping | `apps/api/src/common/filters/all-exceptions.filter.spec.ts` |
| pgTAP, resource of the same tenant | `apps/api/supabase/tests/database/002-booking-resource-ownership.test.sql` |
| pgTAP, what an owner may change | `apps/api/supabase/tests/database/003-booking-owner-update-limits.test.sql` |
| Bruno, cross-tenant 404 | `apps/api/bruno/security-tests/05-*.bru`, `05b-*.bru` |
| Bruno, cancellation lifecycle | `apps/api/bruno/booking-cancel/` |
| Race, one 201 and one 409 | `apps/api/bruno/tests/03-concurrent-overlap-race.sh` |
