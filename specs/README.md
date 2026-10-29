# Specs

One specification per feature of the API, laid out the way
[Spec Kit](https://github.com/github/spec-kit) lays them out as a reference
(`specs/NNN-feature/` with `spec.md`, `plan.md` and `tasks.md`). The tool is not
required; the files are plain Markdown.

| Folder | Feature | Routes |
|---|---|---|
| [001-tenants](001-tenants/) | List my tenants, create a tenant | `GET /v1/tenants/me`, `POST /v1/tenants` |
| [002-members](002-members/) | Invite a member by email | `POST /v1/members` |
| [003-resources](003-resources/) | List and create bookable resources | `GET /v1/resources`, `POST /v1/resources` |
| [004-bookings](004-bookings/) | Create, list and cancel bookings | `POST /v1/bookings`, `GET /v1/bookings`, `PATCH /v1/bookings/:id/cancel` |
| [005-health](005-health/) | Liveness check backed by the database | `GET /v1/health` |

Each folder answers three questions:

- `spec.md` — **what** the feature does and how to tell it works (requirements
  and acceptance scenarios, with the exact status codes).
- `plan.md` — **how** it is built: the files, the barrier that protects each
  rule, and the tests that cover it.
- `tasks.md` — **what is done and what is open**, with the file each task
  touches. Open tasks are the natural starting points for new work.

Components are referred to by file path. Read [../AGENTS.md](../AGENTS.md)
before changing anything: most changes here touch a security rule.

Conventions used in the specs: all routes live under `/v1`; every route except
`/health` needs `Authorization: Bearer <access token>`; routes that act inside a
tenant also need `x-tenant-id`. Error bodies from Nest look like
`{ "message": ..., "error": ..., "statusCode": ... }`.
