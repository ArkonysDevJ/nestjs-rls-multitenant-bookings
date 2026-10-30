# Tasks: tenants

Status: `[x]` done, `[ ]` open.

## Done

- [x] List my tenants with their role — `apps/api/src/tenants/tenants.service.ts`
- [x] Create a tenant and its owner membership, with a compensating delete — `apps/api/src/tenants/tenants.service.ts`
- [x] Cap of 5 owned tenants in the service — `apps/api/src/tenants/tenants.service.ts`
- [x] Same cap in the database for user-JWT clients; the function takes no parameter — `apps/api/supabase/migrations/0006_owned_tenant_limit.sql`, `0007_owned_tenant_count_no_param.sql`
- [x] Create-tenant form and tenant switcher in the web app — `apps/web/src/App.tsx`

## Open

- [ ] Add a service spec for `createTenant`: the cap (403), the owner role of the new tenant, and the compensating delete when the membership insert fails. Use `recordSupabase` from `apps/api/src/common/testing/supabase-recorder.ts`.
- [ ] Add Bruno requests for `GET /tenants/me` and `POST /tenants` under `apps/api/bruno/`.
- [ ] Make `listTenantsForUser` fail loudly when the tenants query fails instead of returning `[]` — `apps/api/src/tenants/tenants.service.ts`.
