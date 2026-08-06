// apps/api/src/common/decorators/roles.decorator.ts
// [F-ID: SRC-COMMON-DECORATOR-ROLES-01]
// @version 1.0.0
// @changelog 1.0.0 — @Roles(...) metadata decorator consumed by RolesGuard.

import { SetMetadata } from '@nestjs/common';

export type MemberRole = 'owner' | 'staff' | 'viewer';

export const ROLES_KEY = 'roles';

/**
 * Declares which tenant roles may access a route. Combined with
 * `RolesGuard`, which reads the caller's role for the active tenant
 * from `request.tenantContext`.
 */
export const Roles = (...roles: MemberRole[]) => SetMetadata(ROLES_KEY, roles);
