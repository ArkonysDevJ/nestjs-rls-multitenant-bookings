# Tenant isolation model: why shared-schema + RLS, and when to leave it

This project uses **shared database, shared schema, tenant_id column +
Postgres RLS**. That's one point on a spectrum, not the only correct
answer. This note is the reasoning for picking it here, and the
concrete signals that would mean picking something else.

## The three models

**Shared schema.** Every tenant's rows live in the same tables,
separated by a `tenant_id` column and enforced by RLS policies (this
repo). Cheapest to run, fastest to ship, easiest to add features to —
every tenant automatically benefits from a schema change. The
trade-off is concentrated blast radius: a missing or wrong `tenant_id`
filter is a cross-tenant leak, not a crash. This repo's backend does
not lean on RLS as the only defense against that — every repository
query carries an explicit `tenant_id` filter in application code too
(see `MH-2`-equivalent discipline in `apps/api/src`), specifically
because the service role key bypasses RLS entirely. RLS here is the
second, independent barrier for any client that connects with a
user's own JWT instead of the service role — not the only one.

**Shared database, separate schema per tenant.** One Postgres
instance, one schema per tenant. Stronger isolation than shared-schema
(a bug can't leak rows across a schema boundary the way it can leak
across a `WHERE` clause), but every migration now runs N times, and
connection/schema-search-path management gets real at a few hundred
tenants — some reported Postgres performance degradation appears in
the thousands-of-schemas range.

**Database per tenant.** Full physical isolation — separate backups,
separate scaling, separate blast radius, no query can ever cross the
boundary because there's no connection that spans it. This is what
regulated industries (health, finance) default to, per current
multi-tenant SaaS benchmarking. It costs 3-5x more to operate than a
shared model, and every cross-tenant feature (a superadmin dashboard,
tenant-to-tenant billing rollups) turns into a distributed query
problem instead of a `JOIN`.

## Why shared-schema + RLS for this project

This project's stated purpose is demonstrating the isolation
guarantees themselves — RLS correctness, role-based write policies, a
concurrency-safe no-overlap constraint — not demonstrating operational
scaling of a real SaaS. Shared-schema is the model where those
guarantees are most directly visible and testable (a single pgTAP
suite proves the whole isolation surface in one run; see
`apps/api/supabase/tests`). It's also the correct default for the
product this domain models: a small booking system for independent
service centers has no regulatory requirement for physical separation,
and most teams — per current SaaS architecture guidance — should start
here and graduate later, not the reverse.

## When this project would need to graduate

- A tenant requires contractual or regulatory data residency /
  physical isolation guarantees a shared table can't express.
- A single large tenant's read/write volume starts affecting query
  plans or lock contention for other tenants sharing the same tables.
- Compliance requires an audit boundary that "a WHERE clause is
  correct" can't satisfy on its own — auditors sometimes want to see
  isolation enforced by something that can't have a typo in it.

None of those are true for this demo. If one becomes true, the
practical next step per current guidance is a **hybrid**: keep shared
schema for most tenants, move the tenant that triggered the
requirement to its own schema or database, with routing handled at
the connection layer — not a full-system migration off RLS.

## Sources

- [Multi-Tenant Architecture: Database Per Tenant vs Shared Schema (2026)](https://dev.to/young_gao/multi-tenant-architecture-database-per-tenant-vs-shared-schema-1n2e)
- [Designing for Multi-Tenancy: Scalable Data Isolation Patterns in PostgreSQL](https://dohost.us/index.php/2026/06/12/designing-for-multi-tenancy-scalable-data-isolation-patterns-in-postgresql/)
- [Multi-Tenant Database Isolation: Row-Level Security vs Schema-per-Tenant](https://propelius.tech/blogs/multi-tenant-database-isolation-postgresql-rls-schema/)
- [Postgres Row-Level Security Footguns — Bytebase](https://www.bytebase.com/blog/postgres-row-level-security-footguns/)
