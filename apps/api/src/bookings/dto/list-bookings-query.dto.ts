// apps/api/src/bookings/dto/list-bookings-query.dto.ts
// [F-ID: SRC-BOOKINGS-DTO-LIST-BOOKINGS-QUERY-01]
// @version 1.0.0
// @changelog 1.0.0 — Optional resource_id filter for GET /bookings.

import { IsOptional, IsUUID } from 'class-validator';

export class ListBookingsQueryDto {
  @IsOptional()
  @IsUUID()
  resource_id?: string;
}
