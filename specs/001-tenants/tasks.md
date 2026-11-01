# Tasks: tenants

Status: `[x]` done, `[ ]` open.

## Done

- [x] List my tenants with their role — `apps/api/src/tenants/tenants.service.ts`
- [x] Create a tenant and its owner membership, with a compensating delete — `apps/api/src/tenants/tenants.service.ts`
- [x] Cap of 5 owned tenants in the service — `apps/api/src/tenants/tenants.service.ts`
- [x] Direct creation of tenants closed in the database: no `insert` privilege for `authenticated`, and the sign-up policies removed — `apps/api/supabase/migrations/0012_explicit_privileges.sql`, `apps/api/supabase/tests/database/005-explicit-privileges.test.sql`
- [x] Bruno requests for `POST /tenants`: created, sixth owned tenant refused, staff elsewhere allowed, direct insert refused — `apps/api/bruno/signup/`
- [x] Create-tenant form and tenant switcher in the web app — `apps/web/src/App.tsx`

## Open

- [ ] Add a service spec for `createTenant`: the cap (403), the owner role of the new tenant, and the compensating delete when the membership insert fails. Use `recordSupabase` from `apps/api/src/common/testing/supabase-recorder.ts`.
- [ ] Add a Bruno request for `GET /tenants/me` under `apps/api/bruno/`.
- [ ] Make `listTenantsForUser` fail loudly when the tenants query fails instead of returning `[]` — `apps/api/src/tenants/tenants.service.ts`.
