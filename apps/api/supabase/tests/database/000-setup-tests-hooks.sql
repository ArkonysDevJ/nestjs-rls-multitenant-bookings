-- apps/api/supabase/tests/database/000-setup-tests-hooks.sql
-- [F-ID: SQL-TEST-SETUP-01]
-- @version 1.0.0
-- @changelog 1.0.0 — Pre-test hook. Installs pgTAP plus the community
--   Basejump test helpers (tests.create_supabase_user,
--   tests.authenticate_as, etc.) used by every test file in this
--   directory. Files run in alphabetical order (`supabase test db`),
--   which is why this one is prefixed 000 — it must run first.
--   Source: https://supabase.com/docs/guides/local-development/testing/pgtap-extended

create extension if not exists pgtap with schema extensions;

-- dbdev: Postgres package manager, needed to install the test helpers
-- package below. Requires pg_tle + pgsql-http, both bundled in the
-- Supabase local dev Postgres image.
create extension if not exists http with schema extensions;
create extension if not exists pg_tle;
drop extension if exists "supabase-dbdev";
select pgtle.uninstall_extension_if_exists('supabase-dbdev');
select
    pgtle.install_extension(
        'supabase-dbdev',
        resp.contents ->> 'version',
        'PostgreSQL package manager',
        resp.contents ->> 'sql'
    )
from extensions.http(
    (
        'GET',
        'https://api.database.dev/rest/v1/'
        || 'package_versions?select=sql,version'
        || '&package_name=eq.supabase-dbdev'
        || '&order=version.desc'
        || '&limit=1',
        array[
            ('apiKey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhtdXB0cHBsZnZpaWZyYndtbXR2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE2ODAxMDczNzIsImV4cCI6MTk5NTY4MzM3Mn0.z2CN0mvO2No8wSi46Gw59DFGCTJrzM0AQKsu_5k134s')::extensions.http_header
        ],
        null,
        null
    )
) x,
lateral (
    select
        ((row_to_json(x) -> 'content') #>> '{}')::json -> 0
) resp(contents);
create extension "supabase-dbdev";
select dbdev.install('supabase-dbdev');
drop extension if exists "supabase-dbdev";
create extension "supabase-dbdev";

select dbdev.install('basejump-supabase_test_helpers');
create extension if not exists "basejump-supabase_test_helpers" version '0.0.6';

-- Smoke test: fail loudly here rather than let every other test file
-- fail obscurely if this setup step silently broke.
begin;
select plan(1);
select ok(true, 'Pre-test hook completed successfully');
select * from finish();
rollback;
