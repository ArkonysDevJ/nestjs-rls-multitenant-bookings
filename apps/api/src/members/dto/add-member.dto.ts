// apps/api/src/members/dto/add-member.dto.ts
// [F-ID: SRC-MEMBERS-DTO-ADD-MEMBER-01]
// @version 1.1.0
// @changelog 1.1.0 — email replaces userId: an owner has the invitee's
//   email, not their UUID. MembersService resolves it server-side via
//   find_user_id_by_email() (see migration 0004) before inserting.
// @changelog 1.0.0 — POST /members payload. tenant_id is never accepted
//   here — it comes from TenantContext (x-tenant-id header + membership
//   check), same rule as CreateBookingDto. 'owner' is deliberately not
//   an allowed value: this endpoint only invites staff/viewer, matching
//   the members_insert RLS policy (0003 migration), which does not let
//   an owner mint a second owner through this path.

import { IsEmail, IsIn } from 'class-validator';

export class AddMemberDto {
  @IsEmail()
  email!: string;

  @IsIn(['staff', 'viewer'])
  role!: 'staff' | 'viewer';
}
