# AGENTS.md

Instructions for AI coding agents working in this repository. People should
start with [README.md](README.md); the design is in
[ARCHITECTURE.md](ARCHITECTURE.md) and the behaviour of each API feature is in
[specs/](specs/).

## What this project is

A multi-tenant bookings system. Tenant isolation is enforced by Postgres
(Row Level Security, constraints and column privileges), not only by
application code. The booking domain is the example; the isolation guarantees
are the point, so most changes here touch a security rule.

- `apps/api` — NestJS + Fastify backend. It talks to Supabase with the
  **service-role key, which bypasses RLS**.
- `apps/web` — React + Vite dashboard. It only uses Supabase for sign-in; all
  data goes through the API.
- `apps/api/supabase` — migrations and pgTAP tests (a Supabase CLI project).
- `apps/api/bruno` — HTTP test collection and the script that prepares its data.
- `.github/workflows` — `ci.yml` (tests on every push and pull request) and
  `keep-alive.yml` (pings the deployed health endpoint).

## Setup and commands

Node 24 is required (see `.node-version`; `engines` asks for 24.22.1 or later).
Docker and the Supabase CLI are needed for the database and HTTP tests.

| Task | Command (from the repository root unless noted) |
|---|---|
| Install | `npm install` |
| Run the API / the web app | `npm run dev:api` / `npm run dev:web` |
| Build both | `npm run build` |
| Unit tests (Jest) | `npm test --workspace=apps/api` |
| Local Supabase stack | `cd apps/api && supabase start --exclude studio,imgproxy,mailpit,edge-runtime,logflare,vector,realtime,storage-api,postgres-meta` |
| Database tests (pgTAP) | `cd apps/api && supabase test db` |
| Test users and data for Bruno | `cd apps/api && bash bruno/setup-local.sh` |
| HTTP tests (Bruno CLI) | `cd apps/api/bruno && bru run setup security-tests booking-cancel --env local-stack` |
| Concurrent overlap race | `cd apps/api && bash bruno/tests/run-race.sh` |
| Stop the stack | `cd apps/api && supabase stop` |

The Bruno tests need the API running against the local stack. README.md,
section "Running the tests", has the exact steps.

## Rules that must hold

These protect the core claim of the project. Breaking one is a defect even if
every test passes.

1. **Every query on a tenant-owned table carries the tenant filter.** The
   service-role key skips RLS, so `.eq('tenant_id', tenantId)` is the only
   barrier on the API route. The value comes from `request.tenantContext`
   (set by `TenantGuard`), never from the request body, a DTO or a query
   string.
2. **Writes take `tenant_id` and `created_by` from the context**, not from the
   client. DTOs are whitelisted (`forbidNonWhitelisted`), but keep the service
   correct on its own.
3. **Routes that act inside a tenant use `@UseGuards(TenantGuard, RolesGuard)`**
   and declare their roles with `@Roles(...)`. Only routes that are not tied to
   a tenant (`/tenants`, `/tenants/me`) use `AuthGuard` alone; `/health` has no
   guard.
4. **Do not reveal that another tenant's data exists.** A resource or booking
   of another tenant must get the same response as one that does not exist
   (404 with the same body).
5. **The database enforces what the API relies on.** A rule that must hold for
   a user-JWT client too (a booking uses a resource of its own tenant, no
   overlapping confirmed bookings, an owner can only cancel) lives in a
   constraint, a policy or a grant, not only in the service.
6. **Map database errors by constraint name when it matters.** `23503` is
   raised by several foreign keys; only `bookings_resource_same_tenant_fk` is
   answered with a 404 (see `apps/api/src/common/filters/all-exceptions.filter.ts`).

## Migrations

- Add a **new** file in `apps/api/supabase/migrations/`, numbered after the
  last one (`0012_...`). Never edit an existing migration: they are applied to
  a deployed database. Never change the IDs in `0002_seed.sql`.
- Wrap the file in `begin; ... commit;`, make it safe to run twice
  (`if exists`, `create or replace`), and look up constraint names in the
  catalog instead of assuming them.
- A new function must say who can execute it. Supabase grants `EXECUTE` to
  `anon`, `authenticated` and `service_role` by default and
  `revoke ... from public` does not remove those: revoke by role, then grant
  back only what is needed (see `0011_restrict_function_execute.sql`).
- If existing data could break the new rule, abort first with a clear message
  (see `0009_booking_resource_same_tenant.sql`).
- Every new or changed policy, grant, constraint or function needs a pgTAP test
  in `apps/api/supabase/tests/database/` (next file: `005-...`). Write the test
  first and confirm it fails for the expected reason. Cover the user-JWT
  path and, when relevant, `service_role`.

## Tests

- A change to a security rule needs a database test (pgTAP) **and**, when the
  API behaviour changes, a Jest spec (intent) and a Bruno request (execution).
- Service specs use `recordSupabase` from
  `apps/api/src/common/testing/supabase-recorder.ts`: they check which filters
  and payload a service asked the database for, not that the database rejects
  anything.
- The tests that need a database run against the local stack only. Do not run
  them against a deployed project.
- Report a test count only from a real run, with the command and its output.
  Do not estimate or round it.

## Conventions

- TypeScript strict. No `any`, `@ts-ignore` or equivalents.
- Code, comments, commit messages and docs are in English. `README.es.md` is
  the Spanish translation of `README.md`: update both together.
- Existing source files start with a header comment (path, id, version,
  changelog). Leave those as they are; do not add one to a new file.
- Follow the Nest layout already in `apps/api/src`: `*.module.ts`,
  `*.controller.ts`, `*.service.ts`, `dto/`.
- Commit messages use Conventional Commits (`type(scope): subject`), one
  logical change per commit. Stage files by path, not with `git add -A`.

## Delivery

- `main` is protected: changes arrive through a pull request and the `ci` check
  must pass. A merge to `main` deploys to production (API on Railway, web on
  Vercel), so do not merge or push to `main` yourself.
- Work on a branch and keep the diff small enough to review.
- Migrations reach the deployed database through `supabase db push` run from
  `apps/api` by the maintainer. Do not run `db push`, `link` or
  `migration repair` yourself.

## Do not

- Read, print or commit `.env` files, API keys, tokens or passwords. The Bruno
  environment `apps/api/bruno/environments/local-stack.bru` is generated and
  ignored by Git; keep it that way, and do not put real values in the other
  environment files.
- Add or change the demo accounts or the seed data.
- Test against the deployed demo unless the maintainer asks for it.
- Work around a failing test or check. Fix the cause or report it.
