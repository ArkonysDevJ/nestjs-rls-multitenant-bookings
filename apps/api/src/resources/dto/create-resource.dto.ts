// apps/api/src/resources/dto/create-resource.dto.ts
// [F-ID: SRC-RESOURCES-DTO-CREATE-RESOURCE-01]
// @version 1.0.0
// @changelog 1.0.0 — POST /resources payload. No tenant_id here — it
//   comes from TenantContext, same rule as CreateBookingDto/CreateTenantDto.

import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

export class CreateResourceDto {
  @IsString()
  @Length(1, 120)
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;
}
