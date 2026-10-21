# nestjs-rls-multitenant-bookings

🌐 [English](README.md) | [Español](README.es.md)

> **TL;DR:** A multi-tenant bookings system where tenant isolation is enforced by
> Postgres itself — Row Level Security, not application code alone —
> and independently verified against a live database, not just claimed
> in this README.

![Bookings view — allows selecting an active tenant, creating resources with capacities, and managing new bookings](docs/assets/bookings.png)

**Status: deployed.** Backend and frontend are implemented, security
tests have been executed end-to-end against a live Supabase instance
(including an independent audit round on the RLS policy layer), and
the app is live with seed data — see "Live demo" below.

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

## Architecture

```
apps/
├── api/                                     # NestJS backend
│   ├── src/
│   │   ├── tenants/                         # GET /tenants/me, POST /tenants (self-service)
│   │   ├── members/                         # POST /members (owner invites staff/viewer by email)
│   │   ├── resources/                       # GET/POST /resources (owner-gated create)
│   │   ├── bookings/                        # POST/GET /bookings, PATCH /:id/cancel
│   │   ├── health/                          # GET /v1/health (Supabase keep-alive target, no guards)
│   │   └── common/
│   │       ├── guards/                      # AuthGuard, TenantGuard, RolesGuard
│   │       ├── decorators/roles.decorator.ts
│   │       ├── filters/all-exceptions.filter.ts   # Maps Postgres error codes to HTTP
│   │       └── supabase/supabase.client.ts  # Shared service-role client
│   ├── supabase/
│   │   ├── migrations/                      # 0001-0008, applied in order (see below)
│   │   └── tests/                           # pgTAP suite over the RLS surface
│   └── bruno/                               # Security test collection (see Testing)
└── web/                                      # React + Vite dashboard
    └── src/
        ├── App.tsx                          # Auth, tenant switcher, resource/booking views
        ├── lib/                             # supabase client + backend fetch wrapper
        └── i18n/                            # react-i18next, es default / en toggle
```

