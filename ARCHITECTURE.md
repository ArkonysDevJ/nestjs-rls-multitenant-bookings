# Architecture

How the system is built, which barrier protects what, and where each piece
lives. For setup and the live demo see [README.md](README.md); for the
behaviour of each API feature see [specs/](specs/); for the rules to follow when
changing code see [AGENTS.md](AGENTS.md).

## 1. Overview

A multi-tenant bookings system. A user belongs to one or more **tenants** with a
role in each (`owner`, `staff`, `viewer`). Tenants own **resources** (rooms, for
example) and **bookings** of those resources. The goal is not the booking domain
but the isolation guarantee: a user of one tenant cannot read or write another
tenant's data, roles are enforced per action, and two confirmed bookings of the
same resource cannot overlap even under concurrent requests.

| Piece | Technology | Where |
|---|---|---|
| Backend API | NestJS 11 on Fastify, TypeScript strict | `apps/api/src` |
| Web app | React 18 + Vite, `react-i18next` (Spanish default, English toggle) | `apps/web/src` |
| Database and auth | Supabase (Postgres + Auth + PostgREST) | `apps/api/supabase` |
| Tests | Jest, pgTAP, Bruno, a shell race script | see section 7 |
| CI | GitHub Actions | `.github/workflows` |
| Desktop icons | Two PNG icons (512 and 1024 px) for packaging the web app with Pake | `pake/` |

## 2. Repository map

```
apps/
  api/
    src/
      main.ts                 bootstrap: prefix /v1, CORS, ValidationPipe, filter, shutdown hooks
      app.module.ts           wires the feature modules
      tenants/ members/ resources/ bookings/ health/    one module each: controller, service, dto/
      common/
        guards/               AuthGuard, TenantGuard, RolesGuard
        decorators/           @Roles(...)
        filters/              AllExceptionsFilter (database errors -> HTTP)
        supabase/             shared service-role client
        types/                TenantContext
        testing/              recordSupabase helper for service specs (kept out of the build)
    supabase/
      config.toml             local stack configuration
      migrations/             0001 ... 0011, applied in order
      tests/database/         pgTAP: 000 setup hook, 001-003
    bruno/                    HTTP collection, setup-local.sh, race scripts, environments/
    Dockerfile                two-stage image on node:24.22.1-slim
  web/
    src/
      App.tsx                 auth screen, dashboard, tenant workspace and forms
      lib/api.ts              fetch wrapper for the API (ApiError keeps the HTTP status)
      lib/supabase.ts         Supabase client, used for sign-in only
      i18n/                   react-i18next setup and es/en locales
.github/workflows/            ci.yml, keep-alive.yml
docs/                         trade-off notes and screenshots
pake/                         app icons
```

## 3. Request paths and barriers

There are two ways to reach the data, and each is protected by different things.

```
                          +--------------------------+
 Browser (apps/web) ----->|  API (NestJS, service    |-----> Postgres
   Bearer JWT + x-tenant-id|  role key, bypasses RLS) |        constraints, FKs
                          +--------------------------+        (RLS does not apply)
                                                              
 Any client with a user JWT ---------------------------------> PostgREST -> Postgres
   (direct, no API)                                            RLS policies, column grants,
                                                               constraints, FKs
```

- **Through the API.** The web app signs in with Supabase Auth, then calls the
  API with `Authorization: Bearer <access token>` and, for tenant routes,
  `x-tenant-id`. The API validates the token by asking Supabase
  (`auth.getUser`), looks up the caller's membership in that tenant, checks the
  role, and queries Postgres with the service-role key. RLS is **not** in play
  on this route, so every query filters by `tenant_id` itself.
- **Directly with a user JWT.** A client can call PostgREST itself. Then RLS
  policies, column privileges, constraints and foreign keys are the only
  barriers.

Some rules are enforced by Postgres for every writer, the service role
included, so they hold on both routes:

