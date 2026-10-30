# Feature: members

## Summary

An owner invites someone who already has an account to their tenant, as `staff`
or `viewer`, using the person's email.

## Scenarios

### Invite a member — `POST /v1/members`

Headers: `Authorization`, `x-tenant-id`. Body:
`{ "email": <email>, "role": "staff" | "viewer" }`.

| Given | When | Then |
|---|---|---|
| An owner of the tenant and an email with an account | They invite it as `staff` | 201 `{ "tenantId", "role": "staff" }` |
| No account has that email | They invite it | 404 `No account found for that email. The invitee must sign up first.` |
| That user is already a member of the tenant | They invite them | 409 (`code: "23505"`) |
| `role` is `owner` or anything else, or `email` is not an email | They invite | 400 |
| The caller is staff or viewer | They invite | 403 |
| The caller is not a member of `x-tenant-id` | They invite | 401 |

## Requirements

- **FR-1** The tenant of the new membership comes from the request context,
  never from the body.
- **FR-2** Only `staff` and `viewer` can be granted; there is exactly one owner
  path, creating the tenant.
- **FR-3** The email-to-user lookup runs on the server with the service role.
  The API never returns the user id it finds.
- **FR-4** A user has at most one membership per tenant.

## Out of scope

Removing a member, changing a role, inviting someone who has no account yet,
more than one owner per tenant.
