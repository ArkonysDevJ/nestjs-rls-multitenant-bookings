import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { recordSupabase } from '../common/testing/supabase-recorder';

jest.mock('../common/supabase/supabase.client');

// These specs certify the intent of the service: that every tenant-scoped
// query carries the tenant filter and where the tenant value of a write comes
// from. They do not show the database rejecting anything (pgTAP and Bruno do).
// Cancellation is covered in bookings.cancel.spec.ts.

const TENANT = 'tenant-from-context';
const USER = 'user-from-context';

const ROW = {
  id: 'b-1',
  resource_id: 'r-1',
  created_by: USER,
  starts_at: '2026-09-01T10:00:00Z',
  ends_at: '2026-09-01T11:00:00Z',
  status: 'confirmed',
  created_at: '2026-08-01T00:00:00Z',
};

describe('BookingsService.listForTenant', () => {
  it('filters by the tenant it was given', async () => {
    const recorder = recordSupabase({ data: [ROW], error: null });

    await new BookingsService().listForTenant(TENANT);

    expect(recorder.eqFilters()).toContainEqual(['tenant_id', TENANT]);
  });

  it('keeps the tenant filter when it also filters by resource', async () => {
    const recorder = recordSupabase({ data: [ROW], error: null });

    await new BookingsService().listForTenant(TENANT, 'r-1');

    expect(recorder.eqFilters()).toContainEqual(['tenant_id', TENANT]);
    expect(recorder.eqFilters()).toContainEqual(['resource_id', 'r-1']);
  });

  it('never filters by any other tenant value', async () => {
    const recorder = recordSupabase({ data: [], error: null });

    await new BookingsService().listForTenant(TENANT, 'r-1');

    const tenantValues = recorder
      .eqFilters()
      .filter(([column]) => column === 'tenant_id')
      .map(([, value]) => value);
    expect(tenantValues).toEqual([TENANT]);
  });
});

describe('BookingsService.create', () => {
  const dto: CreateBookingDto = {
    resourceId: 'r-1',
    startsAt: '2026-09-01T10:00:00Z',
    endsAt: '2026-09-01T11:00:00Z',
  };

  it('takes tenant_id and created_by from its arguments, not from the dto', async () => {
    const recorder = recordSupabase({ data: ROW, error: null });

    await new BookingsService().create(TENANT, USER, dto);

    expect(recorder.insertedPayload()).toEqual({
      tenant_id: TENANT,
      resource_id: 'r-1',
      created_by: USER,
      starts_at: dto.startsAt,
      ends_at: dto.endsAt,
    });
  });

  it.each(['tenant_id', 'tenantId', 'created_by', 'createdBy', 'status'])(
    'ignores a %s smuggled in the dto',
    async (field) => {
      const recorder = recordSupabase({ data: ROW, error: null });
      const smuggled = { ...dto, [field]: 'attacker' } as CreateBookingDto;

      await new BookingsService().create(TENANT, USER, smuggled);

      const payload = recorder.insertedPayload();
      expect(payload.tenant_id).toBe(TENANT);
      expect(payload.created_by).toBe(USER);
      expect(Object.values(payload)).not.toContain('attacker');
    },
  );
});
