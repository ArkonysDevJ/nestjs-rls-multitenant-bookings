import { ResourcesService } from './resources.service';
import { CreateResourceDto } from './dto/create-resource.dto';
import { recordSupabase } from '../common/testing/supabase-recorder';

jest.mock('../common/supabase/supabase.client');

// Intent of the service (tenant filter present, tenant value of a write taken
// from the context). The database rejecting violations is certified by pgTAP
// and Bruno.

const TENANT = 'tenant-from-context';

const ROW = { id: 'r-1', name: 'Room', capacity: 4, active: true };

describe('ResourcesService.listForTenant', () => {
  it('filters by the tenant it was given', async () => {
    const recorder = recordSupabase({ data: [ROW], error: null });

    await new ResourcesService().listForTenant(TENANT);

    expect(recorder.eqFilters()).toContainEqual(['tenant_id', TENANT]);
  });

  it('never filters by any other tenant value', async () => {
    const recorder = recordSupabase({ data: [], error: null });

    await new ResourcesService().listForTenant(TENANT);

    const tenantValues = recorder
      .eqFilters()
      .filter(([column]) => column === 'tenant_id')
      .map(([, value]) => value);
    expect(tenantValues).toEqual([TENANT]);
  });
});

describe('ResourcesService.create', () => {
  const dto: CreateResourceDto = { name: 'Room', capacity: 4 };

  it('takes tenant_id from its argument', async () => {
    const recorder = recordSupabase({ data: ROW, error: null });

    await new ResourcesService().create(TENANT, dto);

    expect(recorder.insertedPayload()).toEqual({
      tenant_id: TENANT,
      name: 'Room',
      capacity: 4,
    });
  });

  it.each(['tenant_id', 'tenantId', 'id', 'active'])(
    'ignores a %s smuggled in the dto',
    async (field) => {
      const recorder = recordSupabase({ data: ROW, error: null });
      const smuggled = { ...dto, [field]: 'attacker' } as CreateResourceDto;

      await new ResourcesService().create(TENANT, smuggled);

      const payload = recorder.insertedPayload();
      expect(payload.tenant_id).toBe(TENANT);
      expect(Object.values(payload)).not.toContain('attacker');
    },
  );
});
