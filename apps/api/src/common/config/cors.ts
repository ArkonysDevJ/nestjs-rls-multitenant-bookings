// apps/api/src/common/config/cors.ts
// [F-ID: SRC-COMMON-CORS-01]
// @version 1.0.0
// @changelog 1.0.0 — Allowed origins come from CORS_ORIGINS (comma-separated
//   list). Fails closed: when the variable is missing or empty no cross-origin
//   request is allowed, and a wildcard is never produced. For local
//   development with the web app, set CORS_ORIGINS=http://localhost:5173.

import type { FastifyCorsOptions } from '@fastify/cors';

export function parseAllowedOrigins(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0 && origin !== '*');
}

export function corsOptions(env: NodeJS.ProcessEnv): FastifyCorsOptions {
  const origins = parseAllowedOrigins(env.CORS_ORIGINS);
  return {
    // `false` turns CORS off: no Access-Control-* headers at all.
    origin: origins.length > 0 ? origins : false,
    methods: ['GET', 'POST', 'PATCH'],
  };
}
