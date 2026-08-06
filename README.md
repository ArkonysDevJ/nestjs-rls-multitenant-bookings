# nestjs-rls-multitenant-bookings

**Status: work in progress.** Backend and frontend are implemented and
security tests have been executed end-to-end against a live Supabase
instance. Seed data and a public deploy are still pending. This README
will be replaced with full setup/usage docs once those are done.

## What this is

A multi-tenant bookings system where tenant isolation is enforced at
the database level (Postgres Row Level Security), not just in
application code. The booking domain is the example, not the point —
the point is the isolation guarantees: a user in one tenant cannot
read or write another tenant's data, roles are enforced per action,
and double-booking a resource is impossible even under concurrent
requests, via a Postgres exclusion constraint rather than
application-level locking.

## Stack

- **API** (`apps/api`): NestJS + Fastify, Supabase (Postgres + Auth +
  RLS), TypeScript strict.
- **Web** (`apps/web`): React + Vite, Supabase Auth on the client,
  everything else through the API.
- npm workspaces monorepo.

## Status

- [x] Backend: tenants/members/resources/bookings modules, guards,
      RLS migration, no-overlap exclusion constraint.
- [x] Frontend: auth, tenant switcher, resource + booking views,
      role-gated actions.
- [x] Security tests executed against a live Supabase instance
      (`apps/api/bruno`) — this is the core claim of the project and
      is now verified end-to-end: unauthenticated/invalid-token
      requests denied, cross-tenant access denied at both the
      application layer AND independently via direct PostgREST
      queries against RLS (bypassing the backend entirely), role
      enforcement denied for disallowed actions, and the
      no-overlap exclusion constraint proven race-safe under two
      truly concurrent requests.
- [ ] Seed data + public deploy.
- [ ] Full README with setup instructions.
