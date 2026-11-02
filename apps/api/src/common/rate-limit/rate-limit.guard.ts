// apps/api/src/common/rate-limit/rate-limit.guard.ts
// [F-ID: SRC-COMMON-RATE-LIMIT-01]
// @version 1.0.0
// @changelog 1.0.0 — In-memory fixed-window limiter, registered as a global
//   guard so it runs before AuthGuard: a rejected request never reaches
//   Supabase Auth. Two buckets per client, one for GET /v1/health (which needs
//   no authentication) and one for every other route. The client is the entry
//   of X-Forwarded-For counted from the right, RATE_LIMIT_TRUSTED_PROXY_HOPS
//   positions in: the entries on the left are written by the client and are
//   never trusted. The limiter is inactive unless all four RATE_LIMIT_*
//   variables are set, so a platform without the proxy in front (or without
//   the configuration) never shares one counter between every client.
//   Counters live in each instance and reset when it scales to zero.

import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';

export interface RateLimitConfig {
  windowMs: number;
  max: number;
  healthMax: number;
  trustedHops: number;
}

const MAX_TRACKED_CLIENTS = 50_000;
const HEALTH_PATH = '/v1/health';

function positiveInt(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return n > 0 ? n : null;
}

/** Returns null (limiter inactive) unless every variable is a positive integer. */
export function readRateLimitConfig(env: NodeJS.ProcessEnv): RateLimitConfig | null {
  const windowSeconds = positiveInt(env.RATE_LIMIT_WINDOW_SECONDS);
  const max = positiveInt(env.RATE_LIMIT_MAX);
  const healthMax = positiveInt(env.RATE_LIMIT_HEALTH_MAX);
  const trustedHops = positiveInt(env.RATE_LIMIT_TRUSTED_PROXY_HOPS);
  if (!windowSeconds || !max || !healthMax || !trustedHops) return null;
  return { windowMs: windowSeconds * 1000, max, healthMax, trustedHops };
}

/**
 * The client address: the entry of X-Forwarded-For `hops` positions from the
 * right (1 = the last entry), or the socket address when the header does not
 * have that many entries.
 */
export function clientAddress(request: FastifyRequest, hops: number): string {
  const header = request.headers['x-forwarded-for'];
  const raw = Array.isArray(header) ? header.join(',') : header ?? '';
  const entries = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return entries[entries.length - hops] ?? request.ip ?? 'unknown';
}

interface Counter {
  count: number;
  resetAt: number;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly config = readRateLimitConfig(process.env);
  private readonly counters = new Map<string, Counter>();
  private lastSweep = 0;

  canActivate(context: ExecutionContext): boolean {
    if (!this.config) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const now = Date.now();
    this.sweep(now);

    const path = request.url.split('?')[0];
    const health = path === HEALTH_PATH;
    const limit = health ? this.config.healthMax : this.config.max;
    const key = `${health ? 'health' : 'api'}:${clientAddress(request, this.config.trustedHops)}`;

    let counter = this.counters.get(key);
    if (!counter || counter.resetAt <= now) {
      counter = { count: 0, resetAt: now + this.config.windowMs };
      this.counters.set(key, counter);
    }
    counter.count += 1;

    if (counter.count > limit) {
      http
        .getResponse<FastifyReply>()
        .header('retry-after', String(Math.ceil((counter.resetAt - now) / 1000)));
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, message: 'Too many requests.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  /** Drops expired counters, and the oldest ones if the table is still too big. */
  private sweep(now: number): void {
    if (!this.config) return;
    if (now - this.lastSweep < this.config.windowMs && this.counters.size < MAX_TRACKED_CLIENTS) {
      return;
    }
    this.lastSweep = now;
    for (const [key, counter] of this.counters) {
      if (counter.resetAt <= now) this.counters.delete(key);
    }
    for (const key of this.counters.keys()) {
      if (this.counters.size < MAX_TRACKED_CLIENTS) break;
      this.counters.delete(key);
    }
  }
}
