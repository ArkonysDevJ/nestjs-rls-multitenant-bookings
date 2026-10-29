# Tasks: resources

Status: `[x]` done, `[ ]` open.

## Done

- [x] List active resources of the tenant — `apps/api/src/resources/resources.service.ts`
- [x] Owner-only creation with validated name and capacity — `apps/api/src/resources/resources.controller.ts`, `dto/create-resource.dto.ts`
- [x] Insert policy and grant for owners on the user-JWT route — `apps/api/supabase/migrations/0005_owner_creates_resources.sql`
- [x] Unique key `(id, tenant_id)` that bookings reference — `apps/api/supabase/migrations/0009_booking_resource_same_tenant.sql`
- [x] Unit spec for the tenant filter and the tenant of a write — `apps/api/src/resources/resources.service.spec.ts`
- [x] Resource list and owner-only create form in the web app — `apps/web/src/App.tsx`

## Open

- [ ] Add a Bruno request for creating a resource as owner (201), as staff (403) and with an invalid capacity (400) under `apps/api/bruno/`.
- [ ] Add a pgTAP test for the resource insert policy on the user-JWT route: an owner can insert for their tenant and cannot insert for another — `apps/api/supabase/tests/database/`.
- [ ] Renaming and deactivating a resource are not implemented. A deactivated resource would also need a rule for its future bookings.
