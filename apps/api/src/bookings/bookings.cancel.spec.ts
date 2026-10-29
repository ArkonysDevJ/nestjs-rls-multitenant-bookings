import { ArgumentsHost, Logger } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { getSupabaseAdminClient } from '../common/supabase/supabase.client';

jest.mock('../common/supabase/supabase.client');

// What PostgREST answers when `.single()` matches no row (reproduced against
// the local stack): the update filtered by id, tenant and status matched
// nothing.
const NO_ROW_ERROR = {
  code: 'PGRST116',
  message: 'Cannot coerce the result to a single JSON object',
  details: 'The result contains 0 rows',
};

const CANCELLED_ROW = {
  id: 'b-1',
  resource_id: 'r-1',
  created_by: 'u-1',
  starts_at: '2026-09-01T10:00:00Z',
  ends_at: '2026-09-01T11:00:00Z',
  status: 'cancelled',
  created_at: '2026-08-01T00:00:00Z',
};

interface CancelMocks {
  /** Result of the UPDATE ... .single() */
  update: { data: unknown; error: unknown };
  /** Result of the follow-up read of the booking, filtered by tenant */
  lookup?: { data: unknown; error: unknown };
}

function mockSupabaseCancel({ update, lookup }: CancelMocks) {
  const chain: Record<string, jest.Mock> = {};
  for (const method of ['from', 'update', 'eq', 'select']) {
    chain[method] = jest.fn().mockReturnValue(chain);
  }
  chain.single = jest.fn().mockResolvedValue(update);
  chain.maybeSingle = jest
    .fn()
    .mockResolvedValue(lookup ?? { data: null, error: null });
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

  it('cancels with one update scoped by booking id, tenant id and the confirmed status', async () => {
    const chain = mockSupabaseCancel({
      update: { data: CANCELLED_ROW, error: null },
    });

    const booking = await new BookingsService().cancel('tenant-a', 'b-1');

    expect(chain.update).toHaveBeenCalledWith({ status: 'cancelled' });
    expect(chain.eq).toHaveBeenCalledWith('id', 'b-1');
    expect(chain.eq).toHaveBeenCalledWith('tenant_id', 'tenant-a');
    expect(chain.eq).toHaveBeenCalledWith('status', 'confirmed');
    expect(booking.status).toBe('cancelled');
    expect(chain.maybeSingle).not.toHaveBeenCalled();
  });

  it('answers 404, not 500, for a booking that does not exist in the tenant', async () => {
    mockSupabaseCancel({
      update: { data: null, error: NO_ROW_ERROR },
      lookup: { data: null, error: null },
    });

    const { status, body } = await cancelAndTranslate('tenant-a', 'missing');

    expect(status).toBe(404);
    expect(body).toEqual(
      expect.objectContaining({ statusCode: 404, message: 'Booking not found.' }),
    );
  });

  it('looks the booking up by tenant id, so a booking of another tenant is never seen', async () => {
    const chain = mockSupabaseCancel({
      update: { data: null, error: NO_ROW_ERROR },
    });

    await cancelAndTranslate('tenant-a', 'booking-of-tenant-b');

    // Both the update and the lookup carry the tenant filter. The real
    // answer for a booking of another tenant is exercised end to end in the
    // Bruno cancel requests, where the data is not a mock.
    const tenantFilters = chain.eq.mock.calls.filter(
      ([column]) => column === 'tenant_id',
    );
    expect(tenantFilters).toEqual([
      ['tenant_id', 'tenant-a'],
      ['tenant_id', 'tenant-a'],
    ]);
  });

  it('answers 409 and does not touch the booking when it is not confirmed', async () => {
    const chain = mockSupabaseCancel({
      update: { data: null, error: NO_ROW_ERROR },
      lookup: { data: { status: 'cancelled' }, error: null },
    });

    const { status, body } = await cancelAndTranslate('tenant-a', 'b-1');

    expect(status).toBe(409);
    expect(body).toEqual(
      expect.objectContaining({
        statusCode: 409,
        message: 'Only a confirmed booking can be cancelled.',
      }),
    );
    expect(chain.update).toHaveBeenCalledTimes(1);
  });

  it('does not turn an unrelated database error into a 404', async () => {
    mockSupabaseCancel({
      update: { data: null, error: { code: 'XX000', message: 'boom' } },
    });

    const { status } = await cancelAndTranslate('tenant-a', 'b-1');

    expect(status).toBe(500);
  });

  it('does not turn a failing lookup into a 404', async () => {
    mockSupabaseCancel({
      update: { data: null, error: NO_ROW_ERROR },
      lookup: { data: null, error: { code: 'XX000', message: 'boom' } },
    });

    const { status } = await cancelAndTranslate('tenant-a', 'b-1');

    expect(status).toBe(500);
  });
});
