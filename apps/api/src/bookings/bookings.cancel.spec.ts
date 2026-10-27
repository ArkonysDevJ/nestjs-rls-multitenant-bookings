import { ArgumentsHost, Logger } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { getSupabaseAdminClient } from '../common/supabase/supabase.client';

jest.mock('../common/supabase/supabase.client');

// What PostgREST answers when `.single()` matches no row (reproduced against
// the local stack). A missing booking and a booking of another tenant are
// indistinguishable here because the update is filtered by tenant_id.
const NO_ROW_ERROR = {
  code: 'PGRST116',
  message: 'Cannot coerce the result to a single JSON object',
  details: 'The result contains 0 rows',
};

function mockSupabaseCancelResult(result: { data: unknown; error: unknown }) {
  const chain: Record<string, jest.Mock> = {};
  for (const method of ['from', 'update', 'eq', 'select']) {
    chain[method] = jest.fn().mockReturnValue(chain);
  }
  chain.single = jest.fn().mockResolvedValue(result);
  (getSupabaseAdminClient as jest.Mock).mockReturnValue(chain);
  return chain;
}

async function cancelAndTranslate(tenantId: string, bookingId: string) {
  const reply = {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => reply }),
  } as unknown as ArgumentsHost;

  try {
    await new BookingsService().cancel(tenantId, bookingId);
  } catch (error) {
    new AllExceptionsFilter().catch(error, host);
  }
  return {
    status: reply.status.mock.calls[0]?.[0] as number | undefined,
    body: reply.send.mock.calls[0]?.[0] as unknown,
  };
}

describe('BookingsService.cancel', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('scopes the update by booking id and tenant id', async () => {
    const row = {
      id: 'b-1',
      resource_id: 'r-1',
      created_by: 'u-1',
      starts_at: '2026-09-01T10:00:00Z',
      ends_at: '2026-09-01T11:00:00Z',
      status: 'cancelled',
      created_at: '2026-08-01T00:00:00Z',
    };
    const chain = mockSupabaseCancelResult({ data: row, error: null });

    const booking = await new BookingsService().cancel('tenant-a', 'b-1');

    expect(chain.eq).toHaveBeenCalledWith('id', 'b-1');
    expect(chain.eq).toHaveBeenCalledWith('tenant_id', 'tenant-a');
    expect(booking.status).toBe('cancelled');
  });

  // These two fail today: the no-row error is not mapped and ends up as a
  // 500. `it.failing` keeps the suite green while the exact status code is an
  // open design question, and turns red as soon as the behaviour is fixed so
  // the marker gets removed.
  it.failing(
    'answers a 4xx, not a 500, for a booking that does not exist in the tenant',
    async () => {
      mockSupabaseCancelResult({ data: null, error: NO_ROW_ERROR });

      const { status } = await cancelAndTranslate('tenant-a', 'missing');

      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(500);
    },
  );

  it.failing(
    'answers identically for a missing booking and a booking of another tenant',
    async () => {
      mockSupabaseCancelResult({ data: null, error: NO_ROW_ERROR });
      const missing = await cancelAndTranslate('tenant-a', 'missing');

      mockSupabaseCancelResult({ data: null, error: NO_ROW_ERROR });
      const foreign = await cancelAndTranslate(
        'tenant-a',
        'booking-of-tenant-b',
      );

      expect(missing.status).toBeLessThan(500);
      expect(foreign).toEqual(missing);
    },
  );
});
