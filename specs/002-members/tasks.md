# Tasks: members

Status: `[x]` done, `[ ]` open.

## Done

- [x] Invite by email, owner only, `staff`/`viewer` only — `apps/api/src/members/members.controller.ts`, `members.service.ts`, `dto/add-member.dto.ts`
- [x] Email lookup as a server-side function — `apps/api/supabase/migrations/0004_member_lookup_by_email.sql`
- [x] Direct insert into `members` closed: the insert policy (whose invite branch recursed, `42P17`) was removed and `authenticated` has no `insert` privilege — `apps/api/supabase/migrations/0012_explicit_privileges.sql`
- [x] pgTAP test that a direct insert into `members` is refused by privilege, not by `42P17` — `apps/api/supabase/tests/database/005-explicit-privileges.test.sql`
- [x] Bruno requests for a successful invitation and for the refusals by role and by tenant, and for the refused direct insert — `apps/api/bruno/signup/`
- [x] Unit spec for the intent of `addMember` and `findMembership` — `apps/api/src/members/members.service.spec.ts`
- [x] Invite form for owners in the web app — `apps/web/src/App.tsx`

## Open

- [ ] Add Bruno requests for a duplicate invitation (409) and an unknown email (404) under `apps/api/bruno/signup/`.
- [ ] Removing a member and changing a role are not implemented. Each needs a route, a grant and tests.
