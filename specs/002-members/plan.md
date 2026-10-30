# Plan: members

## Where it lives

| Concern | File |
|---|---|
| Route, guards, role | `apps/api/src/members/members.controller.ts` |
| Logic and membership lookups | `apps/api/src/members/members.service.ts` |
| Input validation | `apps/api/src/members/dto/add-member.dto.ts` |
| Schema, policies, lookup function | `apps/api/supabase/migrations/0001_init.sql`, `0003_self_serve_membership.sql`, `0004_member_lookup_by_email.sql` |
| Web form | `AddMemberForm` in `apps/web/src/App.tsx` |

## How it works

`addMember(tenantId, email, role)` calls the database function
`find_user_id_by_email` through the service-role client, throws a 404 when it
returns nothing, then inserts `{ tenant_id, user_id, role }` into `members`. The
unique key `(tenant_id, user_id)` turns a duplicate into `23505`, which the
exception filter answers as 409.

The same service also provides the lookups that the rest of the API depends on:
`findMembership(tenantId, userId)` is what `TenantGuard` uses to decide whether a
caller belongs to the tenant they ask for, and `findMembershipsForUser(userId)`
backs the tenants feature.

## Barriers

| Rule | API route | Direct user-JWT route |
|---|---|---|
| Only an owner invites | `@Roles('owner')` after `TenantGuard` | `bootstrap_owner_or_owner_invites_member` insert policy: an owner may add `staff`/`viewer` to their own tenant |
| No second owner | DTO only accepts `staff` and `viewer` | Same policy: only the bootstrap branch can insert an `owner` |
| One membership per user and tenant | `unique (tenant_id, user_id)` | Same constraint |

## Tests

| Level | File |
|---|---|
| Jest, intent (tenant from the argument, user from the lookup, nothing inserted without an account) | `apps/api/src/members/members.service.spec.ts` |
| Jest, guards that use the lookups | `apps/api/src/common/guards/tenant.guard.spec.ts`, `roles.guard.spec.ts` |
| Bruno, cross-tenant and role denial | `apps/api/bruno/security-tests/01-*.bru`, `02-*.bru` |
