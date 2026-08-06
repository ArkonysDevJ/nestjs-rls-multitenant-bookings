// apps/api/src/tenants/dto/create-tenant.dto.ts
// [F-ID: SRC-TENANTS-DTO-CREATE-TENANT-01]
// @version 1.0.0
// @changelog 1.0.0 — POST /tenants payload. No owner id here: the caller
//   becomes the owner, resolved from the JWT, never from the body.

import { IsString, Length } from 'class-validator';

export class CreateTenantDto {
  @IsString()
  @Length(1, 120)
  name!: string;
}