| Rule | Through the API | Directly with a user JWT |
|---|---|---|
| Other tenants' rows are not readable | `TenantGuard` + `tenant_id` filter in every query | RLS select policies |
| Roles per action | `RolesGuard` (`@Roles`) | RLS insert/update policies |
| A booking uses a resource of its own tenant | Composite foreign key `bookings_resource_same_tenant_fk`; the API answers 404, identical for a resource of another tenant and for one that does not exist | The same foreign key (`23503`, the same for a busy and a free time slot) |
| No two confirmed bookings overlap on a resource | Exclusion constraint `no_overlapping_bookings`, led by `tenant_id`; 409 | The same constraint |
| An owner can only cancel a booking | Only `PATCH /bookings/:id/cancel` exists | `UPDATE` is granted on `bookings.status` only; the owner policy allows `confirmed -> cancelled`; cancelled is terminal |

Why `tenant_id` leads the exclusion constraint: Postgres checks it before the
foreign key. If it were keyed on the resource alone, an attempt on a foreign
resource at a busy time slot would fail with `23P01` and one at a free slot with
`23503`, and the error code would tell the caller when another tenant's
resource is occupied.

### Request pipeline (API)

1. Fastify with the global prefix `/v1`; CORS enabled for `GET`, `POST`, `PATCH`.
2. `ValidationPipe` with `whitelist`, `forbidNonWhitelisted` and `transform`:
   unknown body properties are a 400.
3. Guards. Tenant routes: `TenantGuard` (token, `x-tenant-id`, membership; sets
   `request.tenantContext = { userId, tenantId, role }`) then `RolesGuard`.
   `/tenants` and `/tenants/me`: `AuthGuard` only. `/health`: none.
4. Controller -> service -> Supabase client with the service-role key.
5. `AllExceptionsFilter` turns exceptions into responses (section 5).

## 4. Data model

All tables live in the `public` schema, with RLS enabled **and forced**.

| Table | Columns | Constraints |
|---|---|---|
| `tenants` | `id`, `name`, `created_at` | primary key |
| `members` | `id`, `tenant_id`, `user_id`, `role` | `unique (tenant_id, user_id)`; role in `owner`, `staff`, `viewer`; `tenant_id` cascades; `user_id` references `auth.users` |
| `resources` | `id`, `tenant_id`, `name`, `capacity`, `active` | `unique (id, tenant_id)` (target of the booking key) |
| `bookings` | `id`, `tenant_id`, `resource_id`, `created_by`, `starts_at`, `ends_at`, `status`, `created_at` | `bookings_resource_same_tenant_fk (resource_id, tenant_id) -> resources (id, tenant_id)`; `no_overlapping_bookings` exclusion over `(tenant_id, resource_id, tstzrange(starts_at, ends_at))` where status is `confirmed`; `valid_range` (`ends_at > starts_at`); status in `confirmed`, `cancelled` |

**Policies** (all use `(select auth.uid())` so the planner evaluates it once):

| Table | Policy | Operation | Allows |
|---|---|---|---|
| `members` | `members_see_own_membership` | select | own membership rows |
| `members` | `bootstrap_owner_or_owner_invites_member` | insert | the first owner of a tenant with no members (and fewer than 5 owned tenants), or an owner adding a `staff`/`viewer` |
| `tenants` | `members_see_own_tenants` | select | tenants the caller belongs to |
| `tenants` | `authenticated_can_create_tenants` | insert | any authenticated user |
| `resources` | `tenant_isolation_resources` | select | resources of the caller's tenants |
| `resources` | `owner_can_create_resources` | insert | owners, for their tenant |
| `bookings` | `tenant_isolation_bookings_select` | select | bookings of the caller's tenants |
| `bookings` | `staff_can_create_bookings` | insert | owner/staff, with `created_by = auth.uid()` |
| `bookings` | `owner_can_cancel_bookings` | update | owners: a confirmed booking of their tenant becomes cancelled |

**Privileges.** `authenticated` can `select` on the four tables, `insert` on
`tenants`, `members` and `resources`, and on `bookings` can `insert` and
`update (status)` only. `service_role` has everything. See "Table privileges"
below for what `anon` holds.

