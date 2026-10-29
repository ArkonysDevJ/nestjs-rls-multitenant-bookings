# Plan: tenants

## Where it lives

| Concern | File |
|---|---|
| Routes (`AuthGuard` only) | `apps/api/src/tenants/tenants.controller.ts` |
| Logic | `apps/api/src/tenants/tenants.service.ts` |
| Input validation | `apps/api/src/tenants/dto/create-tenant.dto.ts` |
| Memberships of a user | `findMembershipsForUser` in `apps/api/src/members/members.service.ts` |
| Schema and policies | `apps/api/supabase/migrations/0001_init.sql`, `0003_self_serve_membership.sql`, `0006_owned_tenant_limit.sql`, `0007_owned_tenant_count_no_param.sql` |

## How it works

- `listTenantsForUser` reads the caller's memberships, then the matching
  tenants, and joins the role in code.
- `createTenant` counts the caller's owner memberships, inserts the tenant, then
  inserts the owner membership. If the second insert fails it deletes the tenant
  and rethrows.
- The 5-tenant cap is enforced twice: `MAX_OWNED_TENANTS` in the service, and the
  `bootstrap_owner_or_owner_invites_member` policy through `owned_tenant_count()`
  for a client using a user JWT.

## Barriers

| Rule | API route | Direct user-JWT route |
|---|---|---|
| Only my tenants | Memberships looked up by the caller's user id | `members_see_own_tenants` select policy |
| Anyone may create a tenant | `AuthGuard` | `authenticated_can_create_tenants` insert policy |
| First owner of a new tenant | Service inserts the membership | The member-insert policy accepts an owner row only for a tenant with no members (`tenant_has_members`) |

## Trade-offs

Two limits are accepted and explained in migration `0007`: a boolean
"does this tenant have members" check is callable by any signed-in user, and
the 5-tenant cap is checked before the insert, so two simultaneous requests from
the same user can both pass it. Neither crosses a tenant boundary.

## Tests

No Jest spec or Bruno request covers the tenants routes yet. The guards they use
are covered by `apps/api/src/common/guards/auth.guard.spec.ts`.