Two independent barriers protect tenant isolation, deliberately:
`TenantGuard`/`RolesGuard` in the NestJS layer (what the backend's
service-role connection actually relies on), and RLS policies in
Postgres (what protects the data if anything ever connects with a
user's own JWT instead of going through the backend). Neither is
assumed to make the other redundant — see "Testing" for how each is
verified separately.

## Getting started

Requires Node 24.22.1+ (see `.nvmrc`). npm workspaces monorepo — one
`npm install` at the root installs both apps.

```bash
npm install

# apps/api/.env  (copy from apps/api/.env.example)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
PORT=3000

# apps/web/.env  (copy from apps/web/.env.example)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-or-publishable-key
VITE_API_URL=http://localhost:3000/v1
```

Apply the migrations in order against your linked Supabase project —
`0001` creates the schema and RLS policies, `0002` seeds two demo
tenants (no `auth.users` rows, those come from real sign-ups), `0003`
through `0007` add self-service tenant/member/resource creation and
the owned-tenant cap, and `0008` adds `public.ping()`, the no-op
function backing `GET /v1/health` (see the API table below and
`.github/workflows/keep-alive.yml`):

```bash
psql "<your-supabase-connection-string>" \
  --single-transaction --variable ON_ERROR_STOP=1 \
  -f apps/api/supabase/migrations/0001_init.sql
# repeat for 0002 through 0008, in order
```

```bash
npm run dev:api    # NestJS on :3000
npm run dev:web    # Vite on :5173
```

## API

All endpoints require `Authorization: Bearer <supabase-jwt>` and live
under `/v1`. Every route past `/tenants/me` and `/tenants` also
requires `x-tenant-id` — the active tenant is never inferred, it's
checked against the caller's actual memberships on every request.

| Method | Path                     | Guard                    | Description |
|--------|--------------------------|---------------------------|--------------|
| GET    | `/tenants/me`             | JWT only                  | Tenants the caller belongs to, with their role in each |
| POST   | `/tenants`                 | JWT only                  | Create a tenant; caller becomes its owner automatically |
| POST   | `/members`                 | owner                     | Invite a staff/viewer member by email |
| GET    | `/resources`               | any tenant member         | Active resources for the active tenant |
| POST   | `/resources`               | owner                     | Create a resource for the active tenant |
| GET    | `/bookings`                | any tenant member         | Bookings for the active tenant, optional `?resource_id=` |
| POST   | `/bookings`                | owner, staff              | Create a booking; 409 on overlap (Postgres exclusion constraint) |
| PATCH  | `/bookings/:id/cancel`     | owner                     | Cancel a confirmed booking |
| GET    | `/health`                  | none (unauthenticated)    | Liveness check for Supabase keep-alive automation; touches no business table |

## Testing

A [Bruno](https://www.usebruno.com/) collection lives in
`apps/api/bruno/`, run against a real Supabase project rather than
mocks:

- **`setup/`** — signs in directly against Supabase Auth's password
  grant (not the backend, which has no login endpoint of its own) and
  captures each JWT into an environment variable automatically via a
  post-response script.
- **`security-tests/`** — `00`/`00b` prove `AuthGuard` rejects a
  missing or garbage token before anything else runs; `01`/`02` prove
  `TenantGuard`/`RolesGuard` reject cross-tenant and wrong-role
  requests; `03`/`04` are the ones that actually matter for this
  project's core claim — they bypass the NestJS backend entirely and
  query Supabase's PostgREST API directly with a real user JWT,
  proving RLS itself filters cross-tenant rows (`200 []`) independent
  of any application-layer guard, with a same-tenant control request
  (`04`) confirming the empty result means isolation, not a broken
  endpoint.
- **`tests/03-concurrent-overlap-race.sh`** — a shell script, not a
  Bruno request, because proving the no-overlap exclusion constraint
  is race-safe requires two truly simultaneous requests, which a GUI
  REST client can't guarantee; two backgrounded `curl` calls can.

A separate pgTAP suite (`apps/api/supabase/tests/`) exercises the same
RLS surface at the SQL level.

## What this project demonstrates

- Row Level Security as a genuine second barrier, not a formality:
  `FORCE ROW LEVEL SECURITY` on every table (closes the table-owner
  bypass loophole), every policy's `auth.uid()` wrapped in a subquery
  for planner caching, and isolation verified independently of the
  application layer via direct PostgREST requests — not just asserted.
- A concurrency-safe no-overlap guarantee via a Postgres exclusion
  constraint (`EXCLUDE USING gist`), proven under two genuinely
  simultaneous requests rather than assumed from application-level
  locking.
- Self-service multi-tenant bootstrap (tenant creation, email-based
  member invites, owner-gated resource creation) built entirely on
  `SECURITY DEFINER` helper functions and RLS policies — including a
  real bug caught and fixed during development: an early version of a
  helper function was callable with an arbitrary user id, making it a
  metadata-enumeration oracle; fixed by binding it to the caller's own
  JWT instead of a passed-in parameter (see migration `0007`).
  Deliberate, documented trade-offs (a narrow existence-check oracle
  needed for bootstrap, and a known same-user race on an anti-abuse
  cap) are called out explicitly as accepted design decisions, not
  silent debt.
- Role-based write authorization enforced per action (`owner` /
  `staff` / `viewer`), independent from tenant-membership enforcement,
  with both checks proven independently in the test suite.
- Full ES/EN UI localization (`react-i18next`), Spanish default with
  an English toggle — a deliberate choice matching this project's
  actual first audience, not an oversight. Role values (`owner` /
  `staff` / `viewer`) and booking status (`confirmed` / `cancelled`)
  are never translated: they're persisted/compared domain data, not
  UI copy.

## Live demo

**Frontend:** https://nestjs-rls-multitenant-bookings-web.vercel.app
**Backend:** https://nestjs-rls-multitenant-bookings-production.up.railway.app

Two seeded tenants (Aurora Studio, Willow Creek Clinic) with demo
accounts across all three roles, so cross-tenant isolation and
role-based access are visible without creating data first:

| Email | Password | Role |
|---|---|---|
| `demo-owner@arkonysdevj.com` | `arkonys2026` | owner |
| `demo-staff@arkonysdevj.com` | `arkonys2026` | staff |
| `demo-viewer@arkonysdevj.com` | `arkonys2026` | viewer |

## Deployment decisions

**Node 24 is pinned** (`engines: >=24.22.1`, `.nvmrc`, `.node-version`)
because 24.22.1 is the first 24.x release carrying the
[October 2026 security fixes](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases).
Without a declared version, the builder that deploys the backend picks
one on its own.

**Why Docker.** `apps/api/Dockerfile` turns the API into an image whose
runtime is fixed by its base tag (`node:24.22.1-slim`) instead of being
resolved by a builder at deploy time. The same image runs locally and on
any container host, carrying only `dist/` and production dependencies.
Build it from the repository root: `docker build -f apps/api/Dockerfile .`

| | Railway | Cloud Run |
|---|---|---|
| Cost with little traffic | The container is billed while it runs, which is all the time unless sleeping is enabled | Scales to zero; idle time is not billed |
| Cold start | None by default: the instance stays up | The first request after idle waits for an instance to start, unless a minimum instance count is kept |
| Authentication | Public URL; access control is left to the app (here, the Supabase JWT guards) | Public, or restricted to IAM-authenticated callers by the platform itself |
| How the Node version is pinned | Nixpacks derives it from `engines` / `.nvmrc`; with a Dockerfile, the base image tag | The base image tag of the deployed image (source deploys use buildpacks that read `engines`) |
| Who builds the image | Railway, from the repository, on every deploy | You or your CI (or Cloud Build), pushing to a registry |

This repository runs its backend on Railway (see "Live demo"), where it
already lives; the Dockerfile moves the Node version decision into the
repository instead of leaving it to the builder.

**Image contract:** listens on `PORT` (3000 if unset) on `0.0.0.0`, keeps
no local state (all data is in Supabase), logs to stdout/stderr, and shuts
down cleanly on `SIGTERM` — any host that honours those can run it.

## Status

- [x] Backend: tenants/members/resources/bookings modules, guards,
      RLS migrations, no-overlap exclusion constraint.
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
- [x] Independent security audit on the RLS policy layer (self-serve
      tenant/member creation, owner-created resources, owned-tenant
      cap) — one finding fixed (an enumeration oracle in a
      `SECURITY DEFINER` helper, closed by binding it to the
      caller's own JWT instead of an external parameter), two
      findings accepted as documented, deliberate tradeoffs rather
      than bugs: a narrow existence-check oracle needed to bootstrap
      a brand-new tenant, and a known race condition on the
      owned-tenant cap under concurrent requests from the same user
      (does not cross tenant boundaries — see inline comments on
      migration `0007` for both).
- [x] Seed data + public deploy — backend on Railway, frontend on
      Vercel, two seeded tenants, three demo accounts (owner/staff/
      viewer). See "Live demo" above.
- [x] Full README with setup instructions.

✅ Deployed — August 2026. Backend on Railway, frontend on Vercel.

## License

MIT — see [LICENSE](./LICENSE).
