-- apps/api/supabase/tests/database/004-function-execute-privileges.test.sql
--
-- Who may call each public function. Supabase grants EXECUTE on new functions
-- to anon, authenticated and service_role by default, and `revoke ... from
-- public` does not remove those grants, so each function must be restricted
-- explicitly to the roles that need it:
--
--   find_user_id_by_email(text)  service_role only (an email lookup that anyone
--                                could call would be an account-enumeration
--                                oracle, reachable with the public key alone)
--   ping()                       service_role only
--   tenant_has_members(uuid)     authenticated + service_role (used by an RLS
--                                policy, which runs as the caller)
--   owned_tenant_count()         authenticated + service_role (same)
--
-- The privileges are asserted from the catalog. A direct SQL call to a function
-- the role cannot execute is not made here: on the Postgres 17.6 image the local
-- stack uses, that error crashes the server (signal 11) when it arrives over the
-- simple query protocol. Through PostgREST the same call returns a normal 401/403,
-- so the denial over HTTP is asserted in the Bruno collection instead
-- (apps/api/bruno/security-tests/06-*.bru). The calls below are the ones that
-- must keep working.

begin;

select plan(17);

select tests.create_supabase_user('alice', 'alice@example.test');

-- ─── Catalog: who has EXECUTE ───────────────────────────────────────────

select ok(not has_function_privilege('anon', 'public.find_user_id_by_email(text)', 'execute'),
  'find_user_id_by_email: anon cannot execute');
select ok(not has_function_privilege('authenticated', 'public.find_user_id_by_email(text)', 'execute'),
  'find_user_id_by_email: authenticated cannot execute');
select ok(has_function_privilege('service_role', 'public.find_user_id_by_email(text)', 'execute'),
  'find_user_id_by_email: service_role can execute');

select ok(not has_function_privilege('anon', 'public.ping()', 'execute'),
  'ping: anon cannot execute');
select ok(not has_function_privilege('authenticated', 'public.ping()', 'execute'),
  'ping: authenticated cannot execute');
select ok(has_function_privilege('service_role', 'public.ping()', 'execute'),
  'ping: service_role can execute');

select ok(not has_function_privilege('anon', 'public.tenant_has_members(uuid)', 'execute'),
  'tenant_has_members: anon cannot execute');
select ok(has_function_privilege('authenticated', 'public.tenant_has_members(uuid)', 'execute'),
  'tenant_has_members: authenticated can execute (an RLS policy needs it)');
select ok(has_function_privilege('service_role', 'public.tenant_has_members(uuid)', 'execute'),
  'tenant_has_members: service_role can execute');

select ok(not has_function_privilege('anon', 'public.owned_tenant_count()', 'execute'),
  'owned_tenant_count: anon cannot execute');
select ok(has_function_privilege('authenticated', 'public.owned_tenant_count()', 'execute'),
  'owned_tenant_count: authenticated can execute (an RLS policy needs it)');
select ok(has_function_privilege('service_role', 'public.owned_tenant_count()', 'execute'),
  'owned_tenant_count: service_role can execute');

-- ─── Calling the policy functions as a signed-in user ───────────────────

select tests.authenticate_as('alice');

select lives_ok($$ select public.tenant_has_members('11111111-1111-4111-8111-111111111111') $$,
  'a signed-in user can still call tenant_has_members');
select lives_ok($$ select public.owned_tenant_count() $$,
  'a signed-in user can still call owned_tenant_count');

-- ─── Calling them as the service role (what the API uses) ───────────────

select tests.authenticate_as_service_role();

select is(public.find_user_id_by_email('alice@example.test'), tests.get_supabase_uid('alice'),
  'service_role finds an existing user by email');
select is(public.find_user_id_by_email('nobody@example.test'), null,
  'service_role gets null for an unknown email');
select is(public.ping(), true, 'service_role can call ping');

select * from finish();

rollback;
