# Plan: health

## Where it lives

| Concern | File |
|---|---|
| Route and the 503 translation | `apps/api/src/health/health.controller.ts` |
| The database call | `apps/api/src/health/health.service.ts` |
| The function it calls | `apps/api/supabase/migrations/0008_health_ping.sql` |
| Scheduled caller | `.github/workflows/keep-alive.yml` |

## How it works

`HealthService.check()` calls the database function `ping()` through the
service-role client. The function returns `true` and touches no table. Any error
becomes a 503 in the controller after being logged.

## Notes

- The route has no guard on purpose: monitors and the workflow call it without
  credentials.
- The keep-alive workflow requests it every 3 days and only reads. GitHub
  disables scheduled workflows in a public repository after 60 days without
  repository activity, so an external uptime monitor requesting the same URL is
  the longer-term way to keep the database from pausing.

## Tests

No Jest spec or Bruno request covers the route; it is exercised by the CI job
(the API is started and polled on this route before the Bruno requests) and by
the scheduled workflow.