**Functions** (`security definer`, fixed `search_path`). Supabase grants
`EXECUTE` on new functions to `anon`, `authenticated` and `service_role`
explicitly, and `revoke ... from public` does not remove those grants, so
migration `0011` revokes them by role and grants back only what is needed:

| Function | Used by | Who can execute | Purpose |
|---|---|---|---|
| `tenant_has_members(uuid)` | the member-insert policy | `authenticated`, `service_role` | tells whether a tenant is still unclaimed, without being filtered by the caller's own visibility |
| `owned_tenant_count()` | the member-insert policy | `authenticated`, `service_role` | counts the caller's owned tenants (no parameter, so it cannot be asked about someone else) |
| `find_user_id_by_email(text)` | the API | `service_role` only | resolves an invitee by email; open to other roles it would let anyone test which emails are registered |
| `ping()` | the API | `service_role` only | backs `GET /v1/health` without touching a business table |

The two policy functions stay executable by `authenticated` because the
member-insert policy runs as the caller. `anon` cannot execute any of them.

### Table privileges

Row-level security decides which rows a role can see; table privileges
decide which statements the role may run at all. This project relies on both.

On the hosted project, `authenticated` holds exactly the privileges granted
in `supabase/migrations/`, and `anon` holds no data privileges. This matches
Supabase's current platform default, under which new tables are no longer
exposed to the Data API implicitly.

The local stack started by the Supabase CLI, which CI also uses, still
applies the earlier default: `anon` and `authenticated` receive full DML
privileges on every new table. Tests therefore run against a more permissive
baseline than the hosted project. RLS isolates rows in both environments, but
a green local run does not prove that the hosted grants permit the same
statement.

In both environments, `anon` and `authenticated` also retain `TRUNCATE`,
`REFERENCES`, `TRIGGER` and `MAINTAIN`. These come from the platform default,
not from these migrations, and RLS does not govern `TRUNCATE`. Revoking them
explicitly and aligning the local baseline with the hosted one is tracked as
a follow-up.

## 5. Errors

`AllExceptionsFilter` (`apps/api/src/common/filters/all-exceptions.filter.ts`):

| Source | Response |
|---|---|
| Any Nest `HttpException` | its own status and body |
| `23503` from `bookings_resource_same_tenant_fk` | 404 `{ statusCode, message: "The requested resource was not found.", code: "RESOURCE_NOT_FOUND" }` |
| `23514` from `valid_range` (a booking that ends at or before its start) | 400 `{ statusCode, message: "The end of a booking must be after its start.", code: "INVALID_TIME_RANGE" }` |
| `23505`, other `23503`, `23P01` | 409 (`23P01` has a message about overlapping bookings) |
| Anything else | 500 `{ statusCode: 500, message: "Internal server error." }`, logged; the database message is never returned |

A malformed `x-tenant-id` header never reaches the database: `TenantGuard`
checks its shape and answers 401 (`Invalid x-tenant-id header.`).

The booking service adds its own cases: cancelling a booking that is missing
or belongs to another tenant is a 404 (`Booking not found.`, the same in both
cases), and cancelling one that is not confirmed is a 409.

## 6. Web app

- `App.tsx` switches between `AuthScreen` (sign in / sign up with Supabase Auth)
  and `Dashboard`.
- `Dashboard` loads `GET /tenants/me`, shows a tenant switcher and, for the
  active tenant, `TenantWorkspace`: resources, bookings, and forms gated by
  role (owners can create resources, invite members and cancel; owners and
  staff can book). A signed-in user with no memberships is offered a
  create-tenant form.
- Role gating in the UI is cosmetic. The API checks every call.
- `lib/api.ts` is the only client of the API. It attaches the Supabase access
  token and `x-tenant-id`, turns error responses into `ApiError` (keeping the
  status) and shows the response `message`. A 404 on a booking shows a specific
  message.
- `lib/supabase.ts` is used only for authentication; the web app never queries
  tables directly.
- Language: Spanish by default, English on toggle (`localStorage` key
  `app_language`). Role and status values are data, never translated.
