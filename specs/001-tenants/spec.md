# Feature: tenants

## Summary

A signed-in user can see the tenants they belong to, with their role in each,
and can create a new tenant, becoming its owner. These are the only routes that
do not need `x-tenant-id`: they are about the caller, not about one tenant.

## Scenarios

### List my tenants — `GET /v1/tenants/me`

| Given | When | Then |
|---|---|---|
| A valid bearer token | The caller asks | 200, `[{ "id", "name", "role" }]`, one entry per membership; `[]` if there are none |
| No token, or an invalid or expired one | The caller asks | 401 |

### Create a tenant — `POST /v1/tenants`

Body: `{ "name": <string, 1 to 120 characters> }`.

| Given | When | Then |
|---|---|---|
| A valid token and fewer than 5 owned tenants | They create `"Acme"` | 201 with `{ "id", "name": "Acme", "role": "owner" }`, and the caller is now the tenant's owner |
| The caller already owns 5 tenants | They create another | 403 `You can own at most 5 tenants.` |
| Empty name, or an unknown property in the body | They create | 400 |
| No valid token | They create | 401 |

## Requirements

- **FR-1** Creating a tenant also creates the owner membership for the caller. If
  the membership cannot be created, the new tenant is deleted, so a tenant never
  exists without an owner.
- **FR-2** A user owns at most 5 tenants. The API checks it, and a policy checks
  it again for a client using a user JWT.
- **FR-3** The list only contains tenants the caller is a member of.

## Out of scope

Renaming or deleting a tenant, transferring ownership, more than one owner per
tenant.

## Known behaviour

`GET /v1/tenants/me` answers an empty list, not an error, if the tenants query
itself fails.
