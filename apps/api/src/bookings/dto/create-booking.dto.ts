// apps/api/src/bookings/dto/create-booking.dto.ts
// [F-ID: SRC-BOOKINGS-DTO-CREATE-BOOKING-01]
// @version 1.0.0
// @changelog 1.0.0 — POST /bookings payload. No tenant_id/created_by — those come from context.

import { IsISO8601, IsUUID } from 'class-validator';

/**
 * tenant_id and created_by are intentionally absent here. They are never
 * accepted from the client — tenant_id comes from TenantContext (resolved
 * from the x-tenant-id header + membership check) and created_by comes
 * from the authenticated user id. Accepting either from the request body
 * would let a caller impersonate another tenant or another user.
 */
export class CreateBookingDto {
  @IsUUID()
  resourceId!: string;

  @IsISO8601()
  startsAt!: string;

  @IsISO8601()
  endsAt!: string;
}
