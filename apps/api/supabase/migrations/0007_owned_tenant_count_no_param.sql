-- apps/api/supabase/migrations/0007_owned_tenant_count_no_param.sql
-- [F-ID: SQL-0007-OWNED-TENANT-COUNT-NO-PARAM]
-- @version 1.0.0
-- @changelog 1.0.0 — Replaces owned_tenant_count(uuid)'s signature with
--   a no-argument owned_tenant_count(), reading auth.uid() internally
--   instead of trusting a caller-supplied user id. 0006 is not edited
--   in place (already applied against the live database) — this is a
--   new migration that supersedes 0006's function signature.
--
--   Why the parameter was removed (P2a): owned_tenant_count(uuid) was
--   grant-execute'd to `authenticated`, and Postgres RPC calls let any
--   authenticated caller pass ANY uuid as the argument — including
--   someone else's user id. That made it a metadata-enumeration
--   oracle: any signed-in user could call
--   `select owned_tenant_count('<some-other-users-uuid>')` directly via
--   PostgREST and learn exactly how many tenants a stranger owns. The
--   function only needs to answer "does the CALLER own 5+ tenants" for
--   the bootstrap policy below — it never needed an argument at all.
--   No-argument + internal auth.uid() closes the oracle entirely: the
--   function can now only ever report on the caller's own count.
--
--   Two related findings from the same audit pass, deliberately NOT
--   changed here (documented, not fixed, per explicit design decision):
--
--   P4 — owned_tenant_count() < 5 is a TOCTOU check under READ
--   COMMITTED: two concurrent INSERTs from the same user's own two
--   sessions could both read the same pre-increment count before
--   either commits, both see e.g. 4, and both pass the < 5 check,
--   letting a determined same-user race land a 6th owned tenant. Not
--   mitigated here — no unique constraint, SERIALIZABLE transaction, or
--   advisory lock is added. This is a deliberate scope decision: the
--   cap exists to bound a single well-behaved user's demo footprint,
--   not to hold under adversarial concurrent self-attack, and a
--   portfolio demo has no concurrent-signup load where this matters in
--   practice. The NestJS-side check in TenantsService.createTenant is
--   the primary, intention-expressing control; this RLS check is a
--   second barrier for the direct-JWT path, not an absolute guarantee
--   under concurrency — same honesty this project already applies
--   elsewhere about what RLS alone does and doesn't guarantee.
--
--   P2b — tenant_has_members(uuid) (0003) keeps its uuid parameter and
--   remains callable by any authenticated user with an arbitrary
--   tenant_id. This is a narrower, accepted existence oracle: it only
--   answers a boolean ("does this tenant have at least one member"),
--   never identity, role, or count data about who those members are.
--   The bootstrap flow functionally requires it — an unauthenticated
--   caller can't otherwise learn whether a tenant is "claimable" as
--   part of self-serve tenant creation. Ratified as-is: ownership
--   metadata is what P2a's fix protects; bare existence of a tenant is
--   not treated as sensitive here.

begin;

-- Drop the OLD policy first: it still references owned_tenant_count(uuid)
-- (0006's signature) in its WITH CHECK expression, and Postgres tracks
-- that as a dependency in pg_depend. Attempting to drop the function
-- while this policy still exists fails with "cannot drop function ...
-- because other objects depend on it". Policy comes back further down,
-- rebuilt against the new signature.
drop policy if exists "bootstrap_owner_or_owner_invites_member" on members;

-- Postgres overloads functions by argument signature: `create or
-- replace function owned_tenant_count()` does NOT replace
-- owned_tenant_count(uuid) — they're two distinct functions with the
-- same name. Without this explicit drop, 0006's parameterized version
-- would keep existing side by side with the new one, leaving the P2a
-- oracle fully exploitable and defeating the entire point of this
-- migration. Safe now that the policy above no longer references it.
drop function if exists public.owned_tenant_count(uuid);

create or replace function public.owned_tenant_count()
returns bigint
language sql
security definer
set search_path = public, pg_catalog
as $$
  select count(*) from members
  where user_id = (select auth.uid()) and role = 'owner';
$$;

revoke all on function public.owned_tenant_count() from public;
grant execute on function public.owned_tenant_count() to authenticated;

create policy "bootstrap_owner_or_owner_invites_member"
  on members for insert
  with check (
    (
      -- Bootstrap: caller claims 'owner' on a tenant with no members
      -- yet, and doesn't already own 5 or more tenants. Unchanged from
      -- 0006 except the function call: no argument now (see above).
      role = 'owner'
      and user_id = (select auth.uid())
      and not public.tenant_has_members(tenant_id)
      and public.owned_tenant_count() < 5
    )
    or (
      -- Invite: an existing owner adds a non-owner member. Unchanged
      -- from 0003/0006.
      role in ('staff', 'viewer')
      and tenant_id in (
        select tenant_id from members owner_row
        where owner_row.user_id = (select auth.uid())
          and owner_row.role = 'owner'
      )
    )
  );

commit;
