// apps/api/src/common/types/tenant-context.ts
// [F-ID: SRC-COMMON-TYPES-TENANT-CONTEXT-01]
// @version 1.0.0
// @changelog 1.0.0 — Shape of the identity object TenantGuard attaches to each request.

import { MemberRole } from '../decorators/roles.decorator';

/**
 * Identity resolved from the caller's JWT plus their membership row for
 * the active tenant. Populated by TenantGuard and read by RolesGuard and
 * downstream services/controllers. Never trust a tenant id or role coming
 * from the request body, query string, or a manually-set header — this is
 * the only source of truth for "who is calling, for which tenant".
 */
export interface TenantContext {
  userId: string;
  tenantId: string;
  role: MemberRole;
}
