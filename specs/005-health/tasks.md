# Tasks: health

Status: `[x]` done, `[ ]` open.

## Done

- [x] `GET /v1/health` with a real database round trip — `apps/api/src/health/health.service.ts`
- [x] 503 with a generic message when the database is unreachable — `apps/api/src/health/health.controller.ts`
- [x] A dedicated `ping()` function so the route reads no business table — `apps/api/supabase/migrations/0008_health_ping.sql`
- [x] Scheduled, read-only ping every 3 days — `.github/workflows/keep-alive.yml`

## Open

- [ ] Add a Jest spec for the controller: 200 body shape, and 503 without leaking the error.
- [ ] Add a Bruno request for `GET /health` (200, no credentials) under `apps/api/bruno/`.
