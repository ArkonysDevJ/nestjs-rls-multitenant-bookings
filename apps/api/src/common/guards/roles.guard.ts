// apps/api/src/common/guards/roles.guard.ts
// [F-ID: SRC-COMMON-GUARD-ROLES-01]
// @version 1.0.0
// @changelog 1.0.0 — Authorizes @Roles(...) against the tenant role set by TenantGuard.

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyRequest } from 'fastify';
import { MemberRole, ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Authorizes a request against @Roles(...) once TenantGuard has already
 * populated request.tenantContext. Must run after TenantGuard.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<MemberRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const role = request.tenantContext?.role;

    if (!role || !requiredRoles.includes(role)) {
      throw new ForbiddenException(
        `Role '${role ?? 'unknown'}' is not allowed to perform this action.`,
      );
    }

    return true;
  }
}