- Configuration: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`.

## 7. Testing strategy (as implemented)

| Layer | What it proves | Where |
|---|---|---|
| Jest | Guards, the exception filter, and the **intent** of each service: the tenant filter is present with the value it was given, and a write takes its tenant from the context, not the payload. It does not show the database rejecting anything | `apps/api/src/**/*.spec.ts` |
| pgTAP | What Postgres enforces by itself, for a user JWT and as the service role. `001` tenant isolation by RLS; `002` a booking uses a resource of its own tenant (same error for busy and free slots); `003` what an owner may change on a booking; `004` who can execute each public function (read from the catalog, plus the calls that must still work) | `apps/api/supabase/tests/database/` |
| Bruno | HTTP behaviour against the running API and PostgREST: auth and role guards, RLS through PostgREST, the cross-tenant 404, the refused calls to the restricted functions (`06`–`06f`), the 401 for a malformed tenant header (`07`), the 400 for a bad time range (`08`, `08b`), the cancellation lifecycle | `apps/api/bruno/` |
| Race script | Two simultaneous bookings for the same slot: one 201 and one 409 | `apps/api/bruno/tests/` |

All of it runs against a local Supabase stack. `ci.yml` runs Jest, pgTAP and
Bruno (plus the API and web builds and the Docker image build) on every push
and pull request; the race script is run by hand. A security rule is considered covered when a test fails
before the change and passes after it for the expected reason.

Limits: a unit spec cannot detect a **new** service method that forgets the
tenant filter. The Docker image is built in CI but never run there.

The local Postgres 17.6 can crash the connection when a role calls a function
it has no `EXECUTE` on over the simple query protocol (`psql`, pgTAP). The
same call through PostgREST answers normally. For that reason pgTAP `004`
reads the privileges from the catalog and the refused calls are covered over
HTTP by Bruno `06`–`06f`.

## 8. Deployment

- **API** on Railway, built from the repository on each push to `main` by
  Railway's builder (Railpack), which runs `npm install`, `npm run build:api` and
  `npm run start` and takes the Node version from `.node-version`. **Web** on Vercel. **Database and auth** on Supabase.
- Branch protection on `main`: pull request required, `ci` must pass.
- Migrations on the demo database are applied from `apps/api` with
  `supabase db push` after `supabase link`. The history table is aligned
  with `0001`–`0011` (the first ones were applied by hand with `psql`).
  Run the CLI from `apps/api`: the root `supabase/` folder has no migrations.
- `apps/api/Dockerfile` builds the API into a two-stage image on
  `node:24.22.1-slim` that runs as the unprivileged `node` user, listens on
  `PORT` (3000 by default) on `0.0.0.0`, keeps no local state and exits cleanly
  on `SIGTERM`. It is validated locally; Railway does not use it.
- API configuration: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PORT`. The
  service-role key bypasses RLS and must stay on the server.
- Node 24.22.1 or later is pinned through `engines`, `.nvmrc`, `.node-version`
  and the image tag.
- `keep-alive.yml` pings `GET /v1/health` every 3 days so the free-tier
  database is not paused for inactivity. It only reads. GitHub disables
  scheduled workflows after 60 days without repository activity, so an
  external uptime monitor requesting the same URL is the longer-term backup.

## 9. Known limitations

Found by reading the code and, where noted, by running it. None is a
cross-tenant leak.

| Behaviour | Verified |
|---|---|
| Inserting a row in `members` with a user JWT straight through PostgREST fails with `42P17` (infinite recursion detected in the policy). Both routes that insert members (`POST /tenants` and the invitation route) go through the service-role client, which does not evaluate RLS policies | Run (pgTAP); routes by code reading |
| `tenant_has_members(uuid)` answers, for any tenant id, whether it has members. It is needed to bootstrap a tenant and reveals nothing but existence | Documented in migration `0007` |
| The owned-tenant cap (5) is checked before the insert, so two simultaneous requests from the same user can pass it | Documented in migration `0007` |
| `GET /tenants/me` returns an empty list if the tenants query fails, instead of an error | Code reading |
| A booking cannot be rescheduled: the only change allowed after creating it is cancelling it | By design |
