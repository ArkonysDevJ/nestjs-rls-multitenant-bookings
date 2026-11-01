# Plan: tenants

## Where it lives

| Concern | File |
|---|---|
| Routes (`AuthGuard` only) | `apps/api/src/tenants/tenants.controller.ts` |
| Logic | `apps/api/src/tenants/tenants.service.ts` |
| Input validation | `apps/api/src/tenants/dto/create-tenant.dto.ts` |
| Memberships of a user | `findMembershipsForUser` in `apps/api/src/members/members.service.ts` |
| Schema and policies | `apps/api/supabase/migrations/0001_init.sql`; `0003`, `0006` and `0007` added sign-up policies that `0012_explicit_privileges.sql` removed |

## How it works

- `listTenantsForUser` reads the caller's memberships, then the matching
  tenants, and joins the role in code.
- `createTenant` counts the caller's owner memberships, inserts the tenant, then
  inserts the owner membership. If the second insert fails it deletes the tenant
  and rethrows.
- The 5-tenant cap is enforced in one place: `MAX_OWNED_TENANTS` in the service,
  counting the memberships where the caller is an owner. A user who is staff in
  five tenants can still create their own.

## Barriers

| Rule | API route | Direct user-JWT route |
|---|---|---|
| Only my tenants | Memberships looked up by the caller's user id | `members_see_own_tenants` select policy |
| Anyone may create a tenant | `AuthGuard`; the write uses the service role | None: `authenticated` has no `insert` privilege on `tenants` |
| First owner of a new tenant | Service inserts the membership | None: `authenticated` has no `insert` privilege on `members` |
| At most 5 owned tenants | `MAX_OWNED_TENANTS` in the service | None needed, since the direct route cannot create tenants |

## Trade-offs

Two limits are accepted. The 5-tenant cap is read and then followed by the
insert, so two simultaneous requests from the same user can both pass it. And
creating a tenant is two writes with a compensating delete, not a transaction:
if the process dies between them, a tenant with no owner stays behind, visible to
nobody. Neither crosses a tenant boundary.

## Tests

Bruno `signup/01`, `07` and `08` cover `POST /tenants` (created, a sixth owned
tenant refused, a user who is staff in five tenants allowed) and `signup/10` the
refused direct insert; pgTAP `005` covers the privileges. No Jest spec covers
the service yet. The guards the routes use are covered by
`apps/api/src/common/guards/auth.guard.spec.ts`.
