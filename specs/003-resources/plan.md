# Plan: resources

## Where it lives

| Concern | File |
|---|---|
| Routes, guards, roles | `apps/api/src/resources/resources.controller.ts` |
| Logic | `apps/api/src/resources/resources.service.ts` |
| Input validation | `apps/api/src/resources/dto/create-resource.dto.ts` |
| Schema and policies | `apps/api/supabase/migrations/0001_init.sql`, `0005_owner_creates_resources.sql`, `0009_booking_resource_same_tenant.sql` |
| Web | `CreateResourceForm` and the resource list in `apps/web/src/App.tsx` |

## How it works

`listForTenant(tenantId)` selects `id, name, capacity, active` filtered by
`tenant_id` and `active = true`, ordered by name. `create(tenantId, dto)` inserts
`{ tenant_id, name, capacity }` and returns the created row. Only those three
columns are ever sent, so a `tenant_id`, `id` or `active` smuggled into the body
cannot reach the insert.

## Barriers

| Rule | API route | Direct user-JWT route |
|---|---|---|
| Only the tenant's resources | `TenantGuard` + `.eq('tenant_id', tenantId)` | `tenant_isolation_resources` select policy |
| Only an owner creates | `@Roles('owner')` | `owner_can_create_resources` insert policy |
| A booking can reference a resource of its own tenant only | — | `unique (id, tenant_id)` on `resources`, the target of `bookings_resource_same_tenant_fk` |

## Tests

| Level | File |
|---|---|
| Jest, intent (tenant filter, tenant from the argument, smuggled fields ignored) | `apps/api/src/resources/resources.service.spec.ts` |
| Bruno, a tenant A member cannot read tenant B resources; RLS through PostgREST | `apps/api/bruno/security-tests/01-*.bru`, `03-*.bru`, `04-*.bru` |
| pgTAP, tenant isolation of reads | `apps/api/supabase/tests/database/001-tenant-isolation.test.sql` |
