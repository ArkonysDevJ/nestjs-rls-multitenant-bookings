# Feature: bookings

## Summary

Members of a tenant book a time range on one of the tenant's resources. Two
confirmed bookings of the same resource never overlap. An owner can cancel a
confirmed booking; cancelled is final.

## Actors

- **owner** and **staff**: create bookings.
- **owner**: cancels bookings.
- **viewer**: reads bookings only.

## Scenarios

### Create a booking — `POST /v1/bookings`

Headers: `Authorization`, `x-tenant-id`. Body:
`{ "resourceId": <uuid>, "startsAt": <ISO 8601>, "endsAt": <ISO 8601> }`.

| Given | When | Then |
|---|---|---|
| An owner or staff member, a resource of their tenant, a free slot | They book it | 201 with the booking (`id`, `resourceId`, `createdBy`, `startsAt`, `endsAt`, `status: "confirmed"`, `createdAt`); `createdBy` is the caller |
| The slot overlaps a confirmed booking of the same resource | They book it | 409, message about overlapping bookings, `code: "23P01"` |
| `resourceId` belongs to **another tenant** | They book it | 404 `{ statusCode: 404, message: "The requested resource was not found.", code: "RESOURCE_NOT_FOUND" }` |
| `resourceId` does not exist | They book it | the **same** 404 as above, whether the slot of the foreign resource is busy or free |
| A viewer | They book | 403 |
| Body has an unknown property (for example `tenant_id`) or `resourceId` is not a UUID | They book | 400 |
| Caller is not a member of `x-tenant-id` | They book | 401 |

### List bookings — `GET /v1/bookings[?resource_id=<uuid>]`

Any member gets the tenant's bookings ordered by `startsAt`, optionally for one
resource. A `resource_id` that is not a UUID is a 400.

### Cancel a booking — `PATCH /v1/bookings/:id/cancel`

| Given | When | Then |
|---|---|---|
| An owner and a confirmed booking of their tenant | They cancel it | 200 with the booking, `status: "cancelled"` |
| The booking is already cancelled | They cancel it | 409 `Only a confirmed booking can be cancelled.`; the booking does not change |
| The booking does not exist, or belongs to another tenant | They cancel it | 404 `Booking not found.`, the same body in both cases |
| `:id` is not a UUID | They cancel | 400 |
| Staff or viewer | They cancel | 403 |

## Requirements

- **FR-1** `tenant_id` and `created_by` come from the request context and the
  token, never from the body.
- **FR-2** A booking may only reference a resource of its own tenant. This holds
  for any writer, including the service role and a client using a user JWT.
- **FR-3** No two confirmed bookings of one resource overlap in time, even under
  simultaneous requests.
- **FR-4** The response for a resource or booking of another tenant is
  indistinguishable from one that does not exist. This includes the error code
  for a busy versus a free slot.
- **FR-5** With a user JWT straight on the database, an owner can change a
  booking in one way only: `confirmed` to `cancelled`. `created_by`,
  `resource_id`, `tenant_id` and the time range cannot be rewritten, and a
  cancelled booking cannot be confirmed again.
- **FR-6** A booking cannot be rescheduled; the only change after creation is
  cancelling it.

## Out of scope

Rescheduling, partial cancellation, recurring bookings, notifications.

## Known gap

A booking with `endsAt` equal to or before `startsAt` is rejected by the
database but the API answers 500 instead of 400 (see `tasks.md`).
