// apps/api/src/common/guards/auth.guard.ts
// [F-ID: SRC-COMMON-GUARD-AUTH-01]
// @version 1.0.0
// @changelog 1.0.0 — JWT-only guard for pre-tenant-selection routes (e.g. list my tenants).

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { getSupabaseAdminClient } from '../supabase/supabase.client';

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
  }
}

/**
 * Verifies the caller's JWT and attaches request.userId, without
 * resolving a tenant. Used by routes that run before a tenant is
 * selected (e.g. "list my tenants" for a tenant switcher UI).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const header = request.headers['authorization'];

    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token.');
    }

    const token = header.slice('Bearer '.length).trim();
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      throw new UnauthorizedException('Invalid or expired token.');
    }

    request.userId = data.user.id;
    return true;
  }
}
