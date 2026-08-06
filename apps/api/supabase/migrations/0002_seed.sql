-- apps/api/supabase/migrations/0002_seed.sql
-- [F-ID: SQL-0002-SEED]
-- @version 1.0.0
-- @changelog 1.0.0 — Two demo tenants + resources so isolation is visible
--            without the evaluator creating data first.
--
-- Sample data for two tenants so the deployed demo shows real isolation
-- without the evaluator having to create data first.
--
-- NOTE: this file intentionally does NOT create auth.users rows — Supabase
-- Auth users must exist first (sign up via the deployed frontend or the
-- Supabase dashboard), then their auth.uid() values are substituted below
-- before this migration is applied. See README (added once the app is
-- deployed) for the exact seeding steps.

begin;

insert into tenants (id, name) values
  ('00000000-0000-0000-0000-000000000001', 'Aurora Studio'),
  ('00000000-0000-0000-0000-000000000002', 'Riverside Clinic')
on conflict (id) do nothing;

insert into resources (id, tenant_id, name, capacity, active) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Studio Room A', 8, true),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Studio Room B', 4, true),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', 'Consult Room 1', 2, true)
on conflict (id) do nothing;

-- members rows depend on real auth.users ids and are inserted separately
-- once demo accounts exist (see seeding steps in README).

commit;
