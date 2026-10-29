# Tasks: members

Status: `[x]` done, `[ ]` open.

## Done

- [x] Invite by email, owner only, `staff`/`viewer` only — `apps/api/src/members/members.controller.ts`, `members.service.ts`, `dto/add-member.dto.ts`
- [x] Email lookup as a server-side function — `apps/api/supabase/migrations/0004_member_lookup_by_email.sql`
- [x] Insert policy for the first owner and for owners inviting — `apps/api/supabase/migrations/0003_self_serve_membership.sql`
- [x] Unit spec for the intent of `addMember` and `findMembership` — `apps/api/src/members/members.service.spec.ts`
- [x] Invite form for owners in the web app — `apps/web/src/App.tsx`

## Open

- [ ] Add a Bruno request for a successful invitation, a duplicate (409) and an unknown email (404) under `apps/api/bruno/`.
- [ ] Add a pgTAP test for the member-insert policy: an owner can add `staff`/`viewer`; nobody can add an `owner` to a tenant that already has members — `apps/api/supabase/tests/database/`.
- [ ] Removing a member and changing a role are not implemented. Each needs a route, a policy, a grant and tests.
