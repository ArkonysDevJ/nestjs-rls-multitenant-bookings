// src/lib/api.ts
// [F-ID: FE-LIB-API-01]
// @version 1.5.0
// @changelog 1.5.0 — Content-Type: application/json is now only sent
//   when there's an actual body. cancelBooking (PATCH, no body) was
//   getting the header unconditionally, which Fastify's body parser
//   rejects outright ("Body cannot be empty when content-type is set
//   to 'application/json'") — a 400 before the route handler ever runs.
// @changelog 1.4.0 — Error handling no longer dumps the raw response
//   body into the thrown Error. The backend's AllExceptionsFilter always
//   returns JSON with a `message` field (e.g. the 409 overlap message);
//   this was previously thrown as-is (`"409 Conflict: {\"statusCode\"...}"`),
//   which every form's error <p> rendered verbatim — an unreadable raw
//   JSON dump on screen. Now parsed and reduced to just the message,
//   with the raw body kept as a fallback if parsing fails.
// @changelog 1.3.0 — Added createResource (POST /resources, owner-only).
// @changelog 1.2.0 — addMember now takes an email, not a raw user id —
//   matches AddMemberDto 1.1.0 on the backend.
// @changelog 1.1.0 — Added createTenant (POST /tenants) and addMember
//   (POST /members, owner-only) for the self-service bootstrap flow.
// @changelog 1.0.0 — Fetch wrapper against the backend. Attaches the
//   active Supabase session's access_token as a Bearer token, plus
//   x-tenant-id when an active tenant is known. The backend is the
//   only thing that decides whether that combination is valid.

import { supabase } from './supabase';

const API_URL = import.meta.env.VITE_API_URL as string;

/** An error response from the API, with the HTTP status kept for callers. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function authorizedFetch(
  path: string,
  options: { tenantId?: string; init?: RequestInit } = {},
) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error('No active session');
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...(options.init?.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.init?.headers as Record<string, string> | undefined),
  };

  if (options.tenantId) {
    headers['x-tenant-id'] = options.tenantId;
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options.init,
    headers,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new ApiError(response.status, extractErrorMessage(response.status, body));
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

/**
 * AllExceptionsFilter always responds with JSON shaped like
 * `{ statusCode, message, ... }`. Extract just `message` for display —
 * falling back to the raw body only if it isn't the JSON shape we
 * expect, so nothing is silently swallowed.
 */
function extractErrorMessage(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: string | string[] };
    if (Array.isArray(parsed.message)) {
      // class-validator's ValidationPipe returns message as a string[].
      return parsed.message.join(' ');
    }
    if (typeof parsed.message === 'string') {
      return parsed.message;
    }
  } catch {
    // Not JSON — fall through to the raw-body fallback below.
  }
  return `${status}: ${body}`;
}

export type MemberRole = 'owner' | 'staff' | 'viewer';

export interface Tenant {
  id: string;
  name: string;
  role: MemberRole;
}

export interface Resource {
  id: string;
  name: string;
  capacity: number | null;
  active: boolean;
}

export interface Booking {
  id: string;
  resourceId: string;
  createdBy: string;
  startsAt: string;
  endsAt: string;
  status: 'confirmed' | 'cancelled';
  createdAt: string;
}

export const api = {
  listMyTenants: (): Promise<Tenant[]> => authorizedFetch('/tenants/me'),

  createTenant: (name: string): Promise<Tenant> =>
    authorizedFetch('/tenants', {
      init: { method: 'POST', body: JSON.stringify({ name }) },
    }),

  addMember: (
    tenantId: string,
    input: { email: string; role: 'staff' | 'viewer' },
  ): Promise<{ tenantId: string; role: MemberRole }> =>
    authorizedFetch('/members', {
      tenantId,
      init: { method: 'POST', body: JSON.stringify(input) },
    }),

  listResources: (tenantId: string): Promise<Resource[]> =>
    authorizedFetch('/resources', { tenantId }),

  createResource: (
    tenantId: string,
    input: { name: string; capacity?: number },
  ): Promise<Resource> =>
    authorizedFetch('/resources', {
      tenantId,
      init: { method: 'POST', body: JSON.stringify(input) },
    }),

  listBookings: (tenantId: string, resourceId?: string): Promise<Booking[]> =>
    authorizedFetch(
      resourceId
        ? `/bookings?resource_id=${encodeURIComponent(resourceId)}`
        : '/bookings',
      { tenantId },
    ),

  createBooking: (
    tenantId: string,
    input: { resourceId: string; startsAt: string; endsAt: string },
  ): Promise<Booking> =>
    authorizedFetch('/bookings', {
      tenantId,
      init: { method: 'POST', body: JSON.stringify(input) },
    }),

  cancelBooking: (tenantId: string, bookingId: string): Promise<Booking> =>
    authorizedFetch(`/bookings/${bookingId}/cancel`, {
      tenantId,
      init: { method: 'PATCH' },
    }),
};
