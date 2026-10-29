# Feature: health

## Summary

A liveness check that proves the API can reach the database. It is also what
the scheduled keep-alive workflow calls, so that the free-tier database keeps
seeing real activity.

## Scenarios

### Check — `GET /v1/health`

No authentication and no `x-tenant-id`.

| Given | When | Then |
|---|---|---|
| The API can reach the database | Anyone asks | 200 `{ "status": "ok", "database": "reachable", "timestamp": <ISO 8601> }` |
| The database cannot be reached | Anyone asks | 503 `Database unreachable`; the cause is logged, not returned |

## Requirements

- **FR-1** The check performs a real round trip to Postgres, not just an HTTP
  answer.
- **FR-2** It reads no business table, so an unauthenticated endpoint can never
  become a way to read tenant data.
- **FR-3** It returns nothing about the data, the schema or the environment.

## Out of scope

Readiness of dependencies other than the database, metrics, version information.
